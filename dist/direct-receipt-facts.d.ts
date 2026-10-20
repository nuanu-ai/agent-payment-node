import { type EvmActualFee } from "./evm-direct-actual-fee.js";
import { type FinalizedReader } from "./evm-finalized-proof.js";
import type { OperationRecord, ReceiptRecord } from "./model.js";
import { SecureStateStore } from "./secure-state-store.js";
/**
 * A transfer completed before APN recorded its actual fee keeps its sealed record untouched. On status or receipt APN
 * reads that operation's own receipt once more (its stored transaction hash, in the very block its record proved), derives
 * the fee by the network's rule, and keeps it in this sidecar bound to the record's integrity hash; later reads use the
 * sidecar and no RPC. A missing RPC setting or an unreadable receipt refuses this extra read only, by name.
 */
export declare const DIRECT_RECEIPT_FACTS_SCHEMA = "apn.direct-receipt-facts.v1";
export interface DirectReceiptFacts {
    readonly schemaVersion: typeof DIRECT_RECEIPT_FACTS_SCHEMA;
    readonly operationId: string;
    readonly recordIntegrityHash: string;
    readonly fee: EvmActualFee;
    readonly observedAt: string;
    readonly integrityHash: string;
}
export interface ReceiptFactsRefusal {
    readonly code: string;
    readonly reason: string;
    readonly message: string;
}
/** The receipt bound to what the record proved: its transaction, its block (and block hash where kept) and its outcome. */
export declare function directFeeFromReceipt(operation: OperationRecord, receipt: ReceiptRecord, raw: unknown): EvmActualFee;
export declare class DirectReceiptFactsStore extends SecureStateStore {
    private path;
    load(operation: OperationRecord): Promise<DirectReceiptFacts | null>;
    /** Create-only: a concurrent reader's file wins and is returned after the same validation. */
    create(operation: OperationRecord, fee: EvmActualFee, observedAt: string): Promise<DirectReceiptFacts>;
}
/**
 * The fee of a completed local transfer: recorded, from its sidecar, or read once now; or the named refusal of that read.
 * Nothing here fails the status or receipt it serves: a damaged sidecar or receipt record is named in the refusal too.
 */
export declare function directActualFee(root: string, read: FinalizedReader | undefined, operation: OperationRecord, loadReceipt: () => Promise<ReceiptRecord | null>, now: Date): Promise<{
    readonly fee?: EvmActualFee;
    readonly refusal?: ReceiptFactsRefusal;
}>;
/** Public form for a local transfer: the fee keys, plus the named refusal when the extra read was refused. */
export declare function publicDirectFacts(operation: Pick<OperationRecord, "evm" | "amountAtomic" | "state">, facts: {
    readonly fee?: EvmActualFee;
    readonly refusal?: ReceiptFactsRefusal;
}): {
    actual_facts_refusal?: ReceiptFactsRefusal;
    actual_network_fee: null;
    actual_sender_native_debit_atomic: null;
} | {
    actual_facts_refusal?: ReceiptFactsRefusal;
    actual_network_fee: {
        status: string;
        chain: "eip155:1" | "eip155:8453" | "eip155:42161" | "eip155:10" | "eip155:137" | "eip155:56" | "eip155:43114" | "eip155:130" | "eip155:59144" | "eip155:143" | "eip155:1329";
        unit: string;
        decimals: 18;
        fee_model: import("./evm-direct-networks.js").DirectEvmFeeModel;
        total_atomic: string | null;
        execution_atomic: string | null;
        l1_data_atomic: string | null;
        operator_atomic: string | null;
        gas_billed_atomic: string | null;
        effective_gas_price_atomic: string | null;
        incomplete_reason: string | null;
        transaction_hash: `0x${string}`;
        block_number_atomic: string;
    };
    actual_sender_native_debit_atomic: string | null;
};
