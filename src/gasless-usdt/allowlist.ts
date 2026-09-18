import { canonicalJson } from "../canonical.js";
import { loadActiveAssetPolicyRegistry, type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import { ASSET_POLICY_REGISTRY_SCHEMA_V2 } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity, type AssetUsageReservation } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import type { ClockPort } from "../ports.js";
import { USDT_GASLESS } from "./model.js";

export const USDT_GASLESS_ALLOWLIST_SCHEMA = "apn.gasless-usdt-allowlist.v1" as const;

/** Frozen at prepare: the exact owner revision, and the caps and usage it admitted the transfer under. */
export interface UsdtGaslessAdmission {
  readonly schemaVersion: typeof USDT_GASLESS_ALLOWLIST_SCHEMA;
  readonly policyDigest: string;
  readonly policyRevision: number;
  readonly maximumPerTransferAtomic: string;
  readonly dailyLimitAtomic: string;
  readonly dailyUsageAtomic: string;
}

export interface UsdtGaslessSubject {
  readonly profile: string;
  readonly operationId: string;
  /** Checksummed EVM owner account; the policy's `accounts.evm` must name it. */
  readonly account: string;
  /** Gross: the most this operation can debit (N + F). The ledger counts it, not the net. */
  readonly grossAtomic: string;
}

export type UsdtGaslessUsageTarget = "submitted" | "unknown_finality" | "finalized" | "failed_before_effect";

export function usdtGaslessUsageKey(operationId: string): string { return `apn.gasless-usdt-usage:${operationId}`; }

/**
 * Gate for rail `gasless` on USDT/Ethereum. The active owner policy must admit the asset on this rail with exactly the
 * pinned `{provider, reference}` mechanism, and the gross must fit the per-operation cap and today's shared usage.
 */
export class UsdtGaslessAllowlistGate {
  private readonly ledger: AssetUsageLedger;
  constructor(private readonly context: { readonly state: { readonly root: string }; readonly clock: ClockPort }) {
    this.ledger = new AssetUsageLedger(context.state.root);
  }

  async admit(subject: UsdtGaslessSubject): Promise<UsdtGaslessAdmission> {
    const active = await this.active(subject), now = this.context.clock.now();
    const usage = (await this.ledger.usage(identity(subject), now)).amountAtomic;
    return evaluate(active, subject, usage);
  }

  /** Approval, before any signature: the same revision must still be active; a replayed approval never reserves twice. */
  async reserve(subject: UsdtGaslessSubject, admission: UsdtGaslessAdmission): Promise<AssetUsageReservation> {
    const active = await this.active(subject);
    if (active.digest !== admission.policyDigest || active.revision !== admission.policyRevision) {
      refuse("allowlist_policy_changed", "The active owner allowlist policy changed after preparation; prepare a new transfer.");
    }
    const now = this.context.clock.now(), existing = await this.existing(subject);
    if (existing === null) evaluate(active, subject, (await this.ledger.usage(identity(subject), now)).amountAtomic);
    else if (existing.state !== "reserved") blocked("The gasless usage reservation already crossed a durable transition.");
    const reservation = await this.ledger.reserve({ ...identity(subject), registry: active.registry, rail: "gasless",
      amountAtomic: subject.grossAtomic, idempotencyKey: usdtGaslessUsageKey(subject.operationId), now });
    if (reservation.state !== "reserved") blocked("The gasless usage reservation already crossed a durable transition.");
    return reservation;
  }

  /** Move the ledger forward with the operation journal; idempotent so each observation can repair a lagging ledger. */
  async follow(subject: UsdtGaslessSubject, target: UsdtGaslessUsageTarget, outcomeDigest: string): Promise<void> {
    const current = await this.existing(subject);
    if (current === null) {
      if (target === "failed_before_effect") return;
      throw new ApnError("APN_STATE_CORRUPT", "The operation names a gasless usage reservation that the ledger does not hold.");
    }
    if (current.state === target) return;
    if (["finalized", "failed_before_effect"].includes(current.state)) {
      throw new ApnError("APN_STATE_CORRUPT", "The gasless usage reservation reached a different terminal state than its operation.");
    }
    if (target === "failed_before_effect" && current.state !== "reserved") {
      throw new ApnError("APN_STATE_CORRUPT", "A gasless usage reservation past the send marker cannot be released before effect.");
    }
    const move = async (state: UsdtGaslessUsageTarget, withOutcome: boolean) => await this.ledger.transition({ ...identity(subject),
      reservationId: current.reservationId, policyDigest: current.policyDigest, state, now: this.context.clock.now(),
      ...(withOutcome ? { outcomeDigest } : {}) });
    if (target === "finalized" && current.state === "reserved") await move("submitted", false);
    await move(target, target === "finalized" || target === "failed_before_effect");
  }

  private async existing(subject: UsdtGaslessSubject): Promise<AssetUsageReservation | null> {
    const id = identity(subject);
    return await this.ledger.load(id, assetUsageReservationId(id, usdtGaslessUsageKey(subject.operationId)));
  }

  private async active(subject: UsdtGaslessSubject): Promise<ActiveAssetPolicy> {
    let active: ActiveAssetPolicy | null;
    try { active = await loadActiveAssetPolicyRegistry(this.context, subject.profile); }
    catch (error) {
      if (error instanceof ApnError && error.details?.reason === "allowlist_policy_expired") {
        refuse("allowlist_policy_expired", "The active owner allowlist policy has expired; stage and activate a new revision.");
      }
      throw error;
    }
    if (active === null) refuse("allowlist_policy_required", "Gasless USDT requires an owner-activated allowlist policy for this profile.");
    if (active.accounts.evm !== subject.account) {
      refuse("allowlist_account_mismatch", "The active owner allowlist policy names a different EVM owner account.");
    }
    return active;
  }
}

function evaluate(active: ActiveAssetPolicy, subject: UsdtGaslessSubject, dailyUsageAtomic: string): UsdtGaslessAdmission {
  const registry = active.registry;
  const row = registry.chains.find((chain) => chain.chain === USDT_GASLESS.chain)?.assets
    .find((asset) => asset.kind === "token" && asset.identifier === USDT_GASLESS.token);
  const caps = row === undefined || !row.rails.gasless ? undefined
    : registry.schemaVersion === ASSET_POLICY_REGISTRY_SCHEMA_V2 ? row.railCaps?.gasless : row.caps;
  if (row === undefined || caps === undefined) {
    refuse("allowlist_gasless_not_admitted", "The active owner allowlist policy does not admit USDT on Ethereum on the gasless rail.");
  }
  if (canonicalJson(row.mechanismPins?.gasless ?? null) !== canonicalJson(USDT_GASLESS.mechanism)) {
    refuse("allowlist_mechanism_mismatch", "The gasless admission must pin exactly this sponsor mechanism.",
      { provider: USDT_GASLESS.mechanism.provider, reference: USDT_GASLESS.mechanism.reference });
  }
  const gross = BigInt(subject.grossAtomic), usage = BigInt(dailyUsageAtomic);
  if (gross > BigInt(caps.maximumPerTransferAtomic)) {
    refuse("allowlist_per_transfer_cap_exceeded", "The gross amount exceeds the owner's per-operation gasless cap for USDT.");
  }
  if (usage + gross > BigInt(caps.dailyLimitAtomic)) {
    refuse("allowlist_daily_cap_exceeded", "The gross amount exceeds the owner's daily cap for USDT given today's usage.");
  }
  return { schemaVersion: USDT_GASLESS_ALLOWLIST_SCHEMA, policyDigest: active.digest, policyRevision: active.revision,
    maximumPerTransferAtomic: caps.maximumPerTransferAtomic, dailyLimitAtomic: caps.dailyLimitAtomic, dailyUsageAtomic };
}

function identity(subject: Pick<UsdtGaslessSubject, "account">): AssetUsageIdentity {
  return { account: subject.account, chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token } };
}
function refuse(reason: string, message: string, details: Readonly<Record<string, string>> = {}): never {
  throw new ApnError("APN_ALLOWLIST_REFUSED", message, { reason, rail: "gasless", ...details });
}
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
