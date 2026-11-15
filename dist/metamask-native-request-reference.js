import { ApnError } from "./errors.js";
import { METAMASK_NATIVE_SDK_HANDOFF, metaMaskNativeMfaTask, metaMaskNativeRequestIdHash, metaMaskNativeRequestReference, metaMaskNativeSealedMfaTask } from "./metamask-native-journal.js";
/** Seals APN's request id for `op` and returns the hash its effect marker keeps in its place; the caller holds the lock. */
export async function sealMetaMaskNativeRequest(references, op, requestId) {
    const requestIdHash = metaMaskNativeRequestIdHash(requestId);
    await references.seal(metaMaskNativeRequestReference(op, requestIdHash), requestId);
    return requestIdHash;
}
/**
 * The journal fields the hand-off's result writes: its state, transaction hash and diagnostic as returned, and the
 * owner's MFA task named by `requestIdHash`, the hash the effect marker already keeps (it stays as written).
 */
export function metaMaskNativeHandoffFields(result, requestIdHash) {
    const diagnostic = result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic };
    if (result.disposition === "acknowledged")
        return { ...diagnostic, state: "acknowledged", transactionHash: result.transactionHash };
    // A pending or unknown hand-off stays financially UNKNOWN; an owner approval the provider waits on is kept beside it.
    const mfa = result.mfa !== undefined && result.transactionHash === undefined
        ? { mfaTask: metaMaskNativeSealedMfaTask(requestIdHash, result.mfa, "send") } : {};
    return { ...diagnostic, state: "unknown", transactionHash: result.transactionHash ?? null, ...mfa };
}
/**
 * The stored request id of `op`: kept in the record, or opened from its seal. A seal that cannot be opened (missing,
 * damaged, another transfer's, another secret, a refused Keychain) throws its own precise refusal before any read.
 */
export async function openMetaMaskNativeRequest(references, op) {
    if (op.providerRequestId !== null)
        return op.providerRequestId;
    if (op.providerRequestIdHash === undefined)
        throw new ApnError("APN_STATE_CORRUPT", "Native transfer stores no provider request to read.");
    if (references === undefined)
        throw new ApnError("APN_INTERNAL", "The sealed provider request reference store is unavailable.");
    return await references.open(metaMaskNativeRequestReference(op, op.providerRequestIdHash));
}
/** The owner's MFA task for the stored request, naming it as the record does: by the id, or by the hash of a sealed id. */
export function metaMaskNativeRequestTask(op, evidence, source) {
    if (op.providerRequestIdHash !== undefined)
        return metaMaskNativeSealedMfaTask(op.providerRequestIdHash, evidence, source);
    if (op.providerRequestId === null)
        throw new ApnError("APN_STATE_CORRUPT", "Native transfer stores no provider request for an MFA task.");
    return metaMaskNativeMfaTask(op.providerRequestId, evidence, source);
}
/**
 * The approval window a read of a request APN sent itself records. A server answer that names no `approval.expiresAt`
 * keeps the non-null `expiresAt` the task already holds for the same request (the same `requestIdHash`), from the send or
 * an earlier read, rather than erasing it: the window of one request does not move. The kept expiry keeps the
 * `evidenceHash` of the answer that named it, since the new answer's hash does not cover it; the auth method is the
 * read's own. A record 0.5.107 or earlier wrote takes the read's evidence as it always did.
 */
export function metaMaskNativeReadEvidence(op, evidence) {
    const task = op.mfaTask;
    if (op.handoffPath !== METAMASK_NATIVE_SDK_HANDOFF || evidence.expiresAt !== null || task === undefined || !("requestIdHash" in task) ||
        task.requestIdHash !== op.providerRequestIdHash || task.expiresAt === null)
        return evidence;
    return { ...evidence, expiresAt: task.expiresAt, evidenceHash: task.evidenceHash };
}
export function publicMetaMaskNativeReadObservation(observation, op) {
    const hash = op.providerRequestIdHash;
    if (hash === undefined)
        return observation;
    return Object.freeze(Object.fromEntries(Object.entries(observation).map(([key, value]) => key === "request_id" ? ["request_id_hash", hash] : [key, value])));
}
//# sourceMappingURL=metamask-native-request-reference.js.map