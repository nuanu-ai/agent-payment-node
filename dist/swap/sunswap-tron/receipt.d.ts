import type { TronRpcPort } from "../../tron/rpc.js";
export interface SunSwapReceiptExpectation {
    readonly transactionHash: string;
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly unsignedRawDataHex: string;
    readonly maximumFeeSun: string;
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
 * Proves one solidified successful V2 swap: exact txid and bytes, owner debit = call_value (input) + fee, one WTRX
 * deposit of the input by the router, one pair Swap to the owner, and one USDT Transfer from the pair to the owner >= minOut.
 */
export declare function validateSunSwapReceipt(transactionValue: unknown, infoValue: unknown, solidifiedHeadNumber: string, expected: SunSwapReceiptExpectation): SunSwapReceiptValidation;
