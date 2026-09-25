import { type AssetPolicyRail } from "./asset-policy-registry.js";
import { SecureStateStore } from "./secure-state-store.js";
export declare const ASSET_USAGE_RESERVATION_SCHEMA: "apn.asset-usage-reservation.v1";
/** Existing chain-policy convention: [00:00:00.000Z, next 00:00:00.000Z). */
export declare const ASSET_USAGE_WINDOW: "utc-calendar-day";
export type AssetUsageState = "reserved" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect"
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
    readonly state: AssetUsageState;
    readonly reservedAt: string;
    readonly updatedAt: string;
    /** Set only when a terminal effect is finalized. */
    readonly effectAt: string | null;
    /** Required terminal proof binding; the proof itself remains in the owning rail. */
    readonly outcomeDigest: string | null;
    readonly reservationDigest: string;
}
export interface AssetUsageReserveInput extends AssetUsageIdentity {
    readonly registry: unknown;
    readonly rail: AssetPolicyRail;
    readonly amountAtomic: string;
    readonly idempotencyKey: string;
    readonly now: Date;
}
export interface AssetUsageTransitionInput extends AssetUsageIdentity {
    readonly reservationId: string;
    readonly policyDigest: string;
    readonly state: Exclude<AssetUsageState, "reserved">;
    readonly now: Date;
    readonly outcomeDigest?: string;
    /** Optional compare-and-transition guard, checked atomically while the bucket lock is held. */
    readonly expectedCurrentStates?: readonly AssetUsageState[];
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
    /** Relay and this ledger hash idempotency keys in separate domains. Match the
     * available policy and payment identity conservatively before retirement. */
    hasMatchingRelayReservation(account: string, policyDigest: string | undefined, amountAtomic: string): Promise<boolean>;
    reserve(input: AssetUsageReserveInput): Promise<AssetUsageReservation>;
    transition(input: AssetUsageTransitionInput): Promise<AssetUsageReservation>;
    usage(identityValue: AssetUsageIdentity, now: Date): Promise<AssetUsageSnapshot>;
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
/** The reservation id that `reserve` creates or replays for this exact identity and idempotency key. */
export declare function assetUsageReservationId(identityValue: AssetUsageIdentity, idempotencyKey: string): string;
export declare function validateAssetUsageReservation(value: unknown): AssetUsageReservation;
