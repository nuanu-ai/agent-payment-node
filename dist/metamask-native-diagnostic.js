import { exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
const NATIVE_DIAGNOSTIC_STAGES = ["sdk_resolver", "sdk_read", "sdk_send", "owner_guard", "rpc_balance", "rpc_nonce", "post_handoff"];
const NATIVE_DIAGNOSTIC_CODES = ["ok", "deadline", "refused", "timeout", "exit", "signal", "protocol", "start", "internal"];
export function validateMetaMaskNativeDiagnostic(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["stage", "code", "exitCode", "signal", "durationMs", "remainingMs", "stderrClass", "providerCode"]))
        throw new ApnError("APN_STATE_CORRUPT", "Native diagnostic schema is invalid.");
    const v = value;
    if (!NATIVE_DIAGNOSTIC_STAGES.includes(v.stage) || !NATIVE_DIAGNOSTIC_CODES.includes(v.code) ||
        !(v.exitCode === null || Number.isSafeInteger(v.exitCode) && v.exitCode >= 0 && v.exitCode <= 255) ||
        ![null, "SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGABRT", "SIGSEGV", "SIGPIPE"].includes(v.signal) ||
        !Number.isSafeInteger(v.durationMs) || v.durationMs < 0 || v.durationMs > 86400000 || !Number.isSafeInteger(v.remainingMs) || v.remainingMs < 0 || v.remainingMs > 60000 ||
        !["none", "json_error", "unclassified"].includes(v.stderrClass) || !["none", "policy", "mfa", "auth", "funds", "rate_limit", "other"].includes(v.providerCode))
        throw new ApnError("APN_STATE_CORRUPT", "Native diagnostic binding is invalid.");
    return Object.freeze({ ...v });
}
/** Read-only timing bound, never a consent or financial authority. */
export function nativeDeadlineRemaining(deadline) {
    const expires = Date.parse(deadline), remaining = Math.floor(expires - Date.now());
    if (!Number.isFinite(expires) || new Date(expires).toISOString() !== deadline || remaining < 1 || remaining > 60000)
        throw new ApnError("APN_OPERATION_BLOCKED", "Native transfer deadline reached.");
    return remaining;
}
export function nativeContextDeadline(context) {
    return new Date(Math.min(Date.parse(context.consentExpiresAt), Date.parse(context.quote.expiresAt))).toISOString();
}
//# sourceMappingURL=metamask-native-diagnostic.js.map