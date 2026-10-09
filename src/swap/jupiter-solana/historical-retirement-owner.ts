import { dirname } from "node:path";
import { canonicalJson, hashObject } from "../../canonical.js";
import { approvalCode } from "../../approval-code.js";
import { MacOSLoginKeychainSecret } from "../../macos-keychain.js";
import { AllowlistPolicyStore } from "../../allowlist-policy-store.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import { allowlistProfileHash } from "../../allowlist-policy-overlay.js";
import type { RailSignedEffect } from "../../direct-rail-ports.js";
import { SwapOperationRepository } from "../repository.js";
import type { SwapOperationRecord } from "../model.js";
import { exactChainConsent } from "../../tty-approval.js";
import { SOLANA_MAINNET_GENESIS } from "./catalog.js";
import { jupiterV1AccountBindingHash, type JupiterV1OwnerBinding } from "./v1-admission.js";
import { verifySignedJupiterV1Transaction, type JupiterV1ExecutionBinding } from "./v1-effects.js";
import { guardJupiterV1WhirlpoolMaterial } from "./v1-guard.js";
import { assertHistoricalOrdinaryRecentBlockhash } from "./historical-wire.js";
import { routeConfigForMaterial } from "./v1-route-config.js";
import type { JupiterV1PreparedMaterial, JupiterV1ResolvedMaterial } from "./v1-material.js";
import type { HistoricalJupiterProjection } from "./historical-projection-reader.js";
import { HistoricalReadState, HistoricalDirectoryGuard, HistoricalBindingReader, HistoricalCustodyReader,
  HistoricalMaterialReader, historicalAuthenticationRefused as refuse } from "./historical-authentication-readers.js";
import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_PAYER, HISTORICAL_JUPITER_ACCOUNT_BINDING,
  HISTORICAL_JUPITER_OWNER_PROFILE } from "./historical-pins.js";
import { historicalJupiterRetirementConsentLines } from "./historical-retirement-purpose.js";
import { consumeJupiterHistoricalRetirement, recoverCommittedJupiterHistoricalRetirement } from "./historical-retirement-consumer.js";

const PROFILE = "solana-local";
const AUTHORITY: unique symbol = Symbol("OwnedJupiterHistoricalRetirementScope");
export interface OwnedJupiterHistoricalRetirementAuthority { readonly [AUTHORITY]: true }

/** Internal data sent only to the statically bound, token-gated consumer. Never a public return value. */
export interface OwnedJupiterHistoricalRetirementContext {
  readonly state: HistoricalReadState;
  readonly operation: SwapOperationRecord;
  readonly material: JupiterV1PreparedMaterial;
  readonly fresh: JupiterV1ResolvedMaterial;
  readonly binding: JupiterV1ExecutionBinding;
  readonly effect: RailSignedEffect;
  readonly projection: HistoricalJupiterProjection;
  readonly activePolicy: ActiveAssetPolicy;
  readonly deadline: string;
}

/** Separate conservative accounting result; this is not a swap receipt or actual-expense proof. */
export interface JupiterHistoricalRetirementPublicResult {
  readonly operationId: string;
  readonly profile: "solana-local";
  readonly status: "retired_unknown";
  readonly retirementRecordHash: string;
  readonly accountingAt: string;
  readonly conservativeNativeAmount: "6000000";
  readonly additionalAdmissionNativeAmount: "5000000";
  readonly effectAt: null;
  readonly actualNativeFee: null;
  readonly transactionOutcome: "unknown";
  readonly transactionMayHaveBeenSubmitted: true;
  readonly idempotentRecovered: boolean;
}

interface OwnedScope {
  readonly context: OwnedJupiterHistoricalRetirementContext;
  readonly expires: number;
  readonly check: () => Promise<void>;
  phase: "issued" | "consuming";
}
const ownedScopes = new WeakMap<OwnedJupiterHistoricalRetirementAuthority, OwnedScope>();

function scope(token: OwnedJupiterHistoricalRetirementAuthority, context: OwnedJupiterHistoricalRetirementContext): OwnedScope {
  const value = ownedScopes.get(token);
  if (value === undefined || value.context !== context || Date.now() >= value.expires) refuse();
  return value;
}

/** Assertion only: no wire/material getter, callback, DTO issuer or caller-selected phase. */
export async function claimOwnedJupiterRetirementScope(
  token: OwnedJupiterHistoricalRetirementAuthority, context: OwnedJupiterHistoricalRetirementContext,
): Promise<void> {
  const value = scope(token, context);
  if (value.phase !== "issued") refuse();
  value.phase = "consuming";
  await assertOwnedJupiterRetirementScope(token, context);
}

/** C2 must call at every canonical-read, policy and commit seam while the original fixed locks remain held. */
export async function assertOwnedJupiterRetirementScope(
  token: OwnedJupiterHistoricalRetirementAuthority, context: OwnedJupiterHistoricalRetirementContext,
): Promise<void> {
  const value = scope(token, context);
  if (value.phase !== "consuming") refuse();
  await value.check();
  if (scope(token, context) !== value || value.phase !== "consuming") refuse();
}

class ExistingHistoricalOperationReader extends SwapOperationRepository {
  constructor(root: string, private readonly guard: HistoricalDirectoryGuard) { super(root); }
  override async initialize(): Promise<void> { await this.guard.check(["swap-operations"]); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.guard.check(dirs); const value = await super.readJson(path); await this.guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.guard.check([path]); const value = await super.readDirectory(path); await this.guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { refuse(); }
}

class ExistingHistoricalPolicyStore extends AllowlistPolicyStore {
  constructor(root: string, private readonly guard: HistoricalDirectoryGuard) { super(root); }
  override async initialize(): Promise<void> { await this.guard.check(["allowlist-policies", "allowlist-activations"]); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.guard.check(dirs); const value = await super.readJson(path); await this.guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.guard.check([path]); const value = await super.readDirectory(path); await this.guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { refuse(); }
}

function freezeSnapshot<T>(value: T): T {
  const freeze = (v: unknown): void => {
    if (v !== null && typeof v === "object") { for (const child of Object.values(v)) freeze(child); Object.freeze(v); }
  };
  freeze(value); return value;
}

/** Production-owned entry: only a root and exact fixed operation can be selected; custody/consumer are hardcoded. */
export async function executeJupiterHistoricalRetirement(
  operationId: string, root: string,
): Promise<JupiterHistoricalRetirementPublicResult> {
  if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId)) refuse();
  const state = new HistoricalReadState(root), directoryGuard = state.directoryGuard();
  await state.initialize();
  const keys = [`profile:${HISTORICAL_JUPITER_OWNER_PROFILE}`, `profile:${state.profileHash(PROFILE)}`,
    `profile:${allowlistProfileHash(PROFILE)}`, `operation:${operationId}`,
    `chain-wallet-effects:solana:${state.profileHash(PROFILE)}`];
  return await state.withLocks(keys, async () => {
    const recovered = await recoverCommittedJupiterHistoricalRetirement(operationId, state);
    if (recovered !== null) return recovered;
    const operations = new ExistingHistoricalOperationReader(root, directoryGuard), materials = new HistoricalMaterialReader(root, directoryGuard),
      bindings = new HistoricalBindingReader(root, directoryGuard), policies = new ExistingHistoricalPolicyStore(root, directoryGuard);
    const original = await operations.loadAny(operationId);
    if (original === null || original.ownerProfileHash !== HISTORICAL_JUPITER_OWNER_PROFILE ||
        original.quote.profile !== PROFILE || original.quote.account !== HISTORICAL_JUPITER_PAYER ||
        original.quote.inputAmountAtomic !== "1000000" || !["unknown_finality", "submitted"].includes(original.state) ||
        original.submissionMarker === null || original.receiptProof !== null || original.usageLease === null ||
        original.usageLease.amountAtomic !== "1000000" || !["unknown_finality", "submitted"].includes(original.usageLease.state)) refuse();
    const material = await materials.load(original.quote.quoteHash); if (material === null) refuse();
    if (material.execution.payer !== HISTORICAL_JUPITER_PAYER || material.execution.maximumNativeExpenseLamports !== "6000000" ||
        material.execution.quoteRpcLifetime === undefined || material.execution.genesis !== SOLANA_MAINNET_GENESIS ||
        routeConfigForMaterial(material.execution).routeId !== "whirlpool-v1-83-sol-usdc" ||
        canonicalJson(material.quote) !== canonicalJson(original.quote)) refuse();
    const binding = await bindings.load(original, material);
    if (binding === null || binding.accountBindingHash !== HISTORICAL_JUPITER_ACCOUNT_BINDING) refuse();
    const { fresh } = await bindings.loadFresh(original, binding);
    await guardJupiterV1WhirlpoolMaterial(material.execution); await guardJupiterV1WhirlpoolMaterial(fresh);
    if (fresh.maximumNativeExpenseLamports !== "6000000" || fresh.lifetime.blockhash !== material.execution.lifetime.blockhash ||
        fresh.networkFeeLamports !== material.execution.networkFeeLamports ||
        fresh.tokenAccountRentLamports !== material.execution.tokenAccountRentLamports) refuse();
    assertHistoricalOrdinaryRecentBlockhash(material.execution.transactionBase64, material.execution.rawInstructions);
    assertHistoricalOrdinaryRecentBlockhash(fresh.transactionBase64, fresh.rawInstructions);
    const wrapping = new MacOSLoginKeychainSecret();
    let live = false, expires = 0;
    let checkFrame = async (): Promise<void> => { if (!live || Date.now() >= expires) refuse(); };
    const custody = new HistoricalCustodyReader(root, {
      load: async () => {
        await checkFrame(); const key = await wrapping.load();
        try { await checkFrame(); return key; } catch (error) { key?.fill(0); throw error; }
      }, create: async () => refuse(),
    }, directoryGuard);
    const owner = await custody.account(PROFILE, "solana"), envelopeOwner = await custody.ownerBinding(PROFILE, "solana");
    if (owner === null || canonicalJson(owner) !== canonicalJson(envelopeOwner) ||
        owner.provider !== "local" || owner.custody !== "local_software" || owner.network !== "mainnet" ||
        owner.address !== HISTORICAL_JUPITER_PAYER || jupiterV1AccountBindingHash(owner) !== HISTORICAL_JUPITER_ACCOUNT_BINDING) refuse();
    const admission: JupiterV1OwnerBinding = { account: owner, accountBindingHash: binding.accountBindingHash,
      policyDigest: binding.policyDigest, activationDigest: binding.activationDigest, admissionHash: binding.ownerAdmissionHash };
    await bindings.assertPrepared(original, admission, material);
    const retained = await bindings.retainedEvidence(original, binding);
    await bindings.assertOriginalAbsentSignedMarker(original, retained);
    const activePolicy = activeAssetPolicyFromState(await policies.readUnderProfileLock(PROFILE), new Date());
    if (activePolicy === null || activePolicy.accounts.solana !== HISTORICAL_JUPITER_PAYER ||
        activePolicy.registry.expiresAt === undefined) refuse();
    const frame = canonicalJson({ original, material, binding, fresh, owner, retained, activePolicy });
    checkFrame = async () => {
      if (!live || Date.now() >= expires) refuse();
      await directoryGuard.check();
      const current = await operations.loadAny(operationId), currentMaterial = await materials.load(original.quote.quoteHash);
      if (current === null || currentMaterial === null) refuse();
      const currentBinding = await bindings.load(current, currentMaterial); if (currentBinding === null) refuse();
      const currentFresh = await bindings.loadFresh(current, currentBinding), currentOwner = await custody.ownerBinding(PROFILE, "solana");
      await bindings.assertPrepared(current, admission, currentMaterial);
      const currentRetained = await bindings.retainedEvidence(current, currentBinding);
      await bindings.assertOriginalAbsentSignedMarker(current, currentRetained);
      const currentPolicy = activeAssetPolicyFromState(await policies.readUnderProfileLock(PROFILE), new Date());
      if (canonicalJson({ original: current, material: currentMaterial, binding: currentBinding, fresh: currentFresh.fresh,
          owner: currentOwner, retained: currentRetained, activePolicy: currentPolicy }) !== frame ||
          !live || Date.now() >= expires) refuse();
    };
    const foregroundStartedAt = Date.now();
    const policyExpires = Date.parse(activePolicy.registry.expiresAt);
    expires = Math.min(foregroundStartedAt + 60_000, policyExpires);
    if (!Number.isFinite(expires) || expires <= foregroundStartedAt) refuse();
    const deadline = new Date(expires).toISOString();
    await exactChainConsent(historicalJupiterRetirementConsentLines(operationId),
      approvalCode("swap", operationId, hashObject({ purpose: "historical_retirement", binding: binding.bindingHash,
        activePolicy: activePolicy.digest, activation: activePolicy.activationDigest, accountedLamports: "6000000" })), deadline, {});
    live = true;
    let token: OwnedJupiterHistoricalRetirementAuthority | undefined;
    try {
      await checkFrame();
      const effect = await custody.effect(owner, operationId, binding.bindingHash); if (effect === null) refuse();
      await checkFrame(); await verifySignedJupiterV1Transaction(effect, binding);
      assertHistoricalOrdinaryRecentBlockhash(effect.rawPayload, material.execution.rawInstructions);
      if (effect.transactionId !== retained.signedMarker.signature || effect.rawPayloadHash !== retained.signedMarker.rawPayloadHash) refuse();
      await checkFrame();
      const projection: HistoricalJupiterProjection = freezeSnapshot({
        schemaVersion: "apn.jupiter-historical-authentication.v1", operationId, operationIntegrityHash: original.integrityHash,
        rootBinding: hashObject({root}), ownerProfileHash: original.ownerProfileHash, accountBindingHash: binding.accountBindingHash,
        payer: owner.address, policyDigest: binding.policyDigest, activationDigest: binding.activationDigest,
        originalBindingHash: binding.bindingHash, originalMaterialDigest: material.execution.materialDigest,
        freshMaterialDigest: fresh.materialDigest, markerHash: original.submissionMarker.markerHash,
        principalLamports: "1000000", maximumNativeExpenseLamports: "6000000", freshMaximumNativeExpenseLamports: "6000000",
        networkFeeLamports: material.execution.networkFeeLamports!, tokenAccountRentLamports: material.execution.tokenAccountRentLamports,
        genesis: SOLANA_MAINNET_GENESIS, blockhash: material.execution.lifetime.blockhash,
        lastValidBlockHeight: material.execution.lifetime.lastValidBlockHeight, signature: effect.transactionId,
        rawPayloadHash: effect.rawPayloadHash, messageHash: binding.messageHash, freshBlockhash: fresh.lifetime.blockhash,
        freshLastValidBlockHeight: fresh.lifetime.lastValidBlockHeight, heightBinding: "authenticated_material_not_signed_message",
        originalQuoteRpcLifetime: structuredClone(material.execution.quoteRpcLifetime),
        lifetimeProvenance: "configured_mainnet_rpc_before_quote_freeze", retainedClaimEvidence: structuredClone(retained.evidence),
        ordinaryRecentBlockhash: true, authenticationExpiresAt: deadline, authenticatedAt: new Date().toISOString(),
      });
      const context: OwnedJupiterHistoricalRetirementContext = Object.freeze({ state,
        operation: freezeSnapshot(original), material: freezeSnapshot(material), fresh: freezeSnapshot(fresh),
        binding: freezeSnapshot(binding), effect: freezeSnapshot(effect), projection,
        activePolicy: freezeSnapshot(activePolicy), deadline });
      token = Object.freeze({}) as OwnedJupiterHistoricalRetirementAuthority;
      ownedScopes.set(token, { context, expires, check: checkFrame, phase: "issued" });
      const result = await consumeJupiterHistoricalRetirement(token, context);
      if (scope(token, context).phase !== "consuming") refuse();
      return result;
    } finally {
      if (token !== undefined) ownedScopes.delete(token);
      live = false;
    }
  });
}
