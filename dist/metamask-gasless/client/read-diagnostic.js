import { types } from "node:util";
import { ApnError } from "../../errors.js";
import { mmError, mmFail } from "../reasons.js";
export const readValidationPredicates = ["response_json", "response_root", "sentinel_mode", "sentinel_keys", "sentinel_jsonrpc", "sentinel_id", "sentinel_result", "sentinel_transactions", "sentinel_transactions_length", "sentinel_last_transaction", "sentinel_fees", "sentinel_fees_length", "sentinel_low_tier", "sentinel_token_fees", "sentinel_token_fees_length", "sentinel_entry", "sentinel_token", "sentinel_token_address", "sentinel_token_match", "sentinel_entry_error", "sentinel_symbol", "sentinel_decimals", "sentinel_fee_quantity", "sentinel_fee_recipient"];
const keys = ["mode", "stage", "invariant", "network", "httpStatus", "exitCode", "signal", "timedOut"];
const stages = ["launch", "private_state", "sdk_load", "hydrate", "inspect", "inventory",
    "chain_override", "relay_support", "fee_quote", "quote_output", "helper_response"];
const invariants = ["closed_failure", "unclassified_exception", "network_validation",
    "runner_launch", "runner_exit", "runner_timeout", "runner_output", "response_invalid"];
const networks = ["none", "mimir-networks", "accounts-networks", "sentinel-networks",
    "rpc-decimals", "rpc-balance", "sentinel-quote"];
/** Reject getters and proxies before reading an untrusted diagnostic or failure envelope. */
export function readDataRecord(value) {
    try {
        if (value === null || typeof value !== "object" || types.isProxy(value))
            throw new Error();
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null)
            throw new Error();
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(value).length !== 0)
            throw new Error();
        const result = {};
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
                throw new Error();
            Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
        }
        return result;
    }
    catch {
        return mmFail("mm_gasless_provider_unavailable");
    }
}
export function validateReadDiagnostic(value, mode) {
    const d = readDataRecord(value);
    const bounded = (v, low, high) => v === null ||
        typeof v === "number" && Number.isSafeInteger(v) && v >= low && v <= high;
    const hasShape = Object.hasOwn(d, "tokenFeesKind");
    if (Object.keys(d).length !== keys.length + (Object.hasOwn(d, "validationPredicate") ? 1 : 0) + (hasShape ? 1 : 0) || keys.some(key => !Object.hasOwn(d, key)) || d.mode !== mode ||
        typeof d.stage !== "string" || !stages.includes(d.stage) || typeof d.invariant !== "string" || !invariants.includes(d.invariant) ||
        typeof d.network !== "string" || !networks.includes(d.network) ||
        !bounded(d.httpStatus, 100, 599) || !bounded(d.exitCode, 0, 255) ||
        typeof d.signal !== "string" || !["none", "SIGINT", "SIGTERM", "SIGKILL", "other"].includes(d.signal) || typeof d.timedOut !== "boolean" ||
        mode === "inspect" && (d.network !== "none" || d.httpStatus !== null) ||
        d.network === "none" && d.httpStatus !== null ||
        mode === "inspect" && !["launch", "private_state", "hydrate", "inspect", "helper_response"].includes(String(d.stage)) ||
        d.stage === "launch" && (!["runner_launch", "runner_exit", "runner_timeout", "runner_output"].includes(String(d.invariant)) || d.network !== "none" ||
            d.timedOut !== (d.invariant === "runner_timeout") || d.invariant !== "runner_exit" && (d.exitCode !== null || d.signal !== "none")) ||
        d.stage !== "launch" && (d.exitCode !== null || d.signal !== "none" || d.timedOut !== false) ||
        d.stage === "helper_response" && d.invariant !== "response_invalid")
        mmFail("mm_gasless_provider_unavailable");
    if (Object.hasOwn(d, "validationPredicate") && (typeof d.validationPredicate !== "string" ||
        !readValidationPredicates.includes(d.validationPredicate) || mode !== "quote" ||
        d.invariant !== "network_validation" || d.network !== "sentinel-quote" || d.httpStatus === null ||
        d.httpStatus < 200 || d.httpStatus >= 300))
        mmFail("mm_gasless_provider_unavailable");
    if (hasShape && (typeof d.tokenFeesKind !== "string" ||
        !["missing", "null", "object", "string", "number", "boolean"].includes(d.tokenFeesKind) ||
        d.validationPredicate !== "sentinel_token_fees" || d.stage !== "fee_quote"))
        mmFail("mm_gasless_provider_unavailable");
    // Construct a new closed object; never retain caller-owned properties.
    return Object.freeze(Object.fromEntries([...keys.map(key => [key, d[key]]),
        ...(Object.hasOwn(d, "validationPredicate") ? [["validationPredicate", d.validationPredicate]] : []),
        ...(hasShape ? [["tokenFeesKind", d.tokenFeesKind]] : [])]));
}
export function readDiagnostic(mode, stage, invariant, network = "none", httpStatus = null, exitCode = null, signal = "none", timedOut = false, validationPredicate, shape) {
    return validateReadDiagnostic({ mode, stage, invariant, network, httpStatus, exitCode, signal, timedOut,
        ...(validationPredicate === undefined ? {} : { validationPredicate }),
        ...(shape === undefined ? {} : { tokenFeesKind: shape }) }, mode);
}
export function readFailureError(reason, d) {
    const plain = readDataRecord(d);
    if (plain.mode !== "inspect" && plain.mode !== "quote")
        mmFail("mm_gasless_provider_unavailable");
    const diagnostic = validateReadDiagnostic(plain, plain.mode), base = mmError(reason);
    return new ApnError(base.code, base.message, { reason,
        mm_read_mode: diagnostic.mode, mm_read_stage: diagnostic.stage, mm_read_invariant: diagnostic.invariant,
        ...(diagnostic.validationPredicate === undefined ? {} : { mm_read_validation_predicate: diagnostic.validationPredicate }),
        ...(diagnostic.tokenFeesKind === undefined ? {} : { mm_read_token_fees_kind: diagnostic.tokenFeesKind }),
        mm_read_network: diagnostic.network, mm_read_signal: diagnostic.signal, mm_read_timed_out: diagnostic.timedOut,
        ...(diagnostic.httpStatus === null ? {} : { mm_read_http_status: diagnostic.httpStatus }),
        ...(diagnostic.exitCode === null ? {} : { mm_read_exit_code: diagnostic.exitCode }) });
}
const runnerFailures = new WeakMap();
export function readRunnerFailure(mode, invariant, exitCode = null, signal = null) {
    const error = new Error("MetaMask read helper unavailable");
    const closedSignal = signal === null ? "none" : ["SIGINT", "SIGTERM", "SIGKILL"].includes(signal)
        ? signal : "other";
    runnerFailures.set(error, readDiagnostic(mode, "launch", invariant, "none", null, exitCode !== null && Number.isSafeInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? exitCode : null, closedSignal, invariant === "runner_timeout"));
    return error;
}
export function takeReadRunnerDiagnostic(error, mode) {
    if (error === null || typeof error !== "object")
        return undefined;
    const d = runnerFailures.get(error);
    runnerFailures.delete(error);
    return d?.mode === mode ? d : undefined;
}
//# sourceMappingURL=read-diagnostic.js.map