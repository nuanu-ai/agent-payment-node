import { type SunSwapCalldataIntent } from "./calldata.js";
export interface SunSwapTransactionBounds {
    readonly maximumEnergy: string;
    readonly energyPriceSun: string;
    readonly maximumFeeLimitSun: string;
}
export interface SunSwapUnsignedIntent extends SunSwapCalldataIntent, SunSwapTransactionBounds {
    readonly calldata: string;
    readonly callValueAtomic: string;
    readonly referenceBlockId: string;
    readonly timestampMs: string;
    readonly expirationMs: string;
    readonly feeLimitSun: string;
}
export interface SunSwapUnsignedTransaction {
    readonly visible: false;
    readonly txID: string;
    readonly raw_data_hex: string;
    readonly raw_data: {
        readonly contract: readonly [
            {
                readonly type: "TriggerSmartContract";
                readonly parameter: {
                    readonly type_url: "type.googleapis.com/protocol.TriggerSmartContract";
                    readonly value: {
                        readonly owner_address: string;
                        readonly contract_address: string;
                        readonly data: string;
                        readonly call_value: number;
                    };
                };
            }
        ];
        readonly ref_block_bytes: string;
        readonly ref_block_hash: string;
        readonly timestamp: number;
        readonly expiration: number;
        readonly fee_limit: number;
    };
}
export declare function buildSunSwapUnsignedTransaction(input: SunSwapUnsignedIntent): SunSwapUnsignedTransaction;
export declare function validateSunSwapUnsignedTransaction(value: unknown, intent: SunSwapUnsignedIntent): SunSwapUnsignedTransaction;
export declare function validateEnergyBounds(input: SunSwapTransactionBounds & {
    readonly feeLimitSun: string;
}): void;
export declare function sunSwapUnsignedPayloadHash(transaction: SunSwapUnsignedTransaction): string;
/**
 * Bandwidth java-tron charges for the signed transaction: the serialized Transaction (raw_data field and one
 * 65-byte signature field) plus the 64-byte MAX_RESULT_SIZE_IN_TX reserved for contract transactions.
 */
export declare function sunSwapMaximumBandwidthBytes(transaction: SunSwapUnsignedTransaction): bigint;
