import { ApnError } from "../../errors.js";
import { mmError, mmFail } from "../reasons.js";
import { jobTxDetails, takeJobTx, validateJobTx } from "./job-tx.js";
import { readDataRecord } from "./read-diagnostic.js";
import { submitToken } from "./submit-diagnostic.js";
const CHECKS = ["response_body", "response_request_id", "response_kind", "response_status", "response_tx", "response_hash"];
const WITH_STATUS = ["response_status", "response_tx"];
const KEYS = ["mode", "check", "providerStatus", "responseTx"];
const REASON = "mm_gasless_provider_unavailable";
export function validateObserveDiagnostic(value) {
    const d = readDataRecord(value);
    const responseTx = d.responseTx === null || d.responseTx === undefined ? d.responseTx : validateJobTx(d.responseTx, REASON);
    if (Object.keys(d).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(d, key)) || d.mode !== "observe" ||
        typeof d.check !== "string" || !CHECKS.includes(d.check) ||
        !(d.providerStatus === null || submitToken(d.providerStatus) !== null) || d.providerStatus !== null && !WITH_STATUS.includes(d.check) ||
        responseTx === undefined || (responseTx !== null) !== (d.check === "response_tx"))
        mmFail(REASON);
    return Object.freeze({ mode: "observe", check: d.check, providerStatus: d.providerStatus, responseTx });
}
export function observeDiagnostic(check, providerStatus, responseTx) {
    return validateObserveDiagnostic({ mode: "observe", check, providerStatus, responseTx });
}
/** The read failure as an APN error whose details carry the diagnostic as flat fields (ErrorDetail values only). */
export function observeFailureError(reason, d) {
    const base = mmError(reason);
    return new ApnError(base.code, base.message, { ...base.details, observeCheck: d.check,
        ...(d.providerStatus === null ? {} : { observeProviderStatus: d.providerStatus }), ...jobTxDetails("observe", d.responseTx) });
}
/** The diagnostic a read failure carried across the helper boundary, if any. */
export function takeObserveDiagnostic(error) {
    if (!(error instanceof ApnError) || typeof error.details?.observeCheck !== "string")
        return undefined;
    const x = error.details;
    try {
        return observeDiagnostic(x.observeCheck, typeof x.observeProviderStatus === "string" ? x.observeProviderStatus : null, takeJobTx("observe", x, REASON));
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=observe-diagnostic.js.map