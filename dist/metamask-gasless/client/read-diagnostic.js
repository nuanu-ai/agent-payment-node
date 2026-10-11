import { types } from "node:util";
import { ApnError } from "../../errors.js";
import { mmError, mmFail } from "../reasons.js";
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
    if (Object.keys(d).length !== keys.length || keys.some(key => !Object.hasOwn(d, key)) || d.mode !== mode ||
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
    // Construct a new closed object; never retain caller-owned properties.
    return Object.freeze(Object.fromEntries(keys.map(key => [key, d[key]])));
}
export function readDiagnostic(mode, stage, invariant, network = "none", httpStatus = null, exitCode = null, signal = "none", timedOut = false) {
    return validateReadDiagnostic({ mode, stage, invariant, network, httpStatus, exitCode, signal, timedOut }, mode);
}
export function readFailureError(reason, d) {
    const plain = readDataRecord(d);
    if (plain.mode !== "inspect" && plain.mode !== "quote")
        mmFail("mm_gasless_provider_unavailable");
    const diagnostic = validateReadDiagnostic(plain, plain.mode), base = mmError(reason);
    return new ApnError(base.code, base.message, { reason,
        mm_read_mode: diagnostic.mode, mm_read_stage: diagnostic.stage, mm_read_invariant: diagnostic.invariant,
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