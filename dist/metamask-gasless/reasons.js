import { ApnError } from "../errors.js";
export const MM_REASON_CODES = {
    mm_gasless_input: "APN_INVALID_INPUT",
    mm_gasless_unsupported_chain: "APN_PROVIDER_CAPABILITY_UNAVAILABLE",
    mm_gasless_capability_unavailable: "APN_PROVIDER_CAPABILITY_UNAVAILABLE",
    mm_gasless_identity: "APN_PROFILE_DRIFT",
    mm_gasless_binding_changed: "APN_PROFILE_DRIFT",
    mm_gasless_session_unavailable: "APN_PROVIDER_SESSION_REQUIRED",
    mm_gasless_quote_invalid: "APN_PROVIDER_PROTOCOL",
    mm_gasless_quote_unstable: "APN_PROVIDER_PROTOCOL",
    mm_gasless_fee_cap: "APN_FEE_BUDGET_EXCEEDED",
    mm_gasless_balance: "APN_INSUFFICIENT_USDC",
    mm_gasless_approval: "APN_FOREGROUND_APPROVAL_REQUIRED",
    mm_gasless_expired: "APN_REPREPARE_REQUIRED",
    mm_gasless_clock: "APN_REPREPARE_REQUIRED",
    mm_gasless_rpc_binding: "APN_RPC_PROTOCOL",
    mm_gasless_rpc_unavailable: "APN_RPC_AMBIGUOUS",
    mm_gasless_scan_reorg: "APN_RPC_PROTOCOL",
    mm_gasless_evidence_invalid: "APN_RPC_PROTOCOL",
    mm_gasless_submit_unknown: "APN_OPERATION_BLOCKED",
    mm_gasless_record_capacity: "APN_OPERATION_BLOCKED",
    mm_gasless_pending: "APN_OPERATION_BLOCKED",
    mm_gasless_provider_approval: "APN_OPERATION_BLOCKED",
    mm_gasless_provider_unavailable: "APN_PROVIDER_UNAVAILABLE",
    mm_gasless_guard_unavailable: "APN_PROVIDER_UNAVAILABLE",
    mm_gasless_provider_failed: "APN_PROVIDER_EFFECT_UNAVAILABLE",
    mm_gasless_transaction_reverted: "APN_PROVIDER_EFFECT_UNAVAILABLE",
    mm_gasless_owner_abandoned: "APN_OPERATION_BLOCKED",
    mm_gasless_state_corrupt: "APN_STATE_CORRUPT",
    mm_gasless_state_security: "APN_STATE_SECURITY",
    mm_gasless_idempotency_conflict: "APN_IDEMPOTENCY_CONFLICT",
    mm_gasless_state_busy: "APN_STATE_BUSY",
    mm_gasless_internal: "APN_INTERNAL",
    mm_gasless_success: null,
};
export function mmError(reason) {
    return new ApnError(MM_REASON_CODES[reason], "MetaMask gasless operation could not advance safely.", { reason });
}
export function mmFail(reason) { throw mmError(reason); }
export function mmFailure(reason) {
    return { code: MM_REASON_CODES[reason], reason };
}
/** Only fixed APN codes and the closed family enum are allowed to cross an untrusted boundary. */
export function mmClassify(error, fallback) {
    if (!(error instanceof ApnError))
        return mmFailure(fallback);
    const reason = error.details?.reason;
    if (typeof reason === "string" && Object.hasOwn(MM_REASON_CODES, reason) && reason !== "mm_gasless_success" &&
        MM_REASON_CODES[reason] === error.code)
        return mmFailure(reason);
    const retained = {
        APN_STATE_CORRUPT: "mm_gasless_state_corrupt", APN_STATE_SECURITY: "mm_gasless_state_security",
        APN_STATE_BUSY: "mm_gasless_state_busy", APN_IDEMPOTENCY_CONFLICT: "mm_gasless_idempotency_conflict",
        APN_RPC_CONFIG: "mm_gasless_rpc_binding", APN_RPC_PROTOCOL: "mm_gasless_evidence_invalid",
        APN_RPC_AMBIGUOUS: "mm_gasless_rpc_unavailable", APN_PROFILE_DRIFT: "mm_gasless_binding_changed",
        APN_PROVIDER_SESSION_REQUIRED: "mm_gasless_session_unavailable",
    };
    return mmFailure(retained[error.code] ?? fallback);
}
//# sourceMappingURL=reasons.js.map