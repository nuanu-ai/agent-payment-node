import type { AssetUsageReservation } from "../asset-usage-ledger.js";
import { type SwapQuoteSnapshot } from "./quote.js";
export declare const SWAP_OPERATION_SCHEMA: "apn.swap-operation.v1";
export type SwapOperationState = "quoted" | "prepared" | "awaiting_approval" | "reserved" | "submitting" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert";
export interface SwapSubmissionMarker {
    readonly markerHash: string;
    readonly markedAt: string;
    readonly operationIntegrityHash: string;
    readonly unsignedTransactionPayloadHash: string;
}
export interface SwapReceiptProof {
    readonly receiptHash: string;
    readonly transactionHash: string;
    readonly observedAt: string;
    readonly finalized: boolean;
}
export interface SwapOperationRecord {
    readonly schemaVersion: typeof SWAP_OPERATION_SCHEMA;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly ownerProfileHash: string;
    readonly state: SwapOperationState;
    readonly revision: number;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly quote: SwapQuoteSnapshot;
    readonly policyDigest: string;
    readonly policyVersion: string;
    readonly protocolRegistryDigest: string;
    readonly protocolRegistryVersion: string;
    readonly mechanismDigest: string;
    readonly usageLease: AssetUsageReservation | null;
    readonly approvalCapAtomic: string;
    readonly submissionMarker: SwapSubmissionMarker | null;
    readonly receiptProof: SwapReceiptProof | null;
    readonly failureProofHash: string | null;
    readonly previousIntegrityHash: string | null;
    readonly integrityHash: string;
}
export type NewSwapOperation = Omit<SwapOperationRecord, "schemaVersion" | "ownerProfileHash" | "state" | "revision" | "createdAt" | "updatedAt" | "usageLease" | "submissionMarker" | "receiptProof" | "failureProofHash" | "previousIntegrityHash" | "integrityHash"> & {
    readonly now: Date;
};
export declare function newSwapOperation(input: NewSwapOperation): SwapOperationRecord;
export declare function validateSwapOperation(value: unknown): SwapOperationRecord;
export declare function validateSwapReceiptProof(value: unknown, chain: string, earliestAt: string, latestAt: string, mode?: "input" | "stored"): SwapReceiptProof;
