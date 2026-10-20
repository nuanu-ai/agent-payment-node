import { SecureStateStore } from "../secure-state-store.js";
import type { ReceiptFactsRefusal } from "../direct-receipt-facts.js";
import { type SwapOperationRecord, type SwapReceiptEconomics } from "./model.js";
/**
 * A swap finalized before APN recorded its economics keeps its sealed record untouched. Its status reads that swap's own
 * finalized transaction once more through the lane's configured RPC, bound to the transaction hash the record proved, and
 * keeps what it proved here, bound to the record's integrity hash; later reads use this file and no RPC. A missing RPC
 * setting or an unreadable transaction refuses this extra read only, by name: the status itself still answers.
 */
export declare const SWAP_RECEIPT_FACTS_SCHEMA = "apn.swap-receipt-facts.v1";
export interface SwapReceiptFacts {
    readonly schemaVersion: typeof SWAP_RECEIPT_FACTS_SCHEMA;
    readonly operationId: string;
    readonly recordIntegrityHash: string;
    readonly transactionHash: string;
    readonly economics: SwapReceiptEconomics;
    readonly observedAt: string;
    readonly integrityHash: string;
}
/** Added beside the record in a swap's status: the facts, where they came from, or why the extra read was refused. */
export interface SwapActualEconomicsView {
    readonly actualEconomics: SwapReceiptEconomics | null;
    readonly actualEconomicsSource?: "receipt_proof" | "receipt_facts";
    readonly actualFactsRefusal?: ReceiptFactsRefusal;
}
/** Reads one finalized swap's own transaction for its economics (each lane's observer implements it, observe-only). */
export type SwapEconomicsRead = () => Promise<SwapReceiptEconomics>;
/** What a finalized record allows: success credits an output, a revert moved no input and credited nothing. */
export declare function assertSwapEconomicsOutcome(record: Pick<SwapOperationRecord, "state">, economics: unknown): SwapReceiptEconomics;
export declare class SwapReceiptFactsStore extends SecureStateStore {
    private path;
    load(record: SwapOperationRecord): Promise<SwapReceiptFacts | null>;
    /** Create-only: a concurrent reader's file wins and is returned after the same validation. */
    create(record: SwapOperationRecord, economics: SwapReceiptEconomics, observedAt: string): Promise<SwapReceiptFacts>;
}
/**
 * The status envelope's receipt slot for a swap (the record itself stays exactly as sealed in the operation slot): null
 * before an outcome, otherwise what its finalized transaction moved and paid, or why that could not be read.
 */
export declare function swapStatusReceipt(record: SwapOperationRecord, view: () => Promise<SwapActualEconomicsView>): Promise<SwapActualEconomicsView | null>;
/** The record's own economics, its facts sidecar, or one read now; never a failure of the status it serves. */
export declare function swapActualEconomics(root: string, record: SwapOperationRecord, read: SwapEconomicsRead | undefined, now: Date): Promise<SwapActualEconomicsView>;
