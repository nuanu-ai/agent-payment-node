import { isPlainRecord } from "../../canonical.js";
import { mmFail } from "../reasons.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmUuid } from "../validation.js";
import { jobTx } from "./job-tx.js";
import { approvalWindow, assertApprovalWindow } from "./server-transaction.js";
import { submitToken } from "./submit-diagnostic.js";
const REASON = "mm_gasless_provider_unavailable";
export function serverRequestQuery(value) {
    const q = mmExact(value, ["requestId", "projectHash", "sender", "chainId"], "mm_gasless_input");
    // A canonical v4 UUID only: the id is written into the read's URL path, so no other spelling can name another resource.
    mmUuid(q.requestId, "mm_gasless_input");
    mmHash(q.projectHash, "mm_gasless_input");
    mmCanonicalAddress(q.sender, "mm_gasless_input");
    if (!Number.isSafeInteger(q.chainId) || Number(q.chainId) < 1)
        mmFail("mm_gasless_input");
    return q;
}
/** The helper's answer as the parent accepts it: exactly these fields, for exactly the asked request. */
export function serverRequestRead(value, query) {
    const r = mmExact(value, ["requestId", "found", "status", "txHash", "mfa", "responseHash"], REASON);
    if (r.requestId !== query.requestId || typeof r.found !== "boolean")
        mmFail(REASON);
    if (r.found ? submitToken(r.status) === null || (r.txHash !== null && mmHex(r.txHash, 32, REASON) !== r.txHash) || mmHash(r.responseHash, REASON) !== r.responseHash
        : r.status !== null || r.txHash !== null || r.mfa !== null || r.responseHash !== null)
        mmFail(REASON);
    if (r.found)
        assertApprovalWindow(r.mfa, r.status, REASON);
    return r;
}
/**
 * The SDK's answer, checked as the gasless observation checks its own (client/service.ts): this request id, kind
 * transaction, a status token, `tx.from` the operation's sender and `tx.chainId` its chain (a number), and a hash, when
 * there is one, of 32 lowercase bytes. An absent or null hash is no hash, as `mm` itself reads one. Any other answer refuses.
 */
export function serverRequestAnswer(value, query, responseHash, sessionAuthMethod, seen) {
    const refuse = (check) => { seen.check = check; return mmFail(REASON); };
    if (!isPlainRecord(value) || responseHash === undefined)
        return refuse("response_body");
    if (value.requestId !== query.requestId)
        return refuse("response_request_id");
    if (value.kind !== "transaction")
        return refuse("response_kind");
    const status = submitToken(value.status);
    if (status === null) {
        seen.providerStatus = null;
        return refuse("response_status");
    }
    if (!isPlainRecord(value.tx) || String(value.tx.from).toLowerCase() !== query.sender || value.tx.chainId !== query.chainId) {
        seen.tx = jobTx(value.tx, { binding: { address: query.sender }, request: { chainId: query.chainId } });
        seen.providerStatus = status;
        return refuse("response_tx");
    }
    if (value.txHash !== undefined && value.txHash !== null)
        seen.check = "response_hash";
    const txHash = value.txHash === undefined || value.txHash === null ? null : mmHex(value.txHash, 32, REASON);
    seen.check = undefined;
    return { requestId: query.requestId, found: true, status, txHash, mfa: approvalWindow(status, value.approval, sessionAuthMethod), responseHash };
}
export function serverRequestNotFound(query) {
    return { requestId: query.requestId, found: false, status: null, txHash: null, mfa: null, responseHash: null };
}
//# sourceMappingURL=server-request.js.map