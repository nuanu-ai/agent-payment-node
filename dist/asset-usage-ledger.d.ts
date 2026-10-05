import { type AssetPolicyRail } from "./asset-policy-registry.js";
import { SecureStateStore } from "./secure-state-store.js";
import { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW } from "./asset-usage-ledger-record.js";
export { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW, assetUsageReservationId, validateAssetUsageReservation } from "./asset-usage-ledger-record.js";
export type AssetUsageState = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect"
/** Payment was never submitted and a terminal proof closes any earlier authorization exposure. */
 | "released_unsubmitted"
/** A sent effect that is proven reverted at a finalized block releases its principal. */
 | "failed_confirmed_revert";
export interface AssetUsageIdentity {
    /** Stable canonical identity for the paying account; aliases must be resolved by the caller. */
    readonly account: string;
    readonly chain: string;
    readonly asset: Readonly<{
        kind: "native";
        identifier: null;
    } | {
        kind: "token";
        identifier: string;
    }>;
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
    readonly mechanism?: Readonly<{
        provider: string;
        reference: string;
    }>;
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
/** Permit2 production only: caller durably proved no authorization exposure before cancellation. */
export interface CancelUnsubmittedReservationInput extends AssetUsageIdentity {
    readonly chain: "eip155:43114";
    readonly asset: {
        readonly kind: "token";
        readonly identifier: string;
    };
    readonly idempotencyKey: `x402-permit2-production.v2:${string}`;
    readonly policyDigest: string;
    readonly registryVersion: string;
    readonly rail: "x402";
    readonly amountAtomic: string;
    readonly outcomeDigest: string;
    readonly now: Date;
}
export interface AssetUsageSnapshot {
    readonly windowPolicy: typeof ASSET_USAGE_WINDOW;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly amountAtomic: string;
}
/**
 * Durable common usage ledger for all admitted rails. Money-rail owners reserve here while holding
 * no other state lock, then persist their own operation under their existing lock discipline.
 */
export declare class AssetUsageLedger extends SecureStateStore {
    private initialized;
    /** Relay and this ledger hash idempotency keys in separate domains. Hold the
     * exact source asset bucket lock through the caller's retirement write. */
    withNoMatchingRelayReservation<T>(account: string, policyDigest: string | undefined, amountAtomic: string, action: () => Promise<T>, sourceChainId?: 1 | 56, allowFailedBeforeEffectReservationId?: string): Promise<T>;
    reserve(input: AssetUsageReserveInput): Promise<AssetUsageReservation>;
    transition(input: AssetUsageTransitionInput): Promise<AssetUsageReservation>;
    /** Atomic cancellation in the existing schema; a delayed reserve can only replay the released row. */
    cancelUnsubmittedReservation(input: CancelUnsubmittedReservationInput): Promise<AssetUsageReservation>;
    usage(identityValue: AssetUsageIdentity, now: Date): Promise<AssetUsageSnapshot>;
    /** Existing-ledger snapshot for nonpersistent preflight; never initializes, locks, or creates a bucket. */
    usageReadOnly(identityValue: AssetUsageIdentity, now: Date): Promise<AssetUsageSnapshot>;
    /** Read the daily total and one reservation from the same locked bucket snapshot. */
    usageWithReservation(identityValue: AssetUsageIdentity, reservationIdValue: string, now: Date): Promise<{
        snapshot: AssetUsageSnapshot;
        reservation: AssetUsageReservation | null;
    }>;
    load(identityValue: AssetUsageIdentity, reservationIdValue: string): Promise<AssetUsageReservation | null>;
    private ready;
    private loadBucket;
    private bucketDirectory;
    private recordPath;
    private bucketLock;
}
