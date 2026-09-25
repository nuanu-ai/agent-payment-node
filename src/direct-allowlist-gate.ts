import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { loadActiveAssetPolicyRegistry, type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import { loadAllowlistInventory, type CandidateAsset, type CandidateFamily } from "./allowlist-inventory.js";
import { ASSET_POLICY_REGISTRY_SCHEMA_V2, evaluateAssetPolicy, type AssetPolicyAdmission } from "./asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity, type AssetUsageReservation } from "./asset-usage-ledger.js";
import { DirectAssetUsageAdapter, validateDirectAssetUsageLease, type DirectAssetUsageLease } from "./direct-asset-usage.js";
import { ApnError } from "./errors.js";
import { directEvmSupplementalAsset } from "./evm-direct-supplemental-assets.js";
import type { ClockPort } from "./ports.js";

export const DIRECT_ALLOWLIST_SCHEMA = "apn.direct-allowlist.v1" as const;
const OUTCOME_DOMAIN = "apn.direct-usage-outcome.v1";
const DIGEST = /^[a-f0-9]{64}$/u;

/** Frozen at prepare: the exact owner policy revision that admitted the transfer. */
export interface DirectAllowlistBinding {
  readonly schemaVersion: typeof DIRECT_ALLOWLIST_SCHEMA;
  readonly policyDigest: string;
  readonly policyRevision: number;
}

export interface DirectAllowlistSubject extends AssetUsageIdentity {
  readonly profile: string;
  readonly operationId: string;
  readonly family: CandidateFamily;
  readonly amountAtomic: string;
}

export type DirectAllowlistRefusal =
  | "allowlist_network_unlisted" | "allowlist_asset_unlisted" | "allowlist_decimals_mismatch" | "allowlist_network_not_enabled"
  | "allowlist_policy_required" | "allowlist_policy_expired" | "allowlist_policy_not_effective" | "allowlist_policy_changed"
  | "allowlist_account_mismatch" | "allowlist_direct_not_admitted" | "allowlist_per_transfer_cap_exceeded"
  | "allowlist_daily_cap_exceeded" | "allowlist_binding_missing";

/** Where the owning journal says the effect is. The ledger follows it forward and never moves backward. */
export type DirectUsageTarget = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert";

/** A pinned direct row. Pure: it runs before any RPC, custody or signing call. */
export function requireListedDirectAsset(chain: string, asset: AssetUsageIdentity["asset"]): CandidateAsset {
  const inventory = loadAllowlistInventory();
  if (!inventory.networks.some((network) => network.chain === chain)) {
    refuse("allowlist_network_unlisted", "The network is not on the frozen allowlist; direct transfers are refused.", { chain });
  }
  const row = inventory.assets.find((entry) => entry.chain === chain && entry.kind === asset.kind && entry.identifier === asset.identifier)
    ?? (asset.kind === "token" ? directEvmSupplementalAsset(chain, asset.identifier) : undefined);
  if (row === undefined) {
    refuse("allowlist_asset_unlisted", "The asset has no pinned direct identity for this network.",
      { chain, asset: asset.identifier ?? "native" });
  }
  return row;
}

/** The reservation idempotency key is derived from the operation, so a replayed approval can never reserve twice. */
export function directUsageKey(operationId: string): string { return `apn.direct-usage:${operationId}`; }

export class DirectAllowlistGate {
  private readonly ledger: AssetUsageLedger;
  private readonly adapter: DirectAssetUsageAdapter;
  constructor(private readonly context: { readonly state: { readonly root: string }; readonly clock: ClockPort }) {
    this.ledger = new AssetUsageLedger(context.state.root);
    this.adapter = new DirectAssetUsageAdapter(this.ledger);
  }

  /** Prepare: the active owner policy must admit this exact transfer now, including the asset's shared usage today. */
  async admit(subject: DirectAllowlistSubject): Promise<DirectAllowlistBinding> {
    requireListedDirectAsset(subject.chain, subject.asset);
    const active = await this.active(subject);
    const now = this.context.clock.now();
    const usage = await this.ledger.usage(identity(subject), now);
    evaluate(active, subject, usage.amountAtomic, now);
    return { schemaVersion: DIRECT_ALLOWLIST_SCHEMA, policyDigest: active.digest, policyRevision: active.revision };
  }

  /**
   * Approval: after the foreground decision and before any signature. The same policy revision must still be active.
   * A reservation left by an interrupted approval is replayed, never duplicated.
   */
  async reserve(subject: DirectAllowlistSubject, bindingValue: unknown): Promise<DirectAssetUsageLease> {
    const active = await this.confirm(subject, bindingValue);
    const now = this.context.clock.now();
    const existing = await this.existing(subject);
    if (existing === null) evaluate(active, subject, (await this.ledger.usage(identity(subject), now)).amountAtomic, now);
    else if (existing.state !== "reserved") blocked("The direct usage reservation already crossed a durable transition.");
    const lease = await this.adapter.reserve({ ...identity(subject), registry: active.registry, profile: subject.profile, rail: "direct",
      amountAtomic: subject.amountAtomic, idempotencyKey: directUsageKey(subject.operationId), now });
    if (lease.reservation.state !== "reserved") blocked("The direct usage reservation already crossed a durable transition.");
    return lease;
  }

  /** The prepared policy revision must still be the active one, for the same owner account. Reads no ledger state. */
  async confirm(subject: DirectAllowlistSubject, bindingValue: unknown): Promise<ActiveAssetPolicy> {
    const binding = validateDirectAllowlistBinding(bindingValue);
    requireListedDirectAsset(subject.chain, subject.asset);
    const active = await this.active(subject);
    if (active.digest !== binding.policyDigest || active.revision !== binding.policyRevision) {
      refuse("allowlist_policy_changed", "The active owner allowlist policy changed after preparation; prepare a new transfer.",
        { policy_revision: String(active.revision) });
    }
    return active;
  }

  /** Move the ledger forward to the journal's state. Idempotent, so every resume can repair a lagging ledger. */
  async follow(subject: DirectAllowlistSubject, target: DirectUsageTarget, evidenceHash: string): Promise<void> {
    if (target === "reserved") return;
    const current = await this.existing(subject);
    if (current === null) {
      if (target === "failed_before_effect") return;
      corrupt("The operation journal names a direct usage reservation that the ledger does not hold.");
    }
    if (current.state === target) return;
    if (["finalized", "failed_before_effect", "failed_confirmed_revert"].includes(current.state)) {
      corrupt("The direct usage reservation reached a different terminal state than its operation.");
    }
    const outcomeDigest = domainHash(OUTCOME_DOMAIN, canonicalJson({ operationId: subject.operationId, state: target, evidenceHash }));
    const move = async (state: Exclude<DirectUsageTarget, "reserved">, withOutcome: boolean) => await this.ledger.transition({
      ...identity(subject), reservationId: current.reservationId, policyDigest: current.policyDigest, state,
      now: this.context.clock.now(), ...(withOutcome ? { outcomeDigest } : {}) });
    if (target === "submitted") { if (current.state === "reserved") await move("submitted", false); return; }
    if (target === "unknown_finality") { await move("unknown_finality", false); return; }
    if (target === "failed_before_effect") {
      if (current.state !== "reserved") corrupt("A direct usage reservation past the effect boundary cannot be released before effect.");
      await move("failed_before_effect", true); return;
    }
    if (target === "failed_confirmed_revert" && current.state === "reserved") await move("submitted", false);
    await move(target, true);
  }

  private async existing(subject: DirectAllowlistSubject): Promise<AssetUsageReservation | null> {
    const id = identity(subject);
    return await this.ledger.load(id, assetUsageReservationId(id, directUsageKey(subject.operationId)));
  }

  private async active(subject: DirectAllowlistSubject): Promise<ActiveAssetPolicy> {
    let active: ActiveAssetPolicy | null;
    try { active = await loadActiveAssetPolicyRegistry(this.context, subject.profile); }
    catch (error) {
      if (error instanceof ApnError && error.details?.reason === "allowlist_policy_expired") {
        refuse("allowlist_policy_expired", "The active owner allowlist policy has expired; stage and activate a new revision.");
      }
      throw error;
    }
    if (active === null) {
      refuse("allowlist_policy_required", "Direct transfers require an owner-activated allowlist policy for this profile.",
        { nextActions: [`apn allowlist policy status --profile ${subject.profile}`] });
    }
    const owner = active.accounts[subject.family];
    if (owner !== subject.account) {
      refuse("allowlist_account_mismatch", "The active owner allowlist policy names a different owner account for this network family.",
        { account: subject.account });
    }
    return active;
  }
}

export function validateDirectAllowlistBinding(value: unknown): DirectAllowlistBinding {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "policyDigest", "policyRevision"]) ||
      value.schemaVersion !== DIRECT_ALLOWLIST_SCHEMA || typeof value.policyDigest !== "string" || !DIGEST.test(value.policyDigest) ||
      typeof value.policyRevision !== "number" || !Number.isSafeInteger(value.policyRevision) || value.policyRevision < 1) {
    corrupt("The direct allowlist binding is invalid.");
  }
  return value as unknown as DirectAllowlistBinding;
}

/** The journal keeps the lease exactly as reserved; it must name this operation's exact identity, amount and policy. */
export function validateDirectAllowlistLease(value: unknown, binding: DirectAllowlistBinding, subject: DirectAllowlistSubject): DirectAssetUsageLease {
  const lease = validateDirectAssetUsageLease(value);
  const reservation = lease.reservation, id = identity(subject);
  if (lease.profile !== subject.profile || reservation.state !== "reserved" || reservation.policyDigest !== binding.policyDigest ||
      reservation.amountAtomic !== subject.amountAtomic || canonicalJson(identity(reservation)) !== canonicalJson(id) ||
      reservation.reservationId !== assetUsageReservationId(id, directUsageKey(subject.operationId))) {
    corrupt("The direct usage lease does not bind this operation.");
  }
  return lease;
}

export function publicDirectAllowlist(binding: DirectAllowlistBinding, lease: DirectAssetUsageLease | undefined): unknown {
  return { schema_version: binding.schemaVersion, rail: "direct", policy_digest: binding.policyDigest,
    policy_revision: binding.policyRevision, reservation_id: lease?.reservation.reservationId ?? null };
}

function evaluate(active: ActiveAssetPolicy, subject: DirectAllowlistSubject, dailyUsageAtomic: string, now: Date): AssetPolicyAdmission {
  const registry = active.registry, at = now.toISOString();
  if (registry.expiresAt !== undefined && at >= registry.expiresAt) {
    refuse("allowlist_policy_expired", "The active owner allowlist policy has expired; stage and activate a new revision.");
  }
  if (registry.effectiveAt !== undefined && at < registry.effectiveAt) {
    refuse("allowlist_policy_not_effective", "The active owner allowlist policy is not effective yet.", { effective_at: registry.effectiveAt });
  }
  const row = registry.chains.find((chain) => chain.chain === subject.chain)?.assets
    .find((asset) => asset.kind === subject.asset.kind && asset.identifier === subject.asset.identifier);
  const caps = row === undefined || !row.rails.direct ? undefined
    : registry.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? row.railCaps?.direct : row.caps;
  if (caps === undefined) {
    refuse("allowlist_direct_not_admitted", "The active owner allowlist policy does not admit this asset on the direct rail.",
      { chain: subject.chain, asset: subject.asset.identifier ?? "native" });
  }
  const amount = BigInt(subject.amountAtomic), usage = BigInt(dailyUsageAtomic);
  if (amount > BigInt(caps.maximumPerTransferAtomic)) {
    refuse("allowlist_per_transfer_cap_exceeded", "The transfer exceeds the owner's per-operation cap for this asset.",
      { maximum_per_transfer_atomic: caps.maximumPerTransferAtomic, amount_atomic: subject.amountAtomic });
  }
  if (usage + amount > BigInt(caps.dailyLimitAtomic)) {
    refuse("allowlist_daily_cap_exceeded", "The transfer exceeds the owner's daily cap for this asset given today's usage.",
      { daily_limit_atomic: caps.dailyLimitAtomic, daily_usage_atomic: dailyUsageAtomic, amount_atomic: subject.amountAtomic });
  }
  return evaluateAssetPolicy(registry, { chain: subject.chain, asset: subject.asset, rail: "direct", amountAtomic: subject.amountAtomic,
    dailyUsageAtomic, asOfDate: at.slice(0, 10), asOf: at });
}

function identity(value: AssetUsageIdentity): AssetUsageIdentity {
  return { account: value.account, chain: value.chain, asset: value.asset.kind === "native"
    ? { kind: "native", identifier: null } : { kind: "token", identifier: value.asset.identifier } };
}
export function refuse(reason: DirectAllowlistRefusal, message: string, details: Readonly<Record<string, string | readonly string[]>> = {}): never {
  throw new ApnError("APN_ALLOWLIST_REFUSED", message, { reason, rail: "direct", ...details });
}
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
