import { PERMIT2_HTTP_OBSERVATION_SCHEMA, Permit2HttpObservationStore } from "./production-http-observations.js";
import { publicPermit2Production } from "./production-repository.js";
export function permit2Delivery(record, hint) {
    const none = { httpStatus: null, resultHash: null, byteLength: null };
    if (record.exposureJournal?.request == null)
        return { state: "not_requested", reason: null, ...none };
    if (hint === "unreadable")
        return { state: "unconfirmed", reason: "answer_unreadable", ...none };
    if (hint === null)
        return { state: "unconfirmed", reason: "no_answer", ...none };
    if (hint.schemaVersion !== PERMIT2_HTTP_OBSERVATION_SCHEMA) {
        return { state: "unconfirmed", reason: "answer_before_0_5_110", ...none, httpStatus: hint.httpStatus };
    }
    const answer = { httpStatus: hint.httpStatus, resultHash: hint.bodyHash, byteLength: hint.bodyByteLength };
    if (hint.httpStatus < 200 || hint.httpStatus > 299)
        return { state: "unconfirmed", reason: "answer_not_2xx", ...answer };
    if (hint.classification === "failure_hint" || hint.classification === "invalid_response") {
        return { state: "unconfirmed", reason: "payment_response_refused", ...answer };
    }
    // The settled intent decides, not the record state: `terminal_pending` with it reads the same as `settled`.
    const intent = record.exposureJournal?.terminalIntent ?? null;
    const settled = intent?.outcome === "settled" ? intent.transactionHash : null;
    if (settled !== null && hint.locator !== null && settled.toLowerCase() !== hint.locator.toLowerCase()) {
        return { state: "unconfirmed", reason: "answer_names_other_transaction", ...answer };
    }
    return { state: "received", reason: null, ...answer };
}
/** Reads the saved answer only when a request was sent; no locks, writes or network. */
export async function readPermit2Delivery(root, record) {
    if (record.exposureJournal?.request == null)
        return permit2Delivery(record, null);
    let hint;
    try {
        hint = await new Permit2HttpObservationStore(root).read(record.operationId, record);
    }
    catch {
        hint = "unreadable";
    }
    return permit2Delivery(record, hint);
}
/** The public view of one operation with its delivery: what every status, approve and observe answer shows. */
export async function projectPermit2Production(root, record) {
    return { ...publicPermit2Production(record), delivery: await readPermit2Delivery(root, record) };
}
//# sourceMappingURL=production-delivery.js.map