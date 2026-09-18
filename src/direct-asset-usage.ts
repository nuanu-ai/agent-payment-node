import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "./canonical.js";
import { evaluateAssetPolicy, validateAssetPolicyRegistry } from "./asset-policy-registry.js";
import {
  AssetUsageLedger,
  validateAssetUsageReservation,
  type AssetUsageIdentity,
  type AssetUsageReservation,
} from "./asset-usage-ledger.js";
import { ApnError } from "./errors.js";
import { canonicalProfile } from "./wallet-policy.js";

export const DIRECT_ASSET_USAGE_LEASE_SCHEMA = "apn.direct-asset-usage-lease.v1" as const;
const LEASE_DIGEST_DOMAIN = DIRECT_ASSET_USAGE_LEASE_SCHEMA;

export interface DirectAssetUsageInput extends AssetUsageIdentity {
  readonly registry: unknown;
  readonly profile: string;
  readonly rail: "direct";
  readonly amountAtomic: string;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export interface DirectAssetUsageLease {
  readonly schemaVersion: typeof DIRECT_ASSET_USAGE_LEASE_SCHEMA;
  readonly profile: string;
  readonly rail: "direct";
  readonly reservation: AssetUsageReservation;
  readonly leaseDigest: string;
}

/**
 * Dormant integration boundary for direct money rails. A caller must enter through
 * `withReservationBeforeEffect` before signing locally or invoking an atomic provider send.
 * The owning rail remains responsible for persisting this lease with its operation journal.
 */
export class DirectAssetUsageAdapter {
  constructor(private readonly ledger: AssetUsageLedger) {}

  async reserve(input: DirectAssetUsageInput): Promise<DirectAssetUsageLease> {
    const profile = canonicalProfile(input.profile);
    if (input.rail !== "direct") invalid("The direct usage adapter accepts only the direct rail.");
    const registry = structuredClone(validateAssetPolicyRegistry(input.registry));
    const at = instant(input.now);
    const now = new Date(at);
    const admission = evaluateAssetPolicy(registry, {
      chain: input.chain,
      asset: input.asset,
      rail: "direct",
      amountAtomic: input.amountAtomic,
      dailyUsageAtomic: "0",
      asOfDate: at.slice(0, 10),
      // Overlay registries carry exact effective/expiry instants; the evaluator refuses them without this instant.
      asOf: at,
    });
    const reservation = await this.ledger.reserve({
      account: input.account,
      chain: input.chain,
      asset: input.asset,
      registry,
      rail: "direct",
      amountAtomic: input.amountAtomic,
      idempotencyKey: input.idempotencyKey,
      now,
    });
    if (reservation.policyDigest !== admission.policyDigest || reservation.registryVersion !== admission.registryVersion ||
        reservation.chain !== admission.chain || reservation.rail !== admission.rail ||
        reservation.amountAtomic !== admission.amountAtomic ||
        canonicalJson(reservation.asset) !== canonicalJson(assetIdentity(admission.asset))) {
      corrupt("The direct usage reservation differs from the evaluated policy admission.");
    }
    return sealLease({ schemaVersion: DIRECT_ASSET_USAGE_LEASE_SCHEMA, profile, rail: "direct", reservation });
  }

  async withReservationBeforeEffect<T>(
    input: DirectAssetUsageInput,
    effect: (lease: DirectAssetUsageLease) => Promise<T>,
  ): Promise<{ readonly lease: DirectAssetUsageLease; readonly result: T }> {
    const lease = await this.reserve(input);
    if (lease.reservation.state !== "reserved") {
      blocked("A replayed direct reservation that already crossed a durable transition cannot invoke the effect callback.");
    }
    return { lease, result: await effect(structuredClone(lease)) };
  }

  async failedBeforeEffect(leaseValue: unknown, now: Date, outcomeDigest: string): Promise<DirectAssetUsageLease> {
    const lease = validateDirectAssetUsageLease(leaseValue);
    if (lease.reservation.state !== "reserved" && lease.reservation.state !== "failed_before_effect") {
      blocked("Only a direct reservation that has not crossed the effect boundary can be released.");
    }
    return await this.transition(lease, "failed_before_effect", now, outcomeDigest, ["reserved", "failed_before_effect"]);
  }

  async submitted(leaseValue: unknown, now: Date): Promise<DirectAssetUsageLease> {
    return await this.transition(leaseValue, "submitted", now);
  }

  async unknownFinality(leaseValue: unknown, now: Date): Promise<DirectAssetUsageLease> {
    return await this.transition(leaseValue, "unknown_finality", now);
  }

  async finalized(leaseValue: unknown, now: Date, outcomeDigest: string): Promise<DirectAssetUsageLease> {
    return await this.transition(leaseValue, "finalized", now, outcomeDigest);
  }

  private async transition(
    leaseValue: unknown,
    state: "failed_before_effect" | "submitted" | "unknown_finality" | "finalized",
    now: Date,
    outcomeDigest?: string,
    expectedCurrentStates?: readonly AssetUsageReservation["state"][],
  ): Promise<DirectAssetUsageLease> {
    const lease = validateDirectAssetUsageLease(leaseValue);
    const reservation = await this.ledger.transition({
      account: lease.reservation.account,
      chain: lease.reservation.chain,
      asset: lease.reservation.asset,
      reservationId: lease.reservation.reservationId,
      policyDigest: lease.reservation.policyDigest,
      state,
      now,
      ...(outcomeDigest === undefined ? {} : { outcomeDigest }),
      ...(expectedCurrentStates === undefined ? {} : { expectedCurrentStates }),
    });
    return sealLease({
      schemaVersion: DIRECT_ASSET_USAGE_LEASE_SCHEMA,
      profile: lease.profile,
      rail: "direct",
      reservation,
    });
  }
}

export function validateDirectAssetUsageLease(value: unknown): DirectAssetUsageLease {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profile", "rail", "reservation", "leaseDigest"]) ||
      value.schemaVersion !== DIRECT_ASSET_USAGE_LEASE_SCHEMA || value.rail !== "direct") {
    corrupt("The direct usage lease schema is invalid.");
  }
  let profile: string;
  try { profile = canonicalProfile(value.profile); }
  catch { return corrupt("The direct usage lease profile is invalid."); }
  const reservation = validateAssetUsageReservation(value.reservation);
  if (reservation.rail !== "direct") corrupt("The direct usage lease contains a non-direct reservation.");
  const body = { schemaVersion: DIRECT_ASSET_USAGE_LEASE_SCHEMA, profile, rail: "direct" as const, reservation };
  if (typeof value.leaseDigest !== "string" || domainHash(LEASE_DIGEST_DOMAIN, canonicalJson(body)) !== value.leaseDigest) {
    corrupt("The direct usage lease digest is invalid.");
  }
  return value as unknown as DirectAssetUsageLease;
}

function sealLease(body: Omit<DirectAssetUsageLease, "leaseDigest">): DirectAssetUsageLease {
  return validateDirectAssetUsageLease({ ...body, leaseDigest: domainHash(LEASE_DIGEST_DOMAIN, canonicalJson(body)) });
}

function assetIdentity(asset: { readonly kind: "native" | "token"; readonly identifier: string | null }): AssetUsageIdentity["asset"] {
  return asset.kind === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: asset.identifier! };
}

function instant(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) invalid("The direct usage evaluation instant is invalid.");
  return value.toISOString();
}
function invalid(message: string): never { throw new ApnError("APN_INVALID_INPUT", message); }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
