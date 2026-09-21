import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { loadActiveAssetPolicyRegistry, type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import {
  AssetUsageLedger, assetUsageReservationId,
  type AssetUsageIdentity, type AssetUsageReservation,
} from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import type { RuntimeContext } from "../runtime.js";
import type { BridgeRouteRequest } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import { bridgeAssetRow, bridgeProviderBoundNativeDestination } from "./asset-registry.js";
import { bridgeAddress, bridgeFailure, bridgeSame, bridgeUint } from "./validation.js";

export const BRIDGE_ALLOWLIST_SCHEMA = "apn.bridge-allowlist.v1" as const;
export const LIFI_ACROSS_BRIDGE_MECHANISM = Object.freeze({ provider: "lifi", reference: "across-v4" }) as Readonly<{
  provider: "lifi"; reference: "across-v4";
}>;
export const LIFI_STARGATE_BRIDGE_MECHANISM = Object.freeze({ provider: "lifi", reference: "stargate-v2-taxi" }) as Readonly<{
  provider: "lifi"; reference: "stargate-v2-taxi";
}>;
export type LifiBridgeMechanism = typeof LIFI_ACROSS_BRIDGE_MECHANISM | typeof LIFI_STARGATE_BRIDGE_MECHANISM;

export interface BridgeAllowlistBinding {
  readonly schemaVersion: typeof BRIDGE_ALLOWLIST_SCHEMA;
  readonly policyDigest: string;
  readonly policyRevision: number;
  readonly account: string;
  readonly chain: string;
  readonly asset: AssetUsageIdentity["asset"];
  readonly amountAtomic: string;
  readonly selfRecipient: string;
  readonly mechanism: LifiBridgeMechanism;
}

export type BridgeUsageTarget = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert";

export class BridgeAllowlistGate {
  private readonly ledger: AssetUsageLedger;
  constructor(private readonly context: Pick<RuntimeContext, "state" | "clock">) {
    this.ledger = new AssetUsageLedger(context.state.root);
  }

  async admit(profile: string, owner: string, request: BridgeRouteRequest, tool: string): Promise<BridgeAllowlistBinding> {
    if (bridgeProviderBoundNativeDestination(request) && request.recipient !== owner) {
      refuse("bridge_self_recipient_required", "This native destination is limited to the bound profile owner's own address.");
    }
    const mechanism = bridgeMechanism(tool);
    const subject = bridgeSubject(owner, request), active = await this.active(profile, owner);
    const usage = await this.ledger.usage(identity(subject), this.context.clock.now());
    const evaluation = { chain: subject.chain, asset: subject.asset, rail: "bridge" as const, amountAtomic: request.amountAtomic,
      dailyUsageAtomic: usage.amountAtomic, asOfDate: this.context.clock.now().toISOString().slice(0, 10), asOf: this.context.clock.now().toISOString() };
    const admission = evaluate(active.registry, evaluation);
    exactMechanism(admission.asset.mechanismPins?.bridge, mechanism);
    return { schemaVersion: BRIDGE_ALLOWLIST_SCHEMA, policyDigest: active.digest, policyRevision: active.revision,
      ...subject, mechanism };
  }

  async confirm(profile: string, request: BridgeRouteRequest, tool: string, bindingValue: unknown): Promise<ActiveAssetPolicy> {
    const binding = validateBridgeAllowlistBinding(bindingValue), subject = bridgeSubject(binding.account, request);
    if (request.recipient !== binding.selfRecipient || !bridgeSame(subject, {
      account: binding.account, chain: binding.chain, asset: binding.asset, amountAtomic: binding.amountAtomic, selfRecipient: binding.selfRecipient,
    })) refuse("bridge_binding_changed", "The bridge owner, recipient, asset, or amount differs from the prepared owner binding.");
    if (bridgeProviderBoundNativeDestination(request) && request.recipient !== binding.account) {
      refuse("bridge_self_recipient_required", "This native destination is limited to the bound profile owner's own address.");
    }
    const mechanism = bridgeMechanism(tool);
    if (!bridgeSame(binding.mechanism, mechanism)) refuse("bridge_mechanism_mismatch", "The prepared bridge mechanism differs from the selected LI.FI route.");
    const active = await this.active(profile, binding.account);
    if (active.digest !== binding.policyDigest || active.revision !== binding.policyRevision) {
      refuse("allowlist_policy_changed", "The active owner allowlist policy changed after bridge preparation; prepare a new bridge operation.");
    }
    const admission = evaluate(active.registry, { chain: binding.chain, asset: binding.asset, rail: "bridge", amountAtomic: binding.amountAtomic,
      dailyUsageAtomic: "0", asOfDate: this.context.clock.now().toISOString().slice(0, 10), asOf: this.context.clock.now().toISOString() });
    exactMechanism(admission.asset.mechanismPins?.bridge, mechanism);
    return active;
  }

  async reserve(op: BridgeOperationRecord): Promise<AssetUsageReservation> {
    const request = op.intent.materialization.request, binding = validateBridgeAllowlistBinding(op.intent.allowlist);
    const active = await this.confirm(op.intent.profile, request, op.intent.materialization.tool, binding);
    try {
      return await this.ledger.reserve({ ...identity(binding), registry: active.registry, rail: "bridge", amountAtomic: binding.amountAtomic,
        idempotencyKey: bridgeUsageKey(op.operationId), now: this.context.clock.now() });
    } catch (error) { return mapCap(error); }
  }

  async follow(op: BridgeOperationRecord, target: BridgeUsageTarget): Promise<void> {
    if (op.intent.allowlist === null) return;
    const frozen = op.usageLease;
    const binding = validateBridgeAllowlistBinding(op.intent.allowlist), expectedId = assetUsageReservationId(identity(binding), bridgeUsageKey(op.operationId));
    let current = await this.ledger.load(identity(binding), expectedId);
    // reserve() is idempotent under this operation-derived id. If the process died after the ledger write but before
    // the journal save, the frozen operation still has a null lease; discovering this exact id is the recovery link.
    if (frozen === null && current === null) return;
    if (frozen !== null && (frozen.reservationId !== expectedId || frozen.policyDigest !== binding.policyDigest ||
        frozen.amountAtomic !== binding.amountAtomic || frozen.state !== "reserved" ||
        !bridgeSame(identity(frozen), identity(binding)))) bridgeFailure("APN_STATE_CORRUPT", "bridge_usage_lease_binding");
    if (current === null) bridgeFailure("APN_STATE_CORRUPT", "bridge_usage_lease_missing");
    if (current.reservationId !== expectedId || current.policyDigest !== binding.policyDigest || current.amountAtomic !== binding.amountAtomic ||
        current.rail !== "bridge" || !bridgeSame(identity(current), identity(binding))) bridgeFailure("APN_STATE_CORRUPT", "bridge_usage_lease_binding");
    if (target === "reserved") {
      if (current.state !== "reserved") bridgeFailure("APN_STATE_CORRUPT", "bridge_usage_orphan_state");
      return;
    }
    if (current.state === target) return;
    if (["finalized", "failed_before_effect", "failed_confirmed_revert"].includes(current.state)) {
      bridgeFailure("APN_STATE_CORRUPT", "bridge_usage_terminal_conflict");
    }
    const move = async (state: Exclude<BridgeUsageTarget, "reserved">, outcome = false) => {
      current = await this.ledger.transition({ ...identity(binding), reservationId: expectedId, policyDigest: binding.policyDigest, state,
        now: this.context.clock.now(), ...(outcome ? { outcomeDigest: domainHash("apn.bridge-usage-outcome.v1", canonicalJson({
          operationId: op.operationId, state, integrityHash: op.integrityHash,
        })) } : {}) });
    };
    if (target === "submitted") { if (current.state === "reserved") await move("submitted"); return; }
    if (target === "unknown_finality") { if (current.state === "reserved") await move("submitted"); if (current.state === "submitted") await move("unknown_finality"); return; }
    if (target === "failed_before_effect") { if (current.state !== "reserved") bridgeFailure("APN_STATE_CORRUPT", "bridge_usage_release_after_effect"); await move(target, true); return; }
    if (target === "failed_confirmed_revert" && current.state === "reserved") await move("submitted");
    await move(target, true);
  }

  private async active(profile: string, owner: string): Promise<ActiveAssetPolicy> {
    let active: ActiveAssetPolicy | null;
    try { active = await loadActiveAssetPolicyRegistry(this.context, profile); }
    catch (error) {
      if (error instanceof ApnError && error.details?.reason === "allowlist_policy_expired") {
        refuse("allowlist_policy_expired", "The active owner allowlist policy has expired; prepare under a new revision.");
      }
      throw error;
    }
    if (active === null) refuse("allowlist_policy_required", "Bridge execution requires an owner-activated allowlist policy for this profile.");
    if (active.accounts.evm !== owner) refuse("allowlist_account_mismatch", "The active owner allowlist policy names a different EVM account.");
    return active;
  }
}

export function validateBridgeAllowlistBinding(value: unknown): BridgeAllowlistBinding {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "policyDigest", "policyRevision", "account", "chain", "asset",
    "amountAtomic", "selfRecipient", "mechanism"]) || !isPlainRecord(value.asset) || !exactKeys(value.asset, ["kind", "identifier"])) {
    bridgeFailure("APN_STATE_CORRUPT", "bridge_allowlist_binding");
  }
  const binding = value as unknown as BridgeAllowlistBinding;
  if (binding.schemaVersion !== BRIDGE_ALLOWLIST_SCHEMA || !/^[a-f0-9]{64}$/u.test(binding.policyDigest) ||
      !Number.isSafeInteger(binding.policyRevision) || binding.policyRevision < 1 ||
      bridgeAddress(binding.account, "APN_STATE_CORRUPT") !== binding.account || !/^eip155:(?:1|8453|42161)$/u.test(binding.chain) ||
      (binding.asset.kind === "native" ? binding.asset.identifier !== null : bridgeAddress(binding.asset.identifier, "APN_STATE_CORRUPT") !== binding.asset.identifier) ||
      bridgeAddress(binding.selfRecipient, "APN_STATE_CORRUPT") !== binding.selfRecipient ||
      bridgeUint(binding.amountAtomic, true, "APN_STATE_CORRUPT") < 1n || !isBridgeMechanism(binding.mechanism)) {
    bridgeFailure("APN_STATE_CORRUPT", "bridge_allowlist_binding");
  }
  return binding;
}

export function bridgeUsageTarget(op: BridgeOperationRecord): BridgeUsageTarget {
  if (op.state === "completed" || op.state === "destination_failed") return "finalized";
  if (op.state === "failed_before_effect") return "failed_before_effect";
  if (op.state === "failed_after_approval" || op.state === "failed_confirmed_revert") return "failed_confirmed_revert";
  if (op.state === "unknown_finality" || op.effects.some((effect) => effect.phase === "unknown_finality")) return "unknown_finality";
  if (op.usageLease === null) return "reserved";
  return op.effects.some((effect) => effect.submissionAttempts === 1) ? "submitted" : "reserved";
}

function bridgeSubject(account: string, request: BridgeRouteRequest) {
  const row = bridgeAssetRow(request.fromChainId, request.fromToken);
  return { account, chain: `eip155:${request.fromChainId}`, asset: row.kind === "native"
    ? { kind: "native" as const, identifier: null } : { kind: "token" as const, identifier: row.address },
    amountAtomic: request.amountAtomic, selfRecipient: request.recipient };
}
function identity(value: AssetUsageIdentity): AssetUsageIdentity { return { account: value.account, chain: value.chain, asset: value.asset }; }
function bridgeUsageKey(operationId: string): string { return `apn.bridge-usage:${operationId}`; }
export function bridgeMechanism(tool: string): LifiBridgeMechanism {
  if (tool === "across") return LIFI_ACROSS_BRIDGE_MECHANISM;
  if (tool === "stargateV2") return LIFI_STARGATE_BRIDGE_MECHANISM;
  return refuse("bridge_mechanism_mismatch", "The LI.FI bridge tool has no owner-approved mechanism identity.");
}
function isBridgeMechanism(value: unknown): value is LifiBridgeMechanism {
  return bridgeSame(value, LIFI_ACROSS_BRIDGE_MECHANISM) || bridgeSame(value, LIFI_STARGATE_BRIDGE_MECHANISM);
}
function exactMechanism(value: unknown, expected: LifiBridgeMechanism): void {
  if (!bridgeSame(value, expected)) refuse("bridge_mechanism_mismatch", "The owner policy lacks the exact LI.FI bridge mechanism pin.");
}
function evaluate(registry: unknown, input: Parameters<typeof evaluateAssetPolicy>[1]) {
  try { return evaluateAssetPolicy(registry, input); } catch (error) { return mapCap(error); }
}
function mapCap(error: unknown): never {
  if (error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED") {
    if (error.message.includes("daily cap")) refuse("allowlist_daily_cap_exceeded", error.message);
    if (error.message.includes("per-transfer cap")) refuse("allowlist_per_transfer_cap_exceeded", error.message);
  }
  throw error;
}
function refuse(reason: string, message: string): never { throw new ApnError("APN_ALLOWLIST_REFUSED", message, { reason, rail: "bridge" }); }
