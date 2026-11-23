import type { SwapOperationRecord, SwapReceiptEconomics } from "./model.js";
/**
 * The economics of a Uniswap swap its record proved finalized, from that transaction's own receipt (read once, P1: no
 * state at an old block): the lane router's single wrapped-native (WETH9 or WBNB) Deposit of the native input, the output
 * token's Transfer credit to the recipient, and gasUsed x effectiveGasPrice. The receipt must be the record's transaction,
 * from its account to the lane's router, with the outcome the record holds, at or below the finalized head.
 */
export declare function uniswapEconomicsFromReceipt(record: SwapOperationRecord, receiptValue: unknown, finalizedHead: {
    readonly number: string;
}): SwapReceiptEconomics;
