import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import { AllowlistPolicyStore } from "./allowlist-policy-store.js";
import { evaluateAssetPolicy } from "./asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity } from "./asset-usage-ledger.js";
import { BASE_USDC } from "./constants.js";
import { ApnError } from "./errors.js";
import type { OperationRecord } from "./model.js";
import type { RuntimeContext } from "./runtime.js";

export const COINBASE_GASLESS_MECHANISM = {
  provider: "coinbase-agentic-wallet", reference: "awal@2.12.1:send_base_usdc:eip155:8453",
} as const;
const CHAIN = "eip155:8453";
const DIGEST = /^[a-f0-9]{64}$/u;

export interface CoinbaseGaslessAllowlistBinding {
  readonly schemaVersion: "apn.coinbase-gasless-allowlist.v1";
  readonly policyDigest: string;
  readonly policyRevision: number;
  readonly activationDigest: string;
  readonly mechanism: typeof COINBASE_GASLESS_MECHANISM;
  readonly reservationId: string;
}

const identity = (op: Pick<OperationRecord, "walletAddress">): AssetUsageIdentity => ({
  account: op.walletAddress, chain: CHAIN, asset: { kind: "token", identifier: BASE_USDC },
});
const key = (operationId: string): string => `apn.coinbase-gasless:${operationId}`;
const deny = (reason: string): never => { throw new ApnError("APN_ALLOWLIST_REFUSED", "Coinbase gasless transfer is denied by the active owner policy.", { reason, rail: "gasless" }); };
const corrupt = (): never => { throw new ApnError("APN_STATE_CORRUPT", "Coinbase gasless policy binding or usage reservation is invalid."); };

/** Caller holds the APN and allowlist profile locks for admission and first effect. */
export class CoinbaseGaslessPolicy {
  private readonly store: AllowlistPolicyStore;
  private readonly usage: AssetUsageLedger;
  constructor(private readonly context: RuntimeContext) {
    this.store = new AllowlistPolicyStore(context.state.root);
    this.usage = new AssetUsageLedger(context.state.root);
  }

  private async active(profile: string): Promise<ActiveAssetPolicy> {
    let active: ActiveAssetPolicy | null;
    try { active = activeAssetPolicyFromState(await this.store.readUnderProfileLock(profile), this.context.clock.now()); }
    catch (error) {
      if (error instanceof ApnError && error.details?.reason === "allowlist_policy_expired") deny("coinbase_allowlist_expired");
      throw error;
    }
    if (active === null) deny("coinbase_allowlist_required");
    return active!;
  }

  private admit(active: ActiveAssetPolicy, op: Pick<OperationRecord, "profile" | "walletAddress" | "recipient" | "amountAtomic">,
    dailyUsageAtomic: string): void {
    if (active.profile !== op.profile || active.accounts.evm !== op.walletAddress || active.digest !== active.registry.policyDigest) {
      deny("coinbase_allowlist_account");
    }
    const now = this.context.clock.now().toISOString();
    let admitted;
    try { admitted = evaluateAssetPolicy(active.registry, { chain: CHAIN, asset: identity(op).asset, rail: "gasless",
      amountAtomic: op.amountAtomic, dailyUsageAtomic, asOfDate: now.slice(0, 10), asOf: now }); }
    catch (error) {
      if (error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED") deny("coinbase_allowlist_caps_or_asset");
      throw error;
    }
    const pinned = admitted.asset.mechanismPins?.gasless;
    if (admitted.asset.decimals !== 6 || pinned === undefined || canonicalJson(pinned) !== canonicalJson(COINBASE_GASLESS_MECHANISM)) {
      deny("coinbase_allowlist_mechanism");
    }
    if (admitted.asset.gaslessRecipient !== op.recipient) deny("coinbase_allowlist_recipient");
  }

  async prepare(op: Pick<OperationRecord, "profile" | "walletAddress" | "recipient" | "amountAtomic" | "operationId">): Promise<CoinbaseGaslessAllowlistBinding> {
    const active = await this.active(op.profile);
    const usage = await this.usage.usage(identity(op), this.context.clock.now());
    this.admit(active, op, usage.amountAtomic);
    return { schemaVersion: "apn.coinbase-gasless-allowlist.v1", policyDigest: active.digest,
      policyRevision: active.revision, activationDigest: active.activationDigest,
      mechanism: COINBASE_GASLESS_MECHANISM, reservationId: assetUsageReservationId(identity(op), key(op.operationId)) };
  }

  async assert(op: OperationRecord): Promise<ActiveAssetPolicy> {
    const binding = validateCoinbaseGaslessAllowlist(op);
    const active = await this.active(op.profile);
    if (active.digest !== binding.policyDigest || active.revision !== binding.policyRevision ||
      active.activationDigest !== binding.activationDigest) deny("coinbase_allowlist_changed");
    const { snapshot, reservation } = await this.usage.usageWithReservation(identity(op), binding.reservationId, this.context.clock.now());
    if (reservation !== null && (reservation.policyDigest !== binding.policyDigest || reservation.amountAtomic !== op.amountAtomic ||
      reservation.rail !== "gasless" || reservation.state !== "reserved")) corrupt();
    const own = reservation === null ? 0n : BigInt(reservation.amountAtomic);
    if (own !== 0n && reservation!.reservedAt.slice(0, 10) !== snapshot.windowStart.slice(0, 10)) deny("coinbase_allowlist_day_changed");
    this.admit(active, op, (BigInt(snapshot.amountAtomic) - own).toString());
    return active;
  }

  async reserve(op: OperationRecord): Promise<void> {
    const active = await this.assert(op);
    const binding = validateCoinbaseGaslessAllowlist(op);
    const lease = await this.usage.reserve({ ...identity(op), registry: active.registry, rail: "gasless",
      mechanism: binding.mechanism, amountAtomic: op.amountAtomic, idempotencyKey: key(op.operationId), now: this.context.clock.now() });
    if (lease.reservationId !== binding.reservationId || lease.policyDigest !== binding.policyDigest || lease.state !== "reserved") corrupt();
    await this.assert(op);
  }

  /** Journal state wins after a crash. Uncertain provider effects retain the full reservation. */
  async reconcile(op: OperationRecord, recoveringStarted = false): Promise<void> {
    if (op.providerDirect?.coinbaseGasless?.allowlist === undefined) return;
    const binding = validateCoinbaseGaslessAllowlist(op);
    const lease = await this.usage.load(identity(op), binding.reservationId);
    if (lease === null) {
      if (op.state !== "awaiting_approval" && op.state !== "failed_before_effect") corrupt();
      return;
    }
    if (lease.policyDigest !== binding.policyDigest || lease.amountAtomic !== op.amountAtomic || lease.rail !== "gasless") corrupt();
    const target = op.state === "failed_before_effect" ? "failed_before_effect"
      : op.state === "completed" ? "finalized"
      : (op.state === "started" && recoveringStarted) || op.state === "ambiguous_effect" || op.state === "evidence_pending" ||
        op.state === "provider_pending" || op.state === "provider_acknowledged" ? "unknown_finality" : null;
    if (target === null || lease.state === target || (target === "unknown_finality" && lease.state === "finalized")) return;
    if (target === "failed_before_effect" && lease.state !== "reserved") corrupt();
    if (target === "finalized" && lease.state !== "reserved" && lease.state !== "unknown_finality") corrupt();
    if (target === "unknown_finality" && lease.state !== "reserved") corrupt();
    await this.usage.transition({ ...identity(op), reservationId: binding.reservationId, policyDigest: binding.policyDigest,
      state: target, now: this.context.clock.now(),
      ...(target === "finalized" || target === "failed_before_effect" ? { outcomeDigest: op.integrityHash } : {}) });
  }
}

export function validateCoinbaseGaslessAllowlist(op: OperationRecord): CoinbaseGaslessAllowlistBinding {
  const value = op.providerDirect?.coinbaseGasless?.allowlist;
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "policyDigest", "policyRevision", "activationDigest", "mechanism", "reservationId"]) ||
    value.schemaVersion !== "apn.coinbase-gasless-allowlist.v1" || typeof value.policyDigest !== "string" || !DIGEST.test(value.policyDigest) ||
    typeof value.activationDigest !== "string" || !DIGEST.test(value.activationDigest) || !Number.isSafeInteger(value.policyRevision) ||
    (value.policyRevision as number) < 1 || !isPlainRecord(value.mechanism) ||
    !exactKeys(value.mechanism, ["provider", "reference"]) || canonicalJson(value.mechanism) !== canonicalJson(COINBASE_GASLESS_MECHANISM) ||
    value.reservationId !== assetUsageReservationId(identity(op), key(op.operationId))) corrupt();
  return value as unknown as CoinbaseGaslessAllowlistBinding;
}
