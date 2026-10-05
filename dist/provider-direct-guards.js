import { ApnError } from "./errors.js";
import { capabilityHash } from "./provider-profile.js";
export function requiredProviderBinding(operation) {
    if (operation.providerDirect === undefined)
        throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not provider-atomic.");
    return operation.providerDirect;
}
export async function requiredProviderDirectProfile(context, profileHash) {
    const profile = await context.requireProfileRepository().load(profileHash);
    if (profile === null || profile.drift.state !== "bound" || profile.capability_snapshot.direct.available !== true || !((profile.capability_snapshot.direct.mode === "provider_atomic_send" &&
        profile.capability_snapshot.direct.execution_owner === "provider" &&
        profile.capability_snapshot.direct.retry_owner === "apn_outer_no_replay_journal") ||
        (profile.capability_snapshot.direct.mode === "delegated_session_transaction" &&
            profile.capability_snapshot.direct.execution_owner === "apn" &&
            profile.capability_snapshot.direct.retry_owner === "apn_operation_state")))
        throw new ApnError("APN_PROFILE_DRIFT", "The provider profile is not bound for direct payment effects.");
    return profile;
}
export function requiredProviderDirectAdapter(context, binding) {
    const adapter = context.requireProviderRegistry().resolve(binding.providerId);
    if (adapter.direct?.mode !== binding.executionMode || adapter.direct.execute === undefined ||
        capabilityHash(adapter.capabilities) !== binding.capabilityHash ||
        adapter.capabilities.direct.available !== true || adapter.capabilities.direct.mode !== binding.executionMode ||
        adapter.capabilities.evidence.available !== true || adapter.capabilities.evidence.owner !== "apn")
        throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The bound provider direct effect is unavailable.");
    return adapter;
}
//# sourceMappingURL=provider-direct-guards.js.map