import { ApnError } from "./errors.js";
import { METAMASK_NATIVE_REQUEST_UNSEALED, metaMaskNativeMfaTask, metaMaskNativeRequestIdHash, metaMaskNativeRequestReference, metaMaskNativeSealedMfaTask } from "./metamask-native-journal.js";
/** Seals the request id the hand-off returned for `op` and returns the hash its journal keeps in its place. */
export async function sealMetaMaskNativeRequest(references, op, requestId) {
    const requestIdHash = metaMaskNativeRequestIdHash(requestId);
    await references.seal(metaMaskNativeRequestReference(op, requestIdHash), requestId);
    return requestIdHash;
}
/**
 * Seals the request id the hand-off returned. This runs after the hand-off, so nothing may stop its outcome from being
 * recorded: a seal that fails (the wrapping secret was read before consent, so only a write can fail) drops the id,
 * which is never kept in plaintext, and the journal says why it keeps no request.
 */
export async function keepMetaMaskNativeRequest(references, op, requestId) {
    try {
        return { requestIdHash: await sealMetaMaskNativeRequest(references, op, requestId) };
    }
    catch {
        return { unsealed: true };
    }
}
/**
 * The journal fields the hand-off's result writes: its state, transaction hash and diagnostic as returned, the hash of a
 * sealed request id with the owner's MFA task, or `providerRequestReason` for a request id that could not be sealed.
 */
export function metaMaskNativeHandoffFields(result, kept) {
    const diagnostic = result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic };
    if (result.disposition === "acknowledged")
        return { ...diagnostic, state: "acknowledged", transactionHash: result.transactionHash };
    const requestIdHash = kept !== undefined && "requestIdHash" in kept ? kept.requestIdHash : undefined;
    // A pending or unknown hand-off stays financially UNKNOWN; an owner approval the provider waits on is kept beside it.
    const mfa = requestIdHash !== undefined && result.mfa !== undefined && result.transactionHash === undefined
        ? { mfaTask: metaMaskNativeSealedMfaTask(requestIdHash, result.mfa, "send") } : {};
    return { ...diagnostic, state: "unknown", transactionHash: result.transactionHash ?? null, providerRequestId: null,
        ...(requestIdHash === undefined ? {} : { providerRequestIdHash: requestIdHash }),
        ...(kept !== undefined && "unsealed" in kept ? { providerRequestReason: METAMASK_NATIVE_REQUEST_UNSEALED } : {}), ...mfa };
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
export function publicMetaMaskNativeReadObservation(observation, op) {
    const hash = op.providerRequestIdHash;
    if (hash === undefined)
        return observation;
    return Object.freeze(Object.fromEntries(Object.entries(observation).map(([key, value]) => key === "request_id" ? ["request_id_hash", hash] : [key, value])));
}
//# sourceMappingURL=metamask-native-request-reference.js.map