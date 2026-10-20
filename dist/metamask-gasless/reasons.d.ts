import { ApnError, type ErrorCode } from "../errors.js";
export declare const MM_REASON_CODES: {
    readonly mm_gasless_input: "APN_INVALID_INPUT";
    readonly mm_gasless_unsupported_chain: "APN_PROVIDER_CAPABILITY_UNAVAILABLE";
    readonly mm_gasless_capability_unavailable: "APN_PROVIDER_CAPABILITY_UNAVAILABLE";
    /** MetaMask's relay network lists do not offer this chain (the refusal names which list). */
    readonly mm_gasless_relay_unsupported: "APN_PROVIDER_CAPABILITY_UNAVAILABLE";
    /** MetaMask's fee quote answered without a token-fee list for this transfer: a provider answer, not a fault. */
    readonly mm_gasless_fee_unquoted: "APN_PROVIDER_CAPABILITY_UNAVAILABLE";
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
    /** The chain's RPC environment variable is unset, empty or not a public HTTPS URL; no RPC was asked anything. */
    readonly mm_gasless_rpc_setting: "APN_RPC_CONFIG";
    readonly mm_gasless_rpc_unavailable: "APN_RPC_AMBIGUOUS";
    /** The RPC refused eth_getLogs as too wide even at the narrowest bounded window. */
    readonly mm_gasless_rpc_log_range: "APN_RPC_CONFIG";
    /** The RPC asked APN to slow down (HTTP 429 or a request-limit error). */
    readonly mm_gasless_rpc_rate_limited: "APN_RPC_RATE_LIMITED";
    readonly mm_gasless_scan_reorg: "APN_RPC_PROTOCOL";
    readonly mm_gasless_evidence_invalid: "APN_RPC_PROTOCOL";
    readonly mm_gasless_submit_unknown: "APN_OPERATION_BLOCKED";
    readonly mm_gasless_record_capacity: "APN_OPERATION_BLOCKED";
    readonly mm_gasless_pending: "APN_OPERATION_BLOCKED";
    readonly mm_gasless_provider_approval: "APN_OPERATION_BLOCKED";
    readonly mm_gasless_provider_unavailable: "APN_PROVIDER_UNAVAILABLE";
    readonly mm_gasless_guard_unavailable: "APN_PROVIDER_UNAVAILABLE";
    readonly mm_gasless_provider_failed: "APN_PROVIDER_EFFECT_UNAVAILABLE";
    /** DENIED or EXPIRED after AWAITING_MFA: by MetaMask's job order the request closed before signing. Not proof. */
    readonly mm_gasless_provider_mfa_rejected: "APN_PROVIDER_EFFECT_UNAVAILABLE";
    readonly mm_gasless_transaction_reverted: "APN_PROVIDER_EFFECT_UNAVAILABLE";
    readonly mm_gasless_owner_abandoned: "APN_OPERATION_BLOCKED";
    /** The delegator disabled the delegation on chain before any redemption: proved, no effect, nothing more can happen. */
    readonly mm_gasless_delegation_disabled: "APN_PROVIDER_EFFECT_UNAVAILABLE";
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
