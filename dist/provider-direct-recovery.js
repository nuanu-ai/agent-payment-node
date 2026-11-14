import { ApnError } from "./errors.js";
import { providerRequestReferenceHash } from "./provider-request-reference-store.js";
/**
 * One no-replay read of the stored provider request. A sealed request id is opened first; a seal that cannot be opened
 * throws its own precise refusal before the provider is asked anything, and the operation is not advanced.
 */
export async function observeProviderDirectRequest(context, adapter, operation, waitSeconds) {
    const direct = adapter.direct;
    if (direct?.observe === undefined) {
        return { disposition: "ambiguous", reason: "provider_recovery_unavailable" };
    }
    const recoveryToken = await providerEffectRecoveryToken(context, operation);
    let result;
    try {
        result = await direct.observe({
            recoveryToken,
            sender: operation.walletAddress,
            ...(waitSeconds === undefined ? {} : { waitSeconds }),
        });
    }
    catch {
        return { disposition: "unchanged" };
    }
    if (result.disposition !== "pending")
        return result;
    return result.recoveryToken === recoveryToken
        ? { disposition: "unchanged" }
        : { disposition: "ambiguous", reason: "provider_recovery_identity_mismatch" };
}
/** A reference that keeps its id: every reference 0.5.106 or earlier wrote, and a delegated send's (the APN operation id). */
export function createProviderEffectReference(recoveryToken, providerState) {
    return {
        schemaVersion: "apn.provider-effect-reference.v1",
        kind: "transaction",
        recoveryToken,
        providerState,
    };
}
/**
 * A provider's own request id for `operation` (its pending MFA request, or one the owner recovers), sealed before the
 * record names it: the record keeps only its hash. The caller holds the operation lock and the record has no reference yet.
 */
export async function sealProviderEffectReference(references, operation, recoveryToken, providerState) {
    const recoveryTokenHash = providerRequestReferenceHash(requiredProviderId(operation), recoveryToken);
    await references.seal(providerEffectBinding(operation, recoveryTokenHash), recoveryToken);
    return { schemaVersion: "apn.provider-effect-reference.v2", kind: "transaction", recoveryTokenHash, providerState };
}
/**
 * Whether a direct send returns a provider request id that APN seals: a provider-atomic send whose provider can be asked
 * to observe its requests (MetaMask Guard MFA). One condition decides both the readiness before approval and the seal
 * after the effect, so no request id is ever sealed without the wrapping secret having been read first.
 */
export function providerSealsRequests(context, binding) {
    return binding.executionMode === "provider_atomic_send" &&
        context.requireProviderRegistry().resolve(binding.providerId).direct?.observe !== undefined;
}
/**
 * The reference a pending direct result is kept as: a delegated send's id is the APN operation id, which every output
 * already names, and is kept as is; a provider's own request id is sealed. Null for a provider-atomic send whose provider
 * cannot be asked about a request: APN could never read it again, so no id is kept (the caller records
 * `provider_recovery_unavailable`).
 */
export async function providerEffectReferenceFor(context, operation, binding, recoveryToken, providerState) {
    if (binding.executionMode === "delegated_session_transaction")
        return createProviderEffectReference(recoveryToken, providerState);
    if (!providerSealsRequests(context, binding))
        return null;
    return await sealProviderEffectReference(context.requireProviderRequestReferences(), operation, recoveryToken, providerState);
}
/**
 * Before the owner is asked to approve a send whose request id will be sealed, the wrapping secret that seals it is read
 * (or created for a state that holds nothing sealed). A refusal leaves the operation awaiting approval, untouched.
 */
export async function readyProviderEffectReferences(context, binding) {
    if (providerSealsRequests(context, binding))
        await context.requireProviderRequestReferences().ready();
}
/** The stored request id: kept by a version 1 reference, or opened from the seal of a version 2 one. */
export async function providerEffectRecoveryToken(context, operation) {
    const reference = operation.providerEffect;
    if (reference.schemaVersion === "apn.provider-effect-reference.v1")
        return reference.recoveryToken;
    return await context.requireProviderRequestReferences().open(providerEffectBinding(operation, reference.recoveryTokenHash));
}
/** The hash output shows for a stored reference (`provider_request_reference_hash`), whichever version keeps it. */
export function providerEffectReferenceHash(providerId, reference) {
    return reference.schemaVersion === "apn.provider-effect-reference.v1"
        ? providerRequestReferenceHash(providerId, reference.recoveryToken) : reference.recoveryTokenHash;
}
/** Whether a stored reference names this request id; a sealed one is compared by hash and never opened. */
export function providerEffectNames(providerId, reference, recoveryToken) {
    return providerEffectReferenceHash(providerId, reference) === providerRequestReferenceHash(providerId, recoveryToken);
}
function providerEffectBinding(operation, referenceHash) {
    return { lane: "provider-direct", providerId: requiredProviderId(operation), profileHash: operation.profileHash,
        operationId: operation.operationId, referenceHash };
}
function requiredProviderId(operation) {
    if (operation.providerDirect === undefined) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not a provider direct transfer.");
    }
    return operation.providerDirect.providerId;
}
export function canonicalProviderRecoveryToken(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(value)) {
        throw new ApnError("APN_INVALID_INPUT", "Provider request ID must be 1-256 safe ASCII characters.");
    }
    return value;
}
export function sameFrozenProviderProfile(profile, operation, binding) {
    return profile.provider_id === binding.providerId && profile.revision === binding.profileRevision &&
        profile.capability_hash === binding.capabilityHash && profile.account_binding_hash === binding.accountBindingHash &&
        profile.public_address.toLowerCase() === operation.walletAddress.toLowerCase();
}
//# sourceMappingURL=provider-direct-recovery.js.map