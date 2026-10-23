import type { X402OperationRecord, X402ReceiptRecord, X402ResultRecord } from "./x402-state-model.js";
export * from "./x402-state-model.js";
export declare function validateX402Operation(value: unknown): X402OperationRecord;
export interface X402SettlementWaitProjection {
    /** `not_exposed`: the payment was never sent, so nothing settles; the operation's own state and actions say what follows. */
    readonly outcome: "completed" | "timeout" | "interrupted" | "not_exposed";
    readonly requestedSeconds: string;
    readonly observationCount: string;
}
export declare function x402WaitProjectedStatus(status: {
    readonly reason: string;
    readonly proofClass: string;
    readonly terminal: boolean;
}, settlementWait?: X402SettlementWaitProjection): {
    readonly reason: string;
    readonly proofClass: string;
};
export declare function publicX402Operation(operation: X402OperationRecord, result?: X402ResultRecord, settlementWait?: X402SettlementWaitProjection): unknown;
/** The stored `resultHash` is domain separated; the public result names it as such beside the plain body SHA-256. */
export declare const X402_RESULT_HASH_RULE = "sha256(utf8(\"apn.x402.result-body.v1\") || 0x00 || body_bytes)";
export declare function publicX402ResultData(result: X402ResultRecord): unknown;
export declare function sealX402Result(value: Omit<X402ResultRecord, "integrityHash">): X402ResultRecord;
export declare function sealX402Receipt(value: Omit<X402ReceiptRecord, "integrityHash">): X402ReceiptRecord;
export declare function validateX402Result(value: unknown): X402ResultRecord;
export declare function validateX402Receipt(value: unknown): X402ReceiptRecord;
