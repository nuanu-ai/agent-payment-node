export interface RelayBaseReceiptFee {
    readonly l2ExecutionFeeWei: string;
    readonly l1FeeWei: string;
    readonly operatorFeeWei: string;
    readonly totalFeeWei: string;
}
export declare function decodeRelayBaseReceiptFee(receipt: Record<string, unknown>): RelayBaseReceiptFee;
export declare function verifyRelayBaseReceiptFee(fee: RelayBaseReceiptFee | undefined, maximum: string): void;
