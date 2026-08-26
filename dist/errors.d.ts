export type ErrorCode = "APN_INVALID_INPUT" | "APN_UNSUPPORTED_COMMAND" | "APN_STATE_SECURITY" | "APN_STATE_CORRUPT" | "APN_IDEMPOTENCY_CONFLICT" | "APN_STATE_BUSY" | "APN_NATIVE_CHANNEL_REQUIRED" | "APN_NATIVE_PROTOCOL" | "APN_NATIVE_REJECTED" | "APN_RPC_CONFIG" | "APN_RPC_PROTOCOL" | "APN_RPC_AMBIGUOUS" | "APN_CHAIN_MISMATCH" | "APN_WALLET_MISMATCH" | "APN_INSUFFICIENT_USDC" | "APN_INSUFFICIENT_GAS" | "APN_REPREPARE_REQUIRED" | "APN_OPERATION_BLOCKED" | "APN_OPERATION_NOT_FOUND" | "APN_RECEIPT_NOT_FOUND" | "APN_INTERNAL";
export declare class ApnError extends Error {
    readonly code: ErrorCode;
    readonly details?: Readonly<Record<string, string | boolean>>;
    constructor(code: ErrorCode, message: string, details?: Readonly<Record<string, string | boolean>>);
}
export declare function asApnError(error: unknown): ApnError;
export declare function assertInput(condition: unknown, message: string): asserts condition;
