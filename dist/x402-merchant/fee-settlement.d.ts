import { type MerchantOperation, type MerchantReceipt } from "./model.js";
export interface MerchantNativeActualFee {
    readonly kind: "merchant_mega_native_actual_fee";
    readonly operationId: string;
    readonly fingerprint: string;
    readonly receiptHash: string;
    readonly actualFee: string;
    readonly reservedFee: string;
}
export declare function merchantNativeActualFee(o: MerchantOperation, r: MerchantReceipt): MerchantNativeActualFee;
