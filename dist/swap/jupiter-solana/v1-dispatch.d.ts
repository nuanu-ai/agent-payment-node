import { SecureStateStore } from "../../secure-state-store.js";
import type { SwapOperationRecord } from "../model.js";
declare const SCHEMA: "apn.jupiter-v1-dispatch-observation.v1";
declare const CODES: readonly ["APN_RPC_PROTOCOL", "APN_RPC_AMBIGUOUS", "APN_RPC_RATE_LIMITED", "APN_RPC_BUDGET_EXCEEDED", "APN_RPC_CONFIG", "APN_PROVIDER_UNAVAILABLE", "APN_OPERATION_BLOCKED", "APN_STATE_CORRUPT", "APN_INTERNAL"];
declare const REASONS: readonly ["blockhash_not_found", "insufficient_funds_for_fee", "account_not_found", "already_processed", "instruction_error", "unclassified"];
type DispatchCode = typeof CODES[number];
type DispatchReason = typeof REASONS[number];
export interface JupiterV1DispatchResult {
    readonly outcome: "acknowledged" | "signature_mismatch" | "error";
    readonly errorCode: DispatchCode | null;
    readonly rpcErrorCode: number | null;
    readonly rpcErrorReason: DispatchReason | null;
    readonly httpStatus: number | null;
    readonly retryAfterMs: number | null;
}
export interface JupiterV1DispatchObservation extends JupiterV1DispatchResult {
    readonly schemaVersion: typeof SCHEMA;
    readonly operationId: string;
    readonly markerHash: string;
    readonly claimHash: string;
    readonly bindingHash: string;
    readonly signature: string;
    readonly observedAt: string;
    readonly recordHash: string;
}
export declare function jupiterV1DispatchResult(outcome: JupiterV1DispatchResult["outcome"], error?: unknown): JupiterV1DispatchResult;
/** An immutable public diagnostic. It never authorizes retry, settles usage, or proves chain finality. */
export declare class JupiterV1DispatchStore extends SecureStateStore {
    private initialized;
    private readonly bindings;
    constructor(root: string);
    save(op: SwapOperationRecord, bindingHash: string, result: JupiterV1DispatchResult, now: Date): Promise<void>;
    load(op: SwapOperationRecord): Promise<JupiterV1DispatchObservation | null>;
    private validate;
    private path;
    private ready;
}
export {};
