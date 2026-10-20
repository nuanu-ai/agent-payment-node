import { type DirectEvmFeeModel } from "./evm-direct-networks.js";
import type { Hex, OperationRecord } from "./model.js";
/**
 * The receipt fields that carry a direct transfer's charge, exactly as the node answered them. A field the node did not
 * send stays absent; a value that is not a short string is kept as "invalid" so the derivation below stays reproducible.
 */
export declare const EVM_RECEIPT_FEE_FIELDS: readonly ["gasUsed", "effectiveGasPrice", "l1Fee", "operatorFeeScalar", "operatorFeeConstant", "operatorFee", "blobGasUsed", "blobGasPrice"];
export type EvmReceiptFeeFields = Readonly<Partial<Record<typeof EVM_RECEIPT_FEE_FIELDS[number], string>>>;
export declare function readEvmReceiptFeeFields(receipt: Readonly<Record<string, unknown>>): EvmReceiptFeeFields;
/**
 * What a completed or reverted direct transfer actually paid, derived only from its own canonical receipt by the
 * network's charge rule (see `DirectEvmFeeModel`). A component APN cannot read from the receipt leaves the fee
 * `incomplete` with its reason: nothing is estimated and the quote is never put in its place.
 */
export interface EvmActualFee {
    readonly schemaVersion: "apn.evm-direct-actual-fee.v1";
    readonly chainId: number;
    readonly feeModel: DirectEvmFeeModel;
    readonly transactionHash: Hex;
    readonly blockNumberAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly receiptFields: EvmReceiptFeeFields;
    readonly complete: boolean;
    readonly incompleteReason: string | null;
    readonly gasBilledAtomic: string | null;
    readonly executionFeeAtomic: string | null;
    readonly l1DataFeeAtomic: string | null;
    readonly operatorFeeAtomic: string | null;
    readonly totalFeeAtomic: string | null;
}
export type EvmActualFeeInput = Pick<EvmActualFee, "chainId" | "transactionHash" | "blockNumberAtomic" | "gasLimitAtomic" | "maxFeePerGasAtomic" | "receiptFields">;
/** A new observation names the network's current charge rule; a stored one is re-derived by the rule it names (R2). */
export declare function deriveEvmActualFee(input: EvmActualFeeInput, feeModel: DirectEvmFeeModel): EvmActualFee;
/** A stored fee observation must be exactly what its own receipt fields derive (R2: no current constant is consulted). */
export declare function validateEvmActualFee(value: unknown): EvmActualFee;
/** Only the proven outcomes carry it, and only for this operation's own signed transaction. */
export declare function assertEvmActualFeeBinding(operation: OperationRecord): void;
/** Public form: the fact when complete, its known parts and reason when not, null when nothing was observed. */
export declare function publicEvmActualFee(fee: EvmActualFee | undefined, asset: {
    readonly kind: string;
} | undefined, amountAtomic: string, state: string): {
    actual_network_fee: null;
    actual_sender_native_debit_atomic: null;
} | {
    actual_network_fee: {
        status: string;
        chain: "eip155:1" | "eip155:8453" | "eip155:42161" | "eip155:10" | "eip155:137" | "eip155:56" | "eip155:43114" | "eip155:130" | "eip155:59144" | "eip155:143" | "eip155:1329";
        unit: string;
        decimals: 18;
        fee_model: DirectEvmFeeModel;
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
