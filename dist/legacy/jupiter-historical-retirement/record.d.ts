import type { AssetPolicyRegistry } from "../../asset-policy-registry.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { type SwapOperationRecord } from "../../swap/model.js";
import { HISTORICAL_SOLANA_GENESIS as SOLANA_MAINNET_GENESIS } from "./pins.js";
import { type HistoricalRetirementPolicyAdmission } from "./policy.js";
export declare const HISTORICAL_RETIREMENT_NAMESPACE = "jupiter-historical-retirements";
export declare const HISTORICAL_RETIREMENT_SCHEMA: "apn.jupiter-historical-retirement.v1";
export declare const HISTORICAL_RETIREMENT_IDENTITY: AssetUsageIdentity;
/** The `apn.jupiter-historical-authentication.v1` projection a record embeds (written by the removed authenticator). */
export interface HistoricalQuoteRpcLifetime {
    readonly source: "configured_mainnet_rpc_before_quote_freeze";
    readonly rpcOriginHash: string;
    readonly contextSlot: string;
    readonly minimumContextSlot: string;
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
}
export type HistoricalRetainedClaimEvidence = {
    readonly kind: "retained_send_claim_present";
    readonly claimHash: string;
    readonly signedMarkerSnapshotHash: string;
} | {
    readonly kind: "retained_send_claim_absent";
    readonly observation: "current_observation";
    readonly submissionHistory: "unknown";
    readonly transactionMayHaveBeenSubmitted: true;
    readonly absenceSnapshotHash: string;
    readonly signedMarkerSnapshotHash: string;
};
export interface HistoricalJupiterProjection {
    readonly schemaVersion: "apn.jupiter-historical-authentication.v1";
    readonly operationId: string;
    readonly operationIntegrityHash: string;
    readonly rootBinding: string;
    readonly ownerProfileHash: string;
    readonly accountBindingHash: string;
    readonly payer: string;
    readonly policyDigest: string;
    readonly activationDigest: string;
    readonly originalBindingHash: string;
    readonly originalMaterialDigest: string;
    readonly freshMaterialDigest: string;
    readonly markerHash: string;
    readonly principalLamports: string;
    readonly maximumNativeExpenseLamports: string;
    readonly freshMaximumNativeExpenseLamports: string;
    readonly networkFeeLamports: string;
    readonly tokenAccountRentLamports: string;
    readonly genesis: typeof SOLANA_MAINNET_GENESIS;
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
    readonly signature: string;
    readonly rawPayloadHash: string;
    readonly messageHash: string;
    readonly freshBlockhash: string;
    readonly freshLastValidBlockHeight: string;
    readonly heightBinding: "authenticated_material_not_signed_message";
    readonly originalQuoteRpcLifetime: HistoricalQuoteRpcLifetime | null;
    readonly lifetimeProvenance: "configured_mainnet_rpc_before_quote_freeze" | "original_provider_build";
    readonly retainedClaimEvidence: HistoricalRetainedClaimEvidence;
    readonly ordinaryRecentBlockhash: true;
    readonly authenticatedAt: string;
    readonly authenticationExpiresAt: string;
}
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
export declare function validateHistoricalRetirementRecord(value: unknown): HistoricalRetirementRecord;
/** Binds the record to its own hash, the original operation and the original row bytes. The state root's filesystem
 * identity (path, device, inode) is deliberately not compared: a moved or restored ~/.apn keeps the same records. */
export declare function assertHistoricalRetirementBindings(record: HistoricalRetirementRecord, operation: SwapOperationRecord | null, reservation: AssetUsageReservation | undefined, originalRowRawHash: string): void;
export declare function sameIdentity(a: AssetUsageIdentity, b: AssetUsageIdentity): boolean;
/** Replace only exact original holds. No actual spend/finality claim is derived from this projection. */
export declare function historicalRetirementUsage(records: readonly AssetUsageReservation[], retirements: readonly HistoricalRetirementRecord[], now: Date): string;
