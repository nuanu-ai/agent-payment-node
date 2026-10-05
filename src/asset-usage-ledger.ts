import { getAddress } from "viem";
import { canonicalJson, domainHash } from "./canonical.js";
import {
  evaluateAssetPolicy,
  validateAssetPolicyRegistry,
  type AssetPolicyRail,
} from "./asset-policy-registry.js";
import { SecureStateStore } from "./secure-state-store.js";

import { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW, validateAssetUsageReservation,
  expectedStates, reservationIdFor, seal, sumUsage, assertReplay, assertBucketWindow, assertTransition,
  validateIdentity, exactIdentity, exactAsset, withoutDigest, canonicalAccount, idempotency, atomic, instant, digest, invalid, blocked, corrupt,
} from "./asset-usage-ledger-record.js";
export { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW, assetUsageReservationId, validateAssetUsageReservation } from "./asset-usage-ledger-record.js";

export type AssetUsageState =
  | "reserved"
  | "submitted"
  | "unknown_finality"
  | "finalized"
  | "failed_before_effect"
  /** Payment was never submitted and a terminal proof closes any earlier authorization exposure. */
  | "released_unsubmitted"
  /** A sent effect that is proven reverted at a finalized block releases its principal. */
  | "failed_confirmed_revert";

export interface AssetUsageIdentity {
  /** Stable canonical identity for the paying account; aliases must be resolved by the caller. */
  readonly account: string;
  readonly chain: string;
  readonly asset: Readonly<{ kind: "native"; identifier: null } | { kind: "token"; identifier: string }>;
}

export interface AssetUsageReservation extends AssetUsageIdentity {
  readonly schemaVersion: typeof ASSET_USAGE_RESERVATION_SCHEMA;
  readonly reservationId: string;
  readonly idempotencyHash: string;
  readonly policyDigest: string;
  readonly registryVersion: string;
  readonly rail: AssetPolicyRail;
  readonly amountAtomic: string;
  /** Proven asset consumption on a confirmed revert; absent on historical zero-consumption records. */
  readonly consumedAtomic?: string;
  readonly state: AssetUsageState;
  readonly reservedAt: string;
  readonly updatedAt: string;
  /** Set when a finalized effect or proven reverted consumption is charged to a UTC day. */
  readonly effectAt: string | null;
  /** Required terminal proof binding; the proof itself remains in the owning rail. */
  readonly outcomeDigest: string | null;
  readonly reservationDigest: string;
}

export interface AssetUsageReserveInput extends AssetUsageIdentity {
  readonly registry: unknown;
  readonly rail: AssetPolicyRail;
  readonly mechanism?: Readonly<{ provider: string; reference: string }>;
  readonly amountAtomic: string;
  readonly idempotencyKey: string;
  readonly now: Date;
  /** Relay-only recovery: caller has proved no journal, signing marker, custody bytes, or send risk. */
  readonly retryFailedBeforeEffect?: boolean;
}

export interface AssetUsageTransitionInput extends AssetUsageIdentity {
  readonly reservationId: string;
  readonly policyDigest: string;
  readonly state: Exclude<AssetUsageState, "reserved">;
  readonly now: Date;
  readonly outcomeDigest?: string;
  /** Exact asset consumed on a confirmed revert, such as a gasless USDC fee. */
  readonly consumedAtomic?: string;
  /** Optional compare-and-transition guard, checked atomically while the bucket lock is held. */
  readonly expectedCurrentStates?: readonly AssetUsageState[];
}

export interface AssetUsageSnapshot {
  readonly windowPolicy: typeof ASSET_USAGE_WINDOW;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly amountAtomic: string;
}

type ReservationBody = Omit<AssetUsageReservation, "reservationDigest">;

/**
 * Durable common usage ledger for all admitted rails. Money-rail owners reserve here while holding
 * no other state lock, then persist their own operation under their existing lock discipline.
 */
export class AssetUsageLedger extends SecureStateStore {
  private initialized: Promise<void> | undefined;

  /** Relay and this ledger hash idempotency keys in separate domains. Hold the
   * exact source asset bucket lock through the caller's retirement write. */
  async withNoMatchingRelayReservation<T>(account: string, policyDigest: string | undefined,
    amountAtomic: string, action: () => Promise<T>, sourceChainId: 1 | 56 = 1,
    allowFailedBeforeEffectReservationId?: string): Promise<T> {
    if (policyDigest !== undefined) digest(policyDigest, "Policy digest");
    const identity = validateIdentity(sourceChainId === 56
      ? { account: getAddress(account), chain: "eip155:56", asset: { kind: "native", identifier: null } }
      : { account: getAddress(account), chain: "eip155:1",
        asset: { kind: "token", identifier: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" } });
    await this.ready();
    return this.withLocks([this.bucketLock(identity)], async () => {
      const records = await this.loadBucket(identity);
      if (records.some(record => record.rail === "bridge" &&
        (policyDigest === undefined || record.policyDigest === policyDigest) && record.amountAtomic === amountAtomic &&
        !(record.reservationId === allowFailedBeforeEffectReservationId && record.state === "failed_before_effect"))) {
        throw blocked("Relay retirement is refused because a matching usage reservation exists.");
      }
      return action();
    });
  }

  async reserve(input: AssetUsageReserveInput): Promise<AssetUsageReservation> {
    const registry = validateAssetPolicyRegistry(input.registry);
    const at = instant(input.now);
    const initial = evaluateAssetPolicy(registry, {
      chain: input.chain, asset: input.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
      amountAtomic: input.amountAtomic, dailyUsageAtomic: "0", asOfDate: at.slice(0, 10), asOf: at,
    });
    const account = canonicalAccount(initial.chain, input.account, false);
    const idempotencyHash = idempotency(input.idempotencyKey);
    const identity: AssetUsageIdentity = { account, chain: initial.chain, asset: exactAsset(initial.asset) };
    const reservationId = reservationIdFor(identity, idempotencyHash);
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => {
      const reservations = await this.loadBucket(identity);
      const existing = reservations.find((entry) => entry.reservationId === reservationId);
      if (existing !== undefined) {
        assertReplay(existing, initial.policyDigest, initial.registryVersion, input.rail, initial.amountAtomic, idempotencyHash);
        if (input.retryFailedBeforeEffect === true && existing.state === "failed_before_effect") {
          assertBucketWindow(reservations, at);
          const usage = sumUsage(reservations, input.now);
          evaluateAssetPolicy(registry, {
            chain: identity.chain, asset: identity.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
            amountAtomic: initial.amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10), asOf: at,
          });
          const reopened = seal({ ...withoutDigest(existing), state: "reserved", reservedAt: at, updatedAt: at,
            effectAt: null, outcomeDigest: null });
          await this.writeJson(this.recordPath(identity, reservationId), reopened);
          return reopened;
        }
        return existing;
      }
      assertBucketWindow(reservations, at);
      const usage = sumUsage(reservations, input.now);
      evaluateAssetPolicy(registry, {
        chain: identity.chain, asset: identity.asset, rail: input.rail, ...(input.mechanism === undefined ? {} : { mechanism: input.mechanism }),
        amountAtomic: initial.amountAtomic, dailyUsageAtomic: usage, asOfDate: at.slice(0, 10), asOf: at,
      });
      const body: ReservationBody = {
        schemaVersion: ASSET_USAGE_RESERVATION_SCHEMA,
        reservationId,
        idempotencyHash,
        policyDigest: initial.policyDigest,
        registryVersion: initial.registryVersion,
        ...identity,
        rail: input.rail,
        amountAtomic: initial.amountAtomic,
        state: "reserved",
        reservedAt: at,
        updatedAt: at,
        effectAt: null,
        outcomeDigest: null,
      };
      const record = seal(body);
      await this.writeJson(this.recordPath(identity, reservationId), record, true);
      return record;
    });
  }

  async transition(input: AssetUsageTransitionInput): Promise<AssetUsageReservation> {
    const identity = validateIdentity(input);
    const reservationId = digest(input.reservationId, "Reservation id");
    const policyDigest = digest(input.policyDigest, "Policy digest");
    const at = instant(input.now);
    const expectedCurrentStates = input.expectedCurrentStates === undefined
      ? undefined
      : expectedStates(input.expectedCurrentStates);
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => {
      const value = await this.readJson(this.recordPath(identity, reservationId));
      if (value === null) throw blocked("The usage reservation does not exist.");
      const current = validateAssetUsageReservation(value);
      if (current.reservationId !== reservationId || current.policyDigest !== policyDigest ||
          canonicalJson(exactIdentity(current)) !== canonicalJson(identity)) {
        throw blocked("The usage reservation binding does not match the requested transition.");
      }
      if (expectedCurrentStates !== undefined && !expectedCurrentStates.includes(current.state)) {
        throw blocked("The usage reservation is no longer in an expected source state.");
      }
      if (at < current.updatedAt) throw blocked("The usage reservation transition cannot move backward in time.");
      const terminal = input.state === "finalized" || input.state === "failed_before_effect" ||
        input.state === "released_unsubmitted" || input.state === "failed_confirmed_revert";
      const outcomeDigest = terminal ? digest(input.outcomeDigest, "Outcome digest") : null;
      const consumedAtomic = input.consumedAtomic === undefined ? undefined : atomic(input.consumedAtomic, false, true).toString();
      if (consumedAtomic !== undefined && (input.state !== "failed_confirmed_revert" ||
        BigInt(consumedAtomic) > BigInt(current.amountAtomic))) {
        throw blocked("Confirmed-revert consumption exceeds or conflicts with the reservation.");
      }
      if (current.state === input.state) {
        if (current.outcomeDigest !== outcomeDigest || current.consumedAtomic !== consumedAtomic) {
          throw blocked("The idempotent usage transition outcome does not match.");
        }
        return current;
      }
      assertTransition(current.state, input.state);
      const body: ReservationBody = {
        ...withoutDigest(current),
        state: input.state,
        updatedAt: at,
        effectAt: input.state === "finalized" || consumedAtomic !== undefined ? at : null,
        outcomeDigest,
        ...(consumedAtomic === undefined ? {} : { consumedAtomic }),
      };
      const next = seal(body);
      await this.writeJson(this.recordPath(identity, reservationId), next);
      return next;
    });
  }

  async usage(identityValue: AssetUsageIdentity, now: Date): Promise<AssetUsageSnapshot> {
    const identity = validateIdentity(identityValue);
    const at = instant(now);
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => ({
      windowPolicy: ASSET_USAGE_WINDOW,
      windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
      windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
      amountAtomic: sumUsage(await this.loadBucket(identity), now),
    }));
  }

  /** Existing-ledger snapshot for nonpersistent preflight; never initializes, locks, or creates a bucket. */
  async usageReadOnly(identityValue: AssetUsageIdentity, now: Date): Promise<AssetUsageSnapshot> {
    const identity = validateIdentity(identityValue);
    const at = instant(now);
    return {
      windowPolicy: ASSET_USAGE_WINDOW,
      windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
      windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
      amountAtomic: sumUsage(await this.loadBucket(identity, false), now),
    };
  }

  /** Read the daily total and one reservation from the same locked bucket snapshot. */
  async usageWithReservation(identityValue: AssetUsageIdentity, reservationIdValue: string, now: Date): Promise<{
    snapshot: AssetUsageSnapshot; reservation: AssetUsageReservation | null;
  }> {
    const identity = validateIdentity(identityValue);
    const reservationId = digest(reservationIdValue, "Reservation id");
    const at = instant(now);
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => {
      const records = await this.loadBucket(identity);
      return {
        snapshot: {
          windowPolicy: ASSET_USAGE_WINDOW,
          windowStart: `${at.slice(0, 10)}T00:00:00.000Z`,
          windowEnd: new Date(Date.parse(`${at.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString(),
          amountAtomic: sumUsage(records, now),
        },
        reservation: records.find(record => record.reservationId === reservationId) ?? null,
      };
    });
  }

  async load(identityValue: AssetUsageIdentity, reservationIdValue: string): Promise<AssetUsageReservation | null> {
    const identity = validateIdentity(identityValue);
    const reservationId = digest(reservationIdValue, "Reservation id");
    await this.ready();
    return await this.withLocks([this.bucketLock(identity)], async () => {
      const value = await this.readJson(this.recordPath(identity, reservationId));
      if (value === null) return null;
      const record = validateAssetUsageReservation(value);
      if (record.reservationId !== reservationId || canonicalJson(exactIdentity(record)) !== canonicalJson(identity)) {
        corrupt("A usage reservation path binding is invalid.");
      }
      return record;
    });
  }

  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("asset-usage"); })();
    await this.initialized;
  }

  private async loadBucket(identity: AssetUsageIdentity, create = true): Promise<readonly AssetUsageReservation[]> {
    const directory = this.bucketDirectory(identity);
    if (create) await this.ensureDirectory(directory);
    const entries = await this.readDirectory(directory);
    const records: AssetUsageReservation[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt("The usage ledger directory contains an invalid entry.");
      const value = await this.readJson(`${directory}/${entry.name}`);
      if (value === null) corrupt("A usage reservation disappeared during a protected read.");
      const record = validateAssetUsageReservation(value);
      if (canonicalJson(exactIdentity(record)) !== canonicalJson(identity) || `${record.reservationId}.json` !== entry.name) {
        corrupt("A usage reservation path binding is invalid.");
      }
      records.push(record);
    }
    return records;
  }

  private bucketDirectory(identity: AssetUsageIdentity): string {
    return `asset-usage/${domainHash("apn.asset-usage-bucket.v1", canonicalJson(identity))}`;
  }

  private recordPath(identity: AssetUsageIdentity, reservationId: string): string {
    return `${this.bucketDirectory(identity)}/${reservationId}.json`;
  }

  private bucketLock(identity: AssetUsageIdentity): string {
    return `asset-usage:${domainHash("apn.asset-usage-lock.v1", canonicalJson(identity))}`;
  }
}
