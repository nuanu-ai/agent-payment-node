import { sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { effectiveX402Cap } from "./profile-policy.js";
import { capabilityHash, LOCAL_PROVIDER_ID, markProviderProfileDrift } from "./provider-profile.js";
import { assertProviderPolicyBalance, sameFrozenProviderPolicy } from "./provider-x402-policy.js";
export async function requireProviderX402Profile(context, profileHash) {
    const profile = await context.requireProfileRepository().load(profileHash);
    if (profile === null || profile.drift.state !== "bound" || profile.provider_id === LOCAL_PROVIDER_ID ||
        profile.capability_snapshot.x402.available !== true ||
        profile.capability_snapshot.x402.mode !== "provider_atomic_paid_fetch" ||
        profile.capability_snapshot.x402.execution_owner !== "provider" ||
        profile.capability_snapshot.x402.retry_owner !== "apn_outer_no_replay_journal")
        throw new ApnError("APN_PROFILE_DRIFT", "The provider profile is not bound for x402 payment effects.");
    return profile;
}
export function requireProviderX402Adapter(context, profile) {
    const adapter = context.requireProviderRegistry().resolve(profile.provider_id);
    if (adapter.x402?.mode !== "provider_atomic_paid_fetch" || adapter.x402.execute === undefined ||
        adapter.x402.prime === undefined || adapter.x402.assertCompatibleIntent === undefined ||
        capabilityHash(adapter.capabilities) !== profile.capability_hash || adapter.capabilities.evidence.owner !== "apn")
        throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The bound provider x402 effect is unavailable.");
    return adapter;
}
export async function observeProviderX402Balance(context, profile, adapter) {
    await adapter.lifecycle.probeStatus();
    const startedAt = context.clock.now().getTime();
    const observed = await adapter.reads.observeBalance();
    const finishedAt = context.clock.now().getTime();
    await adapter.reads.crossCheckAddress(profile.public_address);
    const observedCapability = capabilityHash(adapter.capabilities);
    const observedAt = Date.parse(observed.observed_at);
    if (observed.chain !== "base" || observed.asset !== "USDC" || observed.decimals !== 6 ||
        !/^(?:0|[1-9][0-9]*)$/u.test(observed.raw) || !Number.isFinite(observedAt) ||
        new Date(observedAt).toISOString() !== observed.observed_at || observedAt < startedAt || observedAt > finishedAt)
        throw new ApnError("APN_PROVIDER_PROTOCOL", "Provider balance observation is stale, unbound or invalid.");
    if (observed.address.toLowerCase() !== profile.public_address.toLowerCase() ||
        observed.account_binding_hash !== profile.account_binding_hash || observedCapability !== profile.capability_hash) {
        await context.requireProfileRepository().save(markProviderProfileDrift(profile, {
            address: observed.address,
            accountBindingHash: observed.account_binding_hash,
            capabilityHash: observedCapability,
            observedAt: observed.observed_at,
            trustClass: adapter.trust_class,
        }));
        throw new ApnError("APN_PROFILE_DRIFT", "Provider identity or capability changed; explicit rebind is required.");
    }
    return observed;
}
export function assertFrozenProviderX402Policy(operation, policy, balance) {
    const cap = effectiveX402Cap(policy, operation.policy.callerCapAtomic);
    if (!sameFrozenProviderPolicy(operation, policy, cap)) {
        throw new ApnError("APN_REPREPARE_REQUIRED", "The bound x402 policy changed before provider effect.");
    }
    assertProviderPolicyBalance(policy, balance, operation.requirement.amountAtomic);
}
export function assertProviderX402RpcBinding(context, operation) {
    if (sha256(`provider-x402-rpc\0${canonicalProviderX402RpcUrl(context.requireRpcUrl())}`) !== operation.rpcBindingHash) {
        throw new ApnError("APN_RPC_CONFIG", "Provider x402 recovery RPC URL changed from the frozen operation.");
    }
}
export function canonicalProviderX402RpcUrl(value) {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.hash.length > 0) {
        throw new ApnError("APN_RPC_CONFIG", "Provider x402 requires one credential-free normalized HTTPS RPC URL.");
    }
    return parsed.toString();
}
//# sourceMappingURL=provider-x402-preconditions.js.map