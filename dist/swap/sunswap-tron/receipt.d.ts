import type { TronRpcPort } from "../../tron/rpc.js";
export interface SunSwapReceiptExpectation {
    readonly transactionHash: string;
    readonly recipient: string;
    readonly minimumOutputAtomic: string;
    readonly unsignedRawDataHex: string;
    readonly maximumFeeSun: string;
}
export interface SunSwapReceiptValidation {
    readonly transactionHash: string;
    readonly blockNumber: string;
    readonly solidifiedHeadNumber: string;
    readonly outputAmountAtomic: string;
    readonly feeSun: string;
    readonly finalized: true;
    readonly receiptHash: string;
}
export declare function observeSunSwapReceipt(rpc: TronRpcPort, expected: SunSwapReceiptExpectation): Promise<SunSwapReceiptValidation>;
export declare function validateSunSwapReceipt(transactionValue: unknown, infoValue: unknown, solidifiedHeadNumber: string, expected: SunSwapReceiptExpectation): SunSwapReceiptValidation;
