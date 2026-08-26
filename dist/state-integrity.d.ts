import type { OperationRecord, OperationState, ReceiptRecord, Transition, WalletRecord } from "./model.js";
export declare function appendTransition(previous: readonly Transition[], input: {
    readonly at: string;
    readonly state: OperationState;
    readonly terminal: boolean;
    readonly reason: string;
    readonly proofClass: string;
}): readonly Transition[];
export declare function sealWallet(value: Omit<WalletRecord, "integrityHash">): WalletRecord;
export declare function sealOperation(value: Omit<OperationRecord, "integrityHash">): OperationRecord;
export declare function sealReceipt(value: Omit<ReceiptRecord, "integrityHash">): ReceiptRecord;
export declare function validateWallet(value: unknown): WalletRecord;
export declare function validateOperation(value: unknown): OperationRecord;
export declare function validateReceipt(value: unknown): ReceiptRecord;
