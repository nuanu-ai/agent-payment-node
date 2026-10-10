import { type VerifiedCleanup85NativeReservation, type VerifiedCleanup85NativeSettlement } from "./circle-cleanup85-native-ledger-authority.js";
import type { MerchantOperation, MerchantReceipt } from "./x402-merchant/model.js";
import { SecureStateStore } from "./secure-state-store.js";
export { ASSET_USAGE_RESERVATION_SCHEMA, ASSET_USAGE_WINDOW, assetUsageReservationId, validateAssetUsageReservation } from "./asset-usage-ledger-record.js";
import type { AssetUsageIdentity, AssetUsageReservation, AssetUsageReserveInput, AssetUsageTransitionInput, CancelUnsubmittedReservationInput, AssetUsageSnapshot } from "./asset-usage-ledger-types.js";
export type { AssetUsageState, AssetUsageIdentity, AssetUsageReservation, AssetUsageReserveInput, AssetUsageTransitionInput, CancelUnsubmittedReservationInput, AssetUsageSnapshot } from "./asset-usage-ledger-types.js";
/**
 * Durable common usage ledger for all admitted rails. Money-rail owners reserve here while holding
 * no other state lock, then persist their own operation under their existing lock discipline.
 */
export declare class AssetUsageLedger extends SecureStateStore {
    private initialized;
    /** Relay and this ledger hash idempotency keys in separate domains. Hold the
     * exact source asset bucket lock through the caller's retirement write. */
    withNoMatchingRelayReservation<T>(account: string, policyDigest: string | undefined, amountAtomic: string, action: () => Promise<T>, sourceChainId?: 1 | 56 | 8453, allowFailedBeforeEffectReservationId?: string): Promise<T>;
    reserve(input: AssetUsageReserveInput): Promise<AssetUsageReservation>;
    reserveMetaMaskNative(operationId: string, kind: "native" | "token", now: Date): Promise<AssetUsageReservation>;
    reserveCleanup85Native(authority: VerifiedCleanup85NativeReservation, now: Date): Promise<AssetUsageReservation>;
    private reserveBound;
    /** Direct pre-private recovery: hold the exact reservation through its durable outcome and release.
     * The callback must not acquire this bucket lock. Its owning profile/operation/custody locks remain held. */
    releaseDirectReservedAfter<T>(expectedValue: AssetUsageReservation, persistOutcome: () => Promise<{
        value: T;
        now: Date;
        outcomeDigest: string;
    }>): Promise<T>;
    transition(input: AssetUsageTransitionInput): Promise<AssetUsageReservation>;
    /** Exact root-owned cleanup85 cancellation only; public projections are never authority. */
    settleCleanup85Native(authority: VerifiedCleanup85NativeSettlement, now: Date): Promise<AssetUsageReservation>;
    /** Finite Mega merchant headroom only: metadata cannot mint this canonical receipt authority. */
    settleMerchantNativeActualFee(o: MerchantOperation, receipt: MerchantReceipt, now: Date): Promise<AssetUsageReservation>;
    /** Static normal-owner canonical proof; public DTOs cannot release capacity. */
    settleMetaMaskNativeActual(operationId: string, now: Date): Promise<void>;
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
    /** Central existing-record projection shared by reserve admission and every usage reader. */
    private sumBucketUsage;
    private bucketDirectory;
    private recordPath;
    private bucketLock;
}
