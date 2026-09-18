import type { TronRpcPort } from "../../tron/rpc.js";
export interface SunSwapReceiptExpectation {
    readonly transactionHash: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly unsignedRawDataHex: string;
    /** The owner fee_limit: the only cap on the energy fee. */
    readonly maximumFeeSun: string;
    /** The frozen bandwidth budget: signed bytes x bandwidth price, burned when no free or staked bandwidth remains. */
    readonly maximumBandwidthFeeSun: string;
}
export interface SunSwapReceiptValidation {
    readonly transactionHash: string;
    readonly blockNumber: string;
    readonly solidifiedHeadNumber: string;
    readonly inputAmountAtomic: string;
    readonly outputAmountAtomic: string;
    readonly feeSun: string;
    readonly trxDebitSun: string;
    readonly finalized: true;
    readonly receiptHash: string;
}
export declare function observeSunSwapReceipt(rpc: TronRpcPort, expected: SunSwapReceiptExpectation): Promise<SunSwapReceiptValidation>;
/**
 * Proves one solidified successful V2 swap: exact txid and bytes, owner debit = call_value (input) + fee where
 * fee = energy_fee (<= fee_limit) + net_fee (<= bandwidth budget), one WTRX deposit of the input by the router, one pair
 * Swap to the owner, and one USDT Transfer from the pair to the owner >= minOut.
 */
export declare function validateSunSwapReceipt(transactionValue: unknown, infoValue: unknown, solidifiedHeadNumber: string, expected: SunSwapReceiptExpectation): SunSwapReceiptValidation;
