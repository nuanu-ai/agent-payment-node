import { canonicalJson, hashObject } from "../../canonical.js";
import { approvalCode } from "../../approval-code.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import { StateStore } from "../../state.js";
import { exactChainConsent } from "../../tty-approval.js";
import { SwapOperationRepository } from "../repository.js";
import { SOLANA_MAINNET_GENESIS } from "./catalog.js";
import { jupiterV1AccountBindingHash, type JupiterV1OwnerBinding } from "./v1-admission.js";
import { verifySignedJupiterV1Transaction } from "./v1-effects.js";
import { guardJupiterV1WhirlpoolMaterial } from "./v1-guard.js";
import { assertHistoricalOrdinaryRecentBlockhash } from "./historical-wire.js";
import { routeConfigForMaterial } from "./v1-route-config.js";
import { existingHistoricalRoot, HistoricalBindingReader, HistoricalCustodyReader, HistoricalMaterialReader, historicalAuthenticationRefused as refuse } from "./historical-authentication-readers.js";

export const HISTORICAL_JUPITER_IDS = Object.freeze([
  "67cec83fd91f78acb9decf9ef89dcf1f95c9551dcdf996d0a840db4c48cd8457",
  "ea25d97d0da057bfab9a6b6ade2b5799d8b81333ab99c33c793a75c0a8bde5ee",
  "ed04535cb343db8bd5b7871b8725492c395206ccfe339661d15817c2ead7a738",
] as const);
const brand: unique symbol = Symbol("HistoricalJupiterMaterialAuthority");
export interface HistoricalJupiterMaterialAuthority { readonly [brand]: true }
export interface HistoricalJupiterProjection {
  readonly schemaVersion: "apn.jupiter-historical-authentication.v1";
  readonly operationId: string; readonly operationIntegrityHash: string; readonly rootBinding: string;
  readonly ownerProfileHash: string; readonly accountBindingHash: string; readonly payer: string;
  readonly policyDigest: string; readonly activationDigest: string; readonly originalBindingHash: string;
  readonly originalMaterialDigest: string; readonly freshMaterialDigest: string; readonly markerHash: string;
  readonly principalLamports: string; readonly maximumNativeExpenseLamports: string; readonly freshMaximumNativeExpenseLamports: string;
  readonly networkFeeLamports: string; readonly tokenAccountRentLamports: string;
  readonly genesis: typeof SOLANA_MAINNET_GENESIS; readonly blockhash: string; readonly lastValidBlockHeight: string;
  readonly signature: string; readonly rawPayloadHash: string; readonly messageHash: string;
  readonly freshBlockhash: string; readonly freshLastValidBlockHeight: string;
  readonly heightBinding: "authenticated_material_not_signed_message";
  readonly originalQuoteRpcLifetime: import("./v1-material.js").JupiterV1QuoteRpcLifetime | null;
  readonly lifetimeProvenance: "configured_mainnet_rpc_before_quote_freeze" | "original_provider_build";
  readonly ordinaryRecentBlockhash: true; readonly authenticatedAt: string;
}
/** No financial authority: only exact historical material authenticity, never expiry or past absence. */
export class JupiterHistoricalAuthenticator {
  readonly #state: StateStore;
  readonly #tokens = new WeakMap<HistoricalJupiterMaterialAuthority, { readonly projection: HistoricalJupiterProjection; readonly expires: number }>();
  readonly #wrapping: WrappingSecretPort;
  constructor(root: string, wrapping: WrappingSecretPort) { this.#state = new StateStore(root); this.#wrapping = wrapping; }
  async authenticate(operationId: string): Promise<{ readonly projection: HistoricalJupiterProjection; readonly authority: HistoricalJupiterMaterialAuthority }> {
    if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId)) refuse();
    await existingHistoricalRoot(this.#state.root);
    const operations = new SwapOperationRepository(this.#state.root), original = await operations.loadAny(operationId);
    if (original === null || original.quote.profile !== "solana-local" || !["unknown_finality", "submitted"].includes(original.state) || original.submissionMarker === null || original.receiptProof !== null) refuse();
    return await this.#state.withLocks([`profile:${original.ownerProfileHash}`, `profile:${this.#state.profileHash("solana-local")}`, `operation:${operationId}`, `chain-wallet-effects:solana:${this.#state.profileHash("solana-local")}`], async () => {
      const assertUnchanged = async () => { const current = await operations.loadAny(operationId); if (canonicalJson(current) !== canonicalJson(original)) refuse(); };
      await assertUnchanged();
      const materials = new HistoricalMaterialReader(this.#state.root), bindings = new HistoricalBindingReader(this.#state.root);
      const material = await materials.load(original.quote.quoteHash); if (material === null) refuse();
      if (routeConfigForMaterial(material.execution).routeId !== "whirlpool-v1-83-sol-usdc" || canonicalJson(material.quote) !== canonicalJson(original.quote) || material.execution.genesis !== SOLANA_MAINNET_GENESIS || original.quote.inputAmountAtomic !== "1000000") refuse();
      const binding = await bindings.load(original, material); if (binding === null) refuse();
      const { fresh } = await bindings.loadFresh(original, binding);
      // Historical semantic validation uses its retained snapshot, never refreshes or signs a new message.
      await guardJupiterV1WhirlpoolMaterial(material.execution); await guardJupiterV1WhirlpoolMaterial(fresh);
      if (fresh.maximumNativeExpenseLamports !== material.execution.maximumNativeExpenseLamports || fresh.lifetime.blockhash !== material.execution.lifetime.blockhash || fresh.networkFeeLamports !== material.execution.networkFeeLamports || fresh.tokenAccountRentLamports !== material.execution.tokenAccountRentLamports) refuse();
      assertHistoricalOrdinaryRecentBlockhash(material.execution.transactionBase64, material.execution.rawInstructions);
      assertHistoricalOrdinaryRecentBlockhash(fresh.transactionBase64, fresh.rawInstructions);
      let live = false, expires = 0;
      let assertPublicFrame = assertUnchanged;
      const guard = async () => { if (!live || Date.now() >= expires) refuse(); await assertPublicFrame(); if (!live || Date.now() >= expires) refuse(); };
      const custody = new HistoricalCustodyReader(this.#state.root, { load: async () => { await guard(); const key = await this.#wrapping.load(); try { await guard(); return key; } catch (error) { key?.fill(0); throw error; } }, create: async () => refuse() });
      const owner = await custody.account("solana-local", "solana"), envelopeOwner = await custody.ownerBinding("solana-local", "solana");
      if (owner === null || canonicalJson(owner) !== canonicalJson(envelopeOwner) || owner.provider !== "local" || owner.custody !== "local_software" || owner.network !== "mainnet" || owner.address !== original.quote.account || jupiterV1AccountBindingHash(owner) !== binding.accountBindingHash) refuse();
      const admission: JupiterV1OwnerBinding = { account: owner, accountBindingHash: binding.accountBindingHash, policyDigest: binding.policyDigest, activationDigest: binding.activationDigest, admissionHash: binding.ownerAdmissionHash };
      await bindings.assertPrepared(original, admission, material);
      const publicSignature = await bindings.loadSignature(original, binding), claim = await bindings.loadClaim(original);
      if (publicSignature === null || claim === null || claim.signature !== publicSignature || claim.bindingHash !== binding.bindingHash) refuse();
      const initialFrame = canonicalJson({ material, binding, fresh, owner, claim, publicSignature });
      assertPublicFrame = async () => {
        await assertUnchanged();
        const currentMaterial = await materials.load(original.quote.quoteHash); if (currentMaterial === null) refuse();
        const currentBinding = await bindings.load(original, currentMaterial); if (currentBinding === null) refuse();
        const currentFresh = await bindings.loadFresh(original, currentBinding);
        const currentOwner = await custody.ownerBinding("solana-local", "solana");
        await bindings.assertPrepared(original, admission, currentMaterial);
        if (canonicalJson({ material: currentMaterial, binding: currentBinding, fresh: currentFresh.fresh, owner: currentOwner, claim: await bindings.loadClaim(original), publicSignature: await bindings.loadSignature(original, currentBinding) }) !== initialFrame) refuse();
      };
      const deadline = new Date(Date.now() + 60_000).toISOString();
      await exactChainConsent(["Authenticate retained historical Jupiter material only", `Operation ${operationId}; owner ${owner.address}`, "Decrypt the existing seed-containing wallet container without deriving a signer, signing or sending.", "No ledger retirement, charge, expiry verdict or past absence is authorized."], approvalCode("swap", operationId, binding.bindingHash), deadline, {});
      expires = Date.parse(deadline); live = true;
      try {
        await guard();
        const effect = await custody.effect(owner, operationId, binding.bindingHash); if (effect === null) refuse();
        await guard(); await verifySignedJupiterV1Transaction(effect, binding);
        assertHistoricalOrdinaryRecentBlockhash(effect.rawPayload, material.execution.rawInstructions);
        if (effect.transactionId !== publicSignature || claim.rawPayloadHash !== effect.rawPayloadHash) refuse();
        const currentOwner = await custody.ownerBinding("solana-local", "solana"); if (canonicalJson(currentOwner) !== canonicalJson(owner)) refuse();
        await guard();
        const projection: HistoricalJupiterProjection = Object.freeze({ schemaVersion: "apn.jupiter-historical-authentication.v1", operationId, operationIntegrityHash: original.integrityHash, rootBinding: hashObject({root:this.#state.root}), ownerProfileHash: original.ownerProfileHash, accountBindingHash: binding.accountBindingHash, payer: owner.address, policyDigest: binding.policyDigest, activationDigest: binding.activationDigest, originalBindingHash: binding.bindingHash, originalMaterialDigest: material.execution.materialDigest, freshMaterialDigest: fresh.materialDigest, markerHash: original.submissionMarker!.markerHash, principalLamports: original.quote.inputAmountAtomic, maximumNativeExpenseLamports: material.execution.maximumNativeExpenseLamports, freshMaximumNativeExpenseLamports: fresh.maximumNativeExpenseLamports, networkFeeLamports: material.execution.networkFeeLamports!, tokenAccountRentLamports: material.execution.tokenAccountRentLamports, genesis: SOLANA_MAINNET_GENESIS, blockhash: material.execution.lifetime.blockhash, lastValidBlockHeight: material.execution.lifetime.lastValidBlockHeight, freshBlockhash: fresh.lifetime.blockhash, freshLastValidBlockHeight: fresh.lifetime.lastValidBlockHeight, heightBinding: "authenticated_material_not_signed_message", originalQuoteRpcLifetime: material.execution.quoteRpcLifetime === undefined ? null : Object.freeze(structuredClone(material.execution.quoteRpcLifetime)), signature: effect.transactionId, rawPayloadHash: effect.rawPayloadHash, messageHash: binding.messageHash, lifetimeProvenance: material.execution.quoteRpcLifetime === undefined ? "original_provider_build" : "configured_mainnet_rpc_before_quote_freeze", ordinaryRecentBlockhash: true, authenticatedAt: new Date().toISOString() });
        const authority = Object.freeze({}) as HistoricalJupiterMaterialAuthority;
        this.#tokens.set(authority, {projection, expires});
        return { projection: Object.freeze(structuredClone(projection)), authority };
      } finally { live = false; }
    });
  }
  /** Instance/root-bound one-use authentication evidence; never permission to change a ledger or send. */
  async consume(authority: HistoricalJupiterMaterialAuthority, operationId: string): Promise<HistoricalJupiterProjection> {
    const value = this.#tokens.get(authority); this.#tokens.delete(authority);
    if (value === undefined || value.projection.operationId !== operationId || Date.now() >= value.expires) refuse();
    const current = await new SwapOperationRepository(this.#state.root).loadAny(operationId);
    if (current?.integrityHash !== value.projection.operationIntegrityHash || Date.now() >= value.expires) refuse();
    return Object.freeze(structuredClone(value.projection));
  }
}
