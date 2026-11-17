import { ApnError } from "../../errors.js";
import { listProviderRequestReferences, providerRequestReferenceHash } from "../../provider-request-reference-store.js";
import { mmDispatchIntent } from "../dispatch.js";
/**
 * The MetaMask request ids of an operation's delegation disables (`apn gasless transfer revoke`). The disable records
 * nothing in its operation: the chain is the record. From 0.5.109 APN names each request id itself, seals it before the
 * request is sent (provider-request-reference-store.ts, lane `metamask-revocation`, one record per request, never
 * replaced) and removes that seal again only when the helper provably stopped before any network call. `operation
 * resume` reads MetaMask's job status of each sealed request by its id. Releases up to 0.5.108 kept no id, so the
 * requests they sent cannot be read again.
 */
const PROVIDER = "metamask-agent-wallet";
/**
 * The most sealed disable requests one resume reads: the newest ones, by when each was sealed. Each read is its own
 * helper run. Every older request is still reported, with `revocation_request_read_limit`, and is not opened. Revoke
 * itself has no limit.
 */
export const MM_REVOCATION_REQUEST_READ_LIMIT = 16;
/** The hash that names a disable request in output (`requestIdHash`, `request_id_hash`) in place of its id. */
export function metaMaskRevocationRequestIdHash(requestId) {
    return providerRequestReferenceHash(PROVIDER, requestId);
}
function reference(op, requestIdHash) {
    return { lane: "metamask-revocation", providerId: PROVIDER, profileHash: op.profileHash, operationId: op.operationId, referenceHash: requestIdHash };
}
const scope = (op) => ({ lane: "metamask-revocation", profileHash: op.profileHash, operationId: op.operationId });
/**
 * Seals `requestId` for `op` and returns the hash that names it; the caller holds the operation lock and sends the
 * request only after this returns. A seal that fails keeps its own code, reason and steps, and says nothing was sent.
 */
export async function sealMetaMaskRevocationRequest(references, op, requestId) {
    const requestIdHash = metaMaskRevocationRequestIdHash(requestId);
    try {
        await references.seal(reference(op, requestIdHash), requestId);
    }
    catch (error) {
        if (!(error instanceof ApnError))
            throw error;
        throw new ApnError(error.code, `${error.message} The disable was not sent.`, error.details);
    }
    return requestIdHash;
}
/**
 * Removes the seal of a request whose helper provably stopped before any network call: MetaMask never received it, so
 * there is nothing to read again. Under the same locks as its seal, by its exact binding. Returns the closed reason when
 * the seal could not be removed (it then stays, and resume reports MetaMask's 404 for it); it never throws.
 */
export async function discardMetaMaskRevocationRequest(references, op, requestIdHash) {
    try {
        await references.discard(reference(op, requestIdHash));
        return undefined;
    }
    catch (error) {
        return closedReason(error, "provider_request_reference_discard_failed");
    }
}
/**
 * Under the operation lock, after resume's chain reads: lists the operation's sealed disable requests, newest first (the
 * listing's order, which output keeps), and opens the id of each up to the read limit. Nothing is sealed: `undefined`,
 * and resume adds no field. A listing that fails, or a reader that is not wired while requests are sealed, is one
 * `refused` entry with no hash; it never fails the resume. An id that cannot be opened is its own `refused` entry; an
 * older request past the read limit is reported and not opened. Nothing here reads MetaMask.
 */
export async function openMetaMaskRevocationRequests(state, dependencies, op) {
    let records;
    try {
        records = await listProviderRequestReferences(state, scope(op));
    }
    catch (error) {
        return { requests: [{ kind: "reported", read: refused(null, closedReason(error, "provider_request_reference_listing_unreadable"), null) }] };
    }
    if (records.length === 0)
        return undefined;
    if (dependencies === undefined)
        return { requests: [{ kind: "reported", read: refused(null, "revocation_request_reader_unavailable", null) }] };
    const requests = [];
    for (const [index, { referenceHash: hash }] of records.entries()) {
        if (index >= MM_REVOCATION_REQUEST_READ_LIMIT) {
            requests.push({ kind: "reported", read: refused(hash, "revocation_request_read_limit", null) });
            continue;
        }
        try {
            requests.push({ kind: "opened", hash, requestId: await dependencies.references.open(reference(op, hash)) });
        }
        catch (error) {
            requests.push({ kind: "reported", read: refused(hash, closedReason(error, "provider_request_reference_unreadable"), null) });
        }
    }
    if (!requests.some(request => request.kind === "opened"))
        return { requests };
    const dispatched = mmDispatchIntent(op);
    return { requests, reading: { reader: dependencies.reader, binding: { sender: dispatched.binding.address, chainId: dispatched.request.chainId } } };
}
/**
 * After the operation lock is released, under the provider-session lock: the session's project once, then MetaMask's
 * answer for each opened id through the sandboxed helper, in the listing's order. They write nothing, and the seals they
 * read are create-only. A failure of one request is that entry's own `refused` reason; without a session project every
 * opened request carries that reason and none is read. A provider-session lock that cannot be taken (another command
 * holds the MetaMask session) gives every opened request that lock's reason, and none is read.
 */
export async function readMetaMaskRevocationRequests(opened, providerSession) {
    const reading = opened.reading;
    if (reading === undefined)
        return opened.requests.map(request => request.kind === "reported" ? request.read : internal());
    try {
        return await providerSession(async () => await readOpened(opened.requests, reading));
    }
    catch (error) {
        const reason = closedReason(error, "metamask_provider_session_unavailable");
        return opened.requests.map(request => request.kind === "reported" ? request.read : refused(request.hash, reason, null));
    }
}
/** Never throws: the project read and each request read keep their own failure. */
async function readOpened(requests, reading) {
    let project;
    try {
        project = await reading.reader.sessionProject();
    }
    catch (error) {
        project = { reason: closedReason(error, "metamask_session_read_failed") };
    }
    const reads = [];
    for (const request of requests) {
        reads.push(request.kind === "reported" ? request.read : await readOne(reading, request.hash, request.requestId, project));
    }
    return reads;
}
async function readOne(reading, hash, requestId, project) {
    if ("reason" in project)
        return refused(hash, project.reason, null);
    let answer;
    try {
        answer = await reading.reader.read(requestId, project.projectHash, reading.binding);
    }
    catch (error) {
        return refused(hash, closedReason(error, "metamask_server_read_unclassified"), null);
    }
    if (answer.outcome === "refused")
        return refused(hash, answer.reason, answer.check);
    if (answer.outcome === "not_found") {
        return { request_id_hash: hash, outcome: "not_found", status: null, transaction_hash: null, mfa: null, response_hash: null, reason: null, check: null };
    }
    return { request_id_hash: hash, outcome: "verified", status: answer.status, transaction_hash: answer.transactionHash,
        mfa: answer.mfa === null ? null : { expires_at: answer.mfa.expiresAt, auth_method: answer.mfa.authMethod },
        response_hash: answer.responseHash, reason: null, check: null };
}
function refused(hash, reason, check) {
    return { request_id_hash: hash, outcome: "refused", status: null, transaction_hash: null, mfa: null, response_hash: null, reason, check };
}
const REASON = /^[a-z][a-z0-9_]{0,63}$/u;
/** An APN refusal's own closed reason, else its error code; any other failure is `unclassified`. Never error text. */
function closedReason(error, unclassified) {
    if (!(error instanceof ApnError))
        return unclassified;
    const reason = error.details?.reason;
    return typeof reason === "string" && REASON.test(reason) ? reason : error.code.toLowerCase();
}
function internal() {
    throw new ApnError("APN_INTERNAL", "A sealed disable request was opened without a reader.");
}
//# sourceMappingURL=requests.js.map