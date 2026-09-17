import type { AssetUsageReservation } from "../asset-usage-ledger.js";
import { type SwapOperationRecord, type SwapOperationState, type SwapReceiptProof, type SwapSubmissionMarker } from "./model.js";
export type SwapTransitionEvidence = {
    readonly usageLease?: AssetUsageReservation;
    readonly submissionMarker?: SwapSubmissionMarker;
    readonly receiptProof?: SwapReceiptProof;
    readonly failureProofHash?: string;
};
export declare function transitionSwapOperation(opValue: unknown, state: SwapOperationState, evidence: SwapTransitionEvidence, now: Date): SwapOperationRecord;
