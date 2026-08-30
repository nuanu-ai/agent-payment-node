import type { Address, Economics, Hex, OperationRecord, ReceiptRecord } from "./model.js";
import type { BalanceSnapshot, FeeEstimate, RpcReceipt } from "./ports.js";
import { canonicalAddress, validateBalance } from "./wallet-policy.js";
export interface NativeEffect {
    readonly transactionHash: Hex;
    readonly rawTransaction: Hex;
    readonly rawTransactionHash: Hex;
}
export declare function canonicalOperationId(value: unknown): string;
export declare function canonicalIdempotencyKey(value: unknown): string;
export declare function transferData(recipient: Address, atomic: string): Hex;
export declare function validateEconomics(nonceAtomic: string, fees: FeeEstimate): Economics;
export declare function requireFunding(snapshot: BalanceSnapshot, amountAtomic: string, gasAtomic: string): void;
export declare function parseEffect(value: unknown): NativeEffect;
export declare function verifyEffect(effect: NativeEffect, operation: OperationRecord): Promise<void>;
export declare function hasExactTransfer(receipt: RpcReceipt, operation: OperationRecord): boolean;
export declare function publicOperation(operation: OperationRecord): unknown;
export declare function publicReceipt(receipt: ReceiptRecord): unknown;
export { canonicalAddress, validateBalance };
