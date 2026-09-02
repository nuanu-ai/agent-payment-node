export async function observeProviderDirectRequest(adapter, operation, waitSeconds) {
    const direct = adapter.direct;
    if (direct?.observe === undefined) {
        return { disposition: "ambiguous", reason: "provider_recovery_unavailable" };
    }
    let result;
    try {
        result = await direct.observe({
            recoveryToken: operation.providerEffect.recoveryToken,
            sender: operation.walletAddress,
            ...(waitSeconds === undefined ? {} : { waitSeconds }),
        });
    }
    catch {
        return { disposition: "unchanged" };
    }
    if (result.disposition !== "pending")
        return result;
    return result.recoveryToken === operation.providerEffect.recoveryToken
        ? { disposition: "unchanged" }
        : { disposition: "ambiguous", reason: "provider_recovery_identity_mismatch" };
}
export function createProviderEffectReference(recoveryToken, providerState) {
    return {
        schemaVersion: "apn.provider-effect-reference.v1",
        kind: "transaction",
        recoveryToken,
        providerState,
    };
}
export function sameFrozenProviderProfile(profile, operation, binding) {
    return profile.provider_id === binding.providerId && profile.revision === binding.profileRevision &&
        profile.capability_hash === binding.capabilityHash && profile.account_binding_hash === binding.accountBindingHash &&
        profile.public_address.toLowerCase() === operation.walletAddress.toLowerCase();
}
//# sourceMappingURL=provider-direct-recovery.js.map