import type { AssetUsageReservation } from "../asset-usage-ledger.js";
import { type SwapQuoteSnapshot } from "./quote.js";
export declare const SWAP_OPERATION_SCHEMA: "apn.swap-operation.v1";
export type SwapOperationState = "quoted" | "prepared" | "awaiting_approval" | "reserved" | "submitting" | "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" | "expired_unlanded" | "abandoned_unknown";
/**
 * Every state with no further transition. expired_unlanded: the chain proved the marked effect can never land.
 * abandoned_unknown: no chain proof is possible and the owner accepted the unknown outcome; the input stays charged.
 */
export declare const SWAP_TERMINAL_STATES: readonly SwapOperationState[];
export interface SwapSubmissionMarker {
    readonly markerHash: string;
    readonly markedAt: string;
    readonly operationIntegrityHash: string;
    readonly unsignedTransactionPayloadHash: string;
}
/**
 * What the finalized transaction itself moved and paid, read from its own receipt by each family's observer (absent on
 * proofs written before APN recorded it). Amounts are atomic units: input in the source asset, output in the destination asset,
 * fee and native debit in the chain's native coin (wei, SUN, lamports). The quote keeps its expected and minimum output.
 */
export interface SwapReceiptEconomics {
    /** Source asset that left the account in this transaction; "0" when it reverted. */
    readonly inputAtomic: string;
    /** Destination asset credited to the recipient; null when the transaction reverted. */
    readonly outputAtomic: string | null;
    /** What the chain charged; null when a fee component is not in the receipt (never estimated). */
    readonly networkFeeAtomic: string | null;
    /** The account's native-coin decrease caused by this transaction; null with an incomplete fee. */
    readonly nativeDebitAtomic: string | null;
    /** Solana: rent this transaction deposited into new token accounts of the owner (recoverable on close). */
    readonly accountRentAtomic?: string;
}
export interface SwapReceiptProof {
    readonly receiptHash: string;
    readonly transactionHash: string;
    readonly observedAt: string;
    readonly finalized: boolean;
    readonly economics?: SwapReceiptEconomics;
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
/** Every state a guarded swap record may hold (its validator refuses any other). */
export declare const SWAP_OPERATION_STATES: readonly SwapOperationState[];
export declare function validateSwapReceiptProof(value: unknown, chain: string, earliestAt: string, latestAt: string, mode?: "input" | "stored"): SwapReceiptProof;
export declare function validSwapEconomics(value: unknown): value is SwapReceiptEconomics;
