import type { AssetPolicyRegistry } from "../../asset-policy-registry.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { type SwapOperationRecord } from "../model.js";
import type { HistoricalJupiterProjection } from "./historical-projection-reader.js";
import { type HistoricalRetirementPolicyAdmission } from "./historical-retirement-policy.js";
export declare const HISTORICAL_RETIREMENT_NAMESPACE = "jupiter-historical-retirements";
export declare const HISTORICAL_RETIREMENT_SCHEMA: "apn.jupiter-historical-retirement.v1";
export declare const HISTORICAL_RETIREMENT_IDENTITY: AssetUsageIdentity;
/** Structural public witness contract. PART A's pure witness cannot issue economic authority. */
export interface HistoricalRetirementCanonicalWitness {
    readonly schemaVersion: "apn.jupiter-canonical-future-invalidity.v1";
    readonly scope: "blockhash_future_invalidity_only";
    readonly outcome: "future_invalidity_witness";
    readonly inputHash: string;
    readonly transactionHash: string;
    readonly messageHash: string;
    readonly signatureHash: string;
    readonly blockhash: string;
    readonly quoteContextSlot: string;
    readonly searchedStartSlot: string;
    readonly birth: {
        readonly slot: string;
        readonly blockHeight: string;
        readonly blockhash: string;
    };
    readonly finalizedAnchor: {
        readonly slot: string;
        readonly blockHeight: string;
        readonly blockhash: string;
    };
    readonly processingAge: {
        readonly documentedMaximumProcessingAge: 150;
        readonly requiredConservativeFinalizedHeight: string;
    };
    readonly quoteLastValidBlockHeight: string | null;
    readonly providers: readonly {
        readonly originHash: string;
        readonly finalizedSlot: string;
        readonly finalizedBlockHeight: string;
        readonly isBlockhashValid: false;
        readonly signatureStatusObservation: "not_reported";
        readonly readCount: number;
    }[];
    readonly resultHash: string;
}
export interface HistoricalRetirementCurrentPolicy {
    readonly registry: AssetPolicyRegistry;
    readonly activationDigest: string;
    readonly revision: number;
    readonly activatedAt: string;
}
/** Immutable economic record DTO; callers cannot turn this object into private commit permission. */
export interface HistoricalRetirementRecord {
    readonly schemaVersion: typeof HISTORICAL_RETIREMENT_SCHEMA;
    readonly kind: "retired_unknown";
    readonly operationId: string;
    readonly ownerProfileHash: string;
    readonly rootSnapshotHash: string;
    readonly bucketHash: string;
    readonly originalOperation: SwapOperationRecord;
    readonly originalReservationRawHash: string;
    readonly authentication: HistoricalJupiterProjection;
    readonly canonicalProof: HistoricalRetirementCanonicalWitness;
    readonly currentPolicy: HistoricalRetirementCurrentPolicy;
    readonly policyAdmission: HistoricalRetirementPolicyAdmission;
    readonly accountingAt: string;
    readonly conservativeTotalAtomic: "6000000";
    readonly additionalAdmissionAtomic: "5000000";
    readonly historicalOutcome: "unknown";
    readonly transactionMayHaveBeenSubmitted: true;
    readonly actualNativeFeeAtomic: null;
    readonly effectAt: null;
    readonly recordHash: string;
}
export declare function historicalRetirementBucketHash(): string;
export declare function hashBucket(identity: AssetUsageIdentity): string;
/** Pure sealing is useful for codec fixtures and does not grant permission to persist it. */
export declare function sealHistoricalRetirementRecord(body: Omit<HistoricalRetirementRecord, "recordHash">): HistoricalRetirementRecord;
export declare function validateHistoricalRetirementRecord(value: unknown): HistoricalRetirementRecord;
export declare function assertHistoricalRetirementBindings(record: HistoricalRetirementRecord, rootSnapshotHash: string, operation: SwapOperationRecord | null, reservation: AssetUsageReservation | undefined, originalRowRawHash: string): void;
export declare function sameIdentity(a: AssetUsageIdentity, b: AssetUsageIdentity): boolean;
/** Replace only exact original holds. No actual spend/finality claim is derived from this projection. */
export declare function historicalRetirementUsage(records: readonly AssetUsageReservation[], retirements: readonly HistoricalRetirementRecord[], now: Date): string;
