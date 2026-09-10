import { ApnError, type ErrorCode } from "../errors.js";
export declare const MM_REASON_CODES: {
    readonly mm_gasless_input: "APN_INVALID_INPUT";
    readonly mm_gasless_unsupported_chain: "APN_PROVIDER_CAPABILITY_UNAVAILABLE";
    readonly mm_gasless_capability_unavailable: "APN_PROVIDER_CAPABILITY_UNAVAILABLE";
    readonly mm_gasless_identity: "APN_PROFILE_DRIFT";
    readonly mm_gasless_binding_changed: "APN_PROFILE_DRIFT";
    readonly mm_gasless_session_unavailable: "APN_PROVIDER_SESSION_REQUIRED";
    readonly mm_gasless_quote_invalid: "APN_PROVIDER_PROTOCOL";
    readonly mm_gasless_quote_unstable: "APN_PROVIDER_PROTOCOL";
    readonly mm_gasless_fee_cap: "APN_FEE_BUDGET_EXCEEDED";
    readonly mm_gasless_balance: "APN_INSUFFICIENT_USDC";
    readonly mm_gasless_approval: "APN_FOREGROUND_APPROVAL_REQUIRED";
    readonly mm_gasless_expired: "APN_REPREPARE_REQUIRED";
    readonly mm_gasless_clock: "APN_REPREPARE_REQUIRED";
    readonly mm_gasless_rpc_binding: "APN_RPC_PROTOCOL";
    readonly mm_gasless_rpc_unavailable: "APN_RPC_AMBIGUOUS";
    readonly mm_gasless_scan_reorg: "APN_RPC_PROTOCOL";
    readonly mm_gasless_evidence_invalid: "APN_RPC_PROTOCOL";
    readonly mm_gasless_submit_unknown: "APN_OPERATION_BLOCKED";
    readonly mm_gasless_record_capacity: "APN_OPERATION_BLOCKED";
    readonly mm_gasless_pending: "APN_OPERATION_BLOCKED";
    readonly mm_gasless_provider_approval: "APN_OPERATION_BLOCKED";
    readonly mm_gasless_provider_unavailable: "APN_PROVIDER_UNAVAILABLE";
    readonly mm_gasless_provider_failed: "APN_PROVIDER_EFFECT_UNAVAILABLE";
    readonly mm_gasless_transaction_reverted: "APN_PROVIDER_EFFECT_UNAVAILABLE";
    readonly mm_gasless_state_corrupt: "APN_STATE_CORRUPT";
    readonly mm_gasless_state_security: "APN_STATE_SECURITY";
    readonly mm_gasless_idempotency_conflict: "APN_IDEMPOTENCY_CONFLICT";
    readonly mm_gasless_state_busy: "APN_STATE_BUSY";
    readonly mm_gasless_internal: "APN_INTERNAL";
    readonly mm_gasless_success: null;
};
export type MetaMaskGaslessReason = keyof typeof MM_REASON_CODES;
export type MetaMaskGaslessFailureReason = Exclude<MetaMaskGaslessReason, "mm_gasless_success">;
export interface MetaMaskGaslessFailure {
    readonly code: ErrorCode;
    readonly reason: MetaMaskGaslessFailureReason;
}
export declare function mmError(reason: MetaMaskGaslessFailureReason): ApnError;
export declare function mmFail(reason: MetaMaskGaslessFailureReason): never;
export declare function mmFailure(reason: MetaMaskGaslessFailureReason): MetaMaskGaslessFailure;
/** Only fixed APN codes and the closed family enum are allowed to cross an untrusted boundary. */
export declare function mmClassify(error: unknown, fallback: MetaMaskGaslessFailureReason): MetaMaskGaslessFailure;
