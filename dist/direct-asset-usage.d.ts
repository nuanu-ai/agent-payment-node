import { AssetUsageLedger, type AssetUsageIdentity, type AssetUsageReservation } from "./asset-usage-ledger.js";
export declare const DIRECT_ASSET_USAGE_LEASE_SCHEMA: "apn.direct-asset-usage-lease.v1";
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
export declare class DirectAssetUsageAdapter {
    private readonly ledger;
    constructor(ledger: AssetUsageLedger);
    reserve(input: DirectAssetUsageInput): Promise<DirectAssetUsageLease>;
    withReservationBeforeEffect<T>(input: DirectAssetUsageInput, effect: (lease: DirectAssetUsageLease) => Promise<T>): Promise<{
        readonly lease: DirectAssetUsageLease;
        readonly result: T;
    }>;
    failedBeforeEffect(leaseValue: unknown, now: Date, outcomeDigest: string): Promise<DirectAssetUsageLease>;
    submitted(leaseValue: unknown, now: Date): Promise<DirectAssetUsageLease>;
    unknownFinality(leaseValue: unknown, now: Date): Promise<DirectAssetUsageLease>;
    finalized(leaseValue: unknown, now: Date, outcomeDigest: string): Promise<DirectAssetUsageLease>;
    private transition;
}
export declare function validateDirectAssetUsageLease(value: unknown): DirectAssetUsageLease;
