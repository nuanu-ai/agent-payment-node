import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { loadActiveAssetPolicyRegistry, type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { loadAllowlistInventory } from "../allowlist-inventory.js";
import { ASSET_POLICY_REGISTRY_SCHEMA_V2, evaluateAssetPolicy, type AssetPolicyAdmission } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity, type AssetUsageReservation } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import type { ClockPort } from "../ports.js";
import { X402_PERMIT2_MECHANISM } from "./registry.js";

export const X402_PERMIT2_ALLOWLIST_SCHEMA = "apn.x402-permit2-allowlist.v1" as const;
const OUTCOME_DOMAIN = "apn.x402-permit2-usage-outcome.v1";
const DIGEST = /^[a-f0-9]{64}$/u;

export interface X402Permit2AllowlistBinding {
  readonly schemaVersion: typeof X402_PERMIT2_ALLOWLIST_SCHEMA;
  readonly policyDigest: string;
  readonly policyRevision: number;
}
export interface X402Permit2AllowlistSubject {
  readonly profile: string;
  readonly operationId: string;
  /** The frozen EVM payer; must be the policy's owner EVM account. */
  readonly account: Address;
  readonly chain: string;
  readonly token: Address;
  readonly amountAtomic: string;
}
/** reserved -> exposed (signature left APN) -> finalized | unknown_finality; failed_before_effect only before exposure. */
export type X402Permit2UsageTarget = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect";

/** Owner allowlist gate for rail `x402`: exact list identity, the pinned Permit2 mechanism, per-rail caps and shared daily usage. */
export class X402Permit2AllowlistGate {
  private readonly ledger: AssetUsageLedger;
  constructor(private readonly context: { readonly state: { readonly root: string }; readonly clock: ClockPort }) {
    this.ledger = new AssetUsageLedger(context.state.root);
  }

  /** Prepare: admitted now, including today's combined usage for the asset. Runs before any RPC, custody or signing call. */
  async admit(subject: X402Permit2AllowlistSubject): Promise<X402Permit2AllowlistBinding> {
    requireListed(subject);
    const active = await this.active(subject);
    const now = this.context.clock.now();
    evaluate(active, subject, (await this.ledger.usage(identity(subject), now)).amountAtomic, now);
    return { schemaVersion: X402_PERMIT2_ALLOWLIST_SCHEMA, policyDigest: active.digest, policyRevision: active.revision };
  }

  /** After the foreground decision and before any signature: the same revision must still be active. Replays never double-reserve. */
  async reserve(subject: X402Permit2AllowlistSubject, bindingValue: unknown): Promise<AssetUsageReservation> {
    const binding = validateX402Permit2AllowlistBinding(bindingValue);
    requireListed(subject);
    const active = await this.active(subject);
    if (active.digest !== binding.policyDigest || active.revision !== binding.policyRevision) {
      refuse("allowlist_policy_changed", "The active owner allowlist policy changed after preparation; prepare a new payment.");
    }
    const now = this.context.clock.now(), id = identity(subject);
    const existing = await this.ledger.load(id, assetUsageReservationId(id, usageKey(subject.operationId)));
    if (existing === null) evaluate(active, subject, (await this.ledger.usage(id, now)).amountAtomic, now);
    else if (existing.state !== "reserved") throw new ApnError("APN_OPERATION_BLOCKED", "The x402 usage reservation already crossed a durable transition.");
    const reservation = await this.ledger.reserve({ ...identity(subject), registry: active.registry, rail: "x402",
      amountAtomic: subject.amountAtomic, idempotencyKey: usageKey(subject.operationId), now });
    if (reservation.state !== "reserved" || reservation.policyDigest !== binding.policyDigest) {
      throw new ApnError("APN_OPERATION_BLOCKED", "The x402 usage reservation already crossed a durable transition.");
    }
    return reservation;
  }

  /** Move the ledger forward to the operation's state. Idempotent; it never moves backward. */
  async follow(subject: X402Permit2AllowlistSubject, target: X402Permit2UsageTarget, evidenceHash: string): Promise<void> {
    if (target === "reserved") return;
    const id = identity(subject);
    const current = await this.ledger.load(id, assetUsageReservationId(id, usageKey(subject.operationId)));
    if (current === null) {
      if (target === "failed_before_effect") return;
      corrupt("The x402 operation names a usage reservation that the ledger does not hold.");
    }
    if (current.state === target) return;
    if (current.state === "finalized" || current.state === "failed_before_effect" || current.state === "failed_confirmed_revert") {
      corrupt("The x402 usage reservation reached a different terminal state than its operation.");
    }
    if (target === "failed_before_effect" && current.state !== "reserved") corrupt("An exposed x402 authorization cannot be released before effect.");
    const move = async (state: Exclude<X402Permit2UsageTarget, "reserved">, withOutcome: boolean) => await this.ledger.transition({
      ...id, reservationId: current.reservationId, policyDigest: current.policyDigest, state, now: this.context.clock.now(),
      ...(withOutcome ? { outcomeDigest: domainHash(OUTCOME_DOMAIN, canonicalJson({ operationId: subject.operationId, state, evidenceHash })) } : {}) });
    if (target === "submitted") { if (current.state === "reserved") await move("submitted", false); return; }
    if (target === "unknown_finality") { await move("unknown_finality", false); return; }
    if (target === "finalized" && current.state === "reserved") await move("submitted", false);
    await move(target, target === "finalized" || target === "failed_before_effect");
  }

  private async active(subject: X402Permit2AllowlistSubject): Promise<ActiveAssetPolicy> {
    let active: ActiveAssetPolicy | null;
    try { active = await loadActiveAssetPolicyRegistry(this.context, subject.profile); }
    catch (error) {
      if (error instanceof ApnError && error.details?.reason === "allowlist_policy_expired") {
        refuse("allowlist_policy_expired", "The active owner allowlist policy has expired; stage and activate a new revision.");
      }
      throw error;
    }
    if (active === null) refuse("allowlist_policy_required", "x402 payments in list tokens require an owner-activated allowlist policy.");
    if (active.accounts.evm !== subject.account) refuse("allowlist_account_mismatch", "The active policy names a different owner EVM account.");
    return active;
  }
}

export function validateX402Permit2AllowlistBinding(value: unknown): X402Permit2AllowlistBinding {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "policyDigest", "policyRevision"]) ||
      value.schemaVersion !== X402_PERMIT2_ALLOWLIST_SCHEMA || typeof value.policyDigest !== "string" || !DIGEST.test(value.policyDigest) ||
      typeof value.policyRevision !== "number" || !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 1) {
    corrupt("The x402 allowlist binding is invalid.");
  }
  return value as unknown as X402Permit2AllowlistBinding;
}

export function x402Permit2UsageKey(operationId: string): string { return usageKey(operationId); }

function requireListed(subject: X402Permit2AllowlistSubject): void {
  const inventory = loadAllowlistInventory();
  if (!inventory.assets.some((row) => row.chain === subject.chain && row.kind === "token" && row.identifier === subject.token)) {
    refuse("allowlist_asset_unlisted", "The token is not on the frozen allowlist for this network.");
  }
}

function evaluate(active: ActiveAssetPolicy, subject: X402Permit2AllowlistSubject, dailyUsageAtomic: string, now: Date): AssetPolicyAdmission {
  const registry = active.registry, at = now.toISOString();
  if (registry.expiresAt !== undefined && at >= registry.expiresAt) refuse("allowlist_policy_expired", "The active owner allowlist policy has expired.");
  if (registry.effectiveAt !== undefined && at < registry.effectiveAt) refuse("allowlist_policy_not_effective", "The active owner allowlist policy is not effective yet.");
  const row = registry.chains.find((chain) => chain.chain === subject.chain)?.assets
    .find((asset) => asset.kind === "token" && asset.identifier === subject.token);
  const caps = row === undefined || !row.rails.x402 ? undefined
    : registry.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? row.railCaps?.x402 : row.caps;
  if (row === undefined || caps === undefined) refuse("allowlist_x402_not_admitted", "The active owner policy does not admit this token on the x402 rail.");
  if (canonicalJson(row.mechanismPins?.x402 ?? null) !== canonicalJson(X402_PERMIT2_MECHANISM)) {
    refuse("allowlist_x402_mechanism_mismatch", "The owner's x402 admission does not pin the exact Permit2 proxy mechanism.");
  }
  const amount = BigInt(subject.amountAtomic), usage = BigInt(dailyUsageAtomic);
  if (amount > BigInt(caps.maximumPerTransferAtomic)) refuse("allowlist_per_transfer_cap_exceeded", "The payment exceeds the owner's per-operation x402 cap.");
  if (usage + amount > BigInt(caps.dailyLimitAtomic)) refuse("allowlist_daily_cap_exceeded", "The payment exceeds the owner's daily cap given today's usage.");
  return evaluateAssetPolicy(registry, { chain: subject.chain, asset: { kind: "token", identifier: subject.token }, rail: "x402",
    amountAtomic: subject.amountAtomic, dailyUsageAtomic, asOfDate: at.slice(0, 10), asOf: at });
}

function identity(subject: X402Permit2AllowlistSubject): AssetUsageIdentity {
  return { account: subject.account, chain: subject.chain, asset: { kind: "token", identifier: subject.token } };
}
function usageKey(operationId: string): string {
  if (typeof operationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "The operation id is invalid.");
  return `apn.x402-permit2-usage:${operationId}`;
}
function refuse(reason: string, message: string): never {
  throw new ApnError("APN_ALLOWLIST_REFUSED", message, { reason, rail: "x402" });
}
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
