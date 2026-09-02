import { CHAIN_CAIP2, BASE_USDC, ETH_DECIMALS, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { formatAtomic } from "./money.js";
import { capabilityHash, markProviderProfileDrift, } from "./provider-profile.js";
import { canonicalProfile, publicProvenance, validateBalance } from "./wallet-policy.js";
export class ProviderWalletService {
    context;
    constructor(context) {
        this.context = context;
    }
    async connect(request) {
        const profile = canonicalProfile(request.profile);
        await this.context.ready();
        const profileHash = this.context.state.profileHash(profile);
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            const repository = this.context.requireProfileRepository();
            const existing = await repository.load(profileHash);
            if (existing === null && request.expectedRevision !== undefined) {
                throw revisionConflict("Initial provider connection must omit --expected-revision.");
            }
            if (existing !== null) {
                if (existing.provider_id !== request.providerId) {
                    throw new ApnError("APN_PROFILE_DRIFT", "The APN profile is already bound to a different provider.");
                }
                if (request.expectedRevision !== undefined && request.expectedRevision !== existing.revision) {
                    throw revisionConflict("The expected profile revision is stale.");
                }
            }
            const adapter = this.context.requireProviderRegistry().resolve(request.providerId);
            await adapter.lifecycle.connect(this.context.requireForegroundAuthentication());
            const observation = await adapter.reads.observeBalance();
            const observedCapabilityHash = capabilityHash(adapter.capabilities);
            const observed = {
                address: observation.address,
                accountBindingHash: observation.account_binding_hash,
                capabilityHash: observedCapabilityHash,
                observedAt: observation.observed_at,
                trustClass: adapter.trust_class,
            };
            if (existing === null) {
                const created = boundProfile({
                    profile,
                    profileHash,
                    providerId: adapter.provider_id,
                    revision: 1,
                    capabilities: adapter.capabilities,
                    ...observed,
                });
                await repository.save(created);
                return publicProfile(created, false);
            }
            const same = sameBinding(existing, observed);
            if (same && existing.drift.state === "bound")
                return publicProfile(existing, true);
            const drifted = existing.drift.state === "bound"
                ? markProviderProfileDrift(existing, observed)
                : existing;
            if (drifted !== existing)
                await repository.save(drifted);
            if (request.expectedRevision === undefined) {
                throw new ApnError("APN_PROFILE_DRIFT", "Provider identity or capabilities changed; explicit foreground rebind is required.", {
                    current_revision: String(existing.revision),
                });
            }
            const confirmed = await this.context.requireForegroundAuthentication().confirmRebind({
                profile,
                revision: existing.revision,
                current_address: existing.public_address,
                observed_address: observed.address,
                current_capability_hash: existing.capability_hash,
                observed_capability_hash: observed.capabilityHash,
                current_trust_class: existing.trust_class,
                observed_trust_class: observed.trustClass,
            });
            if (!confirmed)
                throw new ApnError("APN_PROFILE_DRIFT", "Provider profile rebind was not confirmed.");
            const rebound = boundProfile({
                profile,
                profileHash,
                providerId: adapter.provider_id,
                revision: existing.revision + 1,
                capabilities: adapter.capabilities,
                ...observed,
            });
            await repository.save(rebound);
            return publicProfile(rebound, false);
        });
    }
    async status(profileInput) {
        if (this.context.profileRepository === undefined)
            return null;
        const profile = canonicalProfile(profileInput);
        const profileHash = this.context.state.profileHash(profile);
        const existing = await this.context.requireProfileRepository().load(profileHash);
        if (existing === null || existing.provider_id === "local")
            return null;
        await this.context.ready();
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            const repository = this.context.requireProfileRepository();
            const current = await repository.load(profileHash);
            if (current === null)
                throw new ApnError("APN_STATE_CORRUPT", "Provider profile disappeared during status.");
            const adapter = this.context.requireProviderRegistry().resolve(current.provider_id);
            await adapter.lifecycle.probeStatus();
            const observation = await adapter.reads.observeBalance();
            await adapter.reads.crossCheckAddress(observation.address);
            const observed = {
                address: observation.address,
                accountBindingHash: observation.account_binding_hash,
                capabilityHash: capabilityHash(adapter.capabilities),
                observedAt: observation.observed_at,
                trustClass: adapter.trust_class,
            };
            const drifted = current.drift.state === "bound" && !sameBinding(current, observed)
                ? markProviderProfileDrift(current, observed)
                : current;
            if (drifted !== current)
                await repository.save(drifted);
            return publicProfile(drifted, true);
        });
    }
    async balance(profileInput) {
        if (this.context.profileRepository === undefined)
            return null;
        const profile = canonicalProfile(profileInput);
        const profileHash = this.context.state.profileHash(profile);
        const existing = await this.context.requireProfileRepository().load(profileHash);
        if (existing === null || existing.provider_id === "local")
            return null;
        await this.context.ready();
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            const bound = await this.context.requireProfileRepository().load(profileHash);
            if (bound === null || bound.provider_id === "local") {
                throw new ApnError("APN_STATE_CORRUPT", "Provider profile changed during balance read.");
            }
            const snapshot = await this.context.requireRpc().getBalances(bound.public_address);
            validateBalance(snapshot, bound.public_address);
            const rebindCommand = `apn wallet connect --profile ${profile} --provider ${bound.provider_id} --expected-revision ${bound.revision}`;
            return {
                profile,
                provider: bound.provider_id,
                revision: bound.revision,
                capability_hash: bound.capability_hash,
                status: bound.drift.state,
                funding_address: bound.public_address,
                explorer_url: `https://basescan.org/address/${bound.public_address}`,
                chain: CHAIN_CAIP2,
                proof_class: "chain_verified_public_read",
                balances: {
                    ETH: { atomic: snapshot.ethAtomic, decimal: formatAtomic(snapshot.ethAtomic, ETH_DECIMALS), decimals: ETH_DECIMALS },
                    USDC: {
                        atomic: snapshot.usdcAtomic,
                        decimal: formatAtomic(snapshot.usdcAtomic, USDC_DECIMALS),
                        decimals: USDC_DECIMALS,
                        contract: BASE_USDC,
                    },
                },
                provenance: publicProvenance(snapshot),
                ...(bound.drift.state === "bound" ? {
                    funding_guidance: {
                        action: `Manually send only Base USDC to ${bound.public_address}, then perform a separate balance read.`,
                        warning: "This guidance performs no onramp, transfer, top-up or funding action and proves no finality, sufficiency or spending authority.",
                    },
                    next_actions: ["Fund manually only if intended", "Re-run apn wallet balance"],
                } : {
                    next_actions: [rebindCommand],
                }),
            };
        });
    }
    async assertPaymentAvailable(profileInput, kind) {
        if (this.context.profileRepository === undefined)
            return;
        const profile = canonicalProfile(profileInput);
        const profileHash = this.context.state.profileHash(profile);
        const bound = await this.context.requireProfileRepository().load(profileHash);
        if (bound === null || bound.provider_id === "local")
            return;
        if (bound.drift.state !== "bound") {
            throw new ApnError("APN_PROFILE_DRIFT", "Provider profile drift blocks new payment effects.");
        }
        const capability = kind === "direct" ? bound.capability_snapshot.direct : bound.capability_snapshot.x402;
        if (!capability.available) {
            if (kind === "direct" || bound.provider_id === "metamask-agent-wallet") {
                throw new ApnError("APN_PROFILE_DRIFT", `The persisted provider profile predates ${kind}-effect binding; explicit foreground rebind is required.`, { current_revision: String(bound.revision) });
            }
            throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "This provider profile does not support the requested payment effect in this APN version.");
        }
    }
}
function boundProfile(input) {
    return {
        schema_version: "apn.provider-profile.v1",
        profile: input.profile,
        profile_hash: input.profileHash,
        provider_id: input.providerId,
        public_address: input.address,
        account_binding_hash: input.accountBindingHash,
        trust_class: input.trustClass,
        revision: input.revision,
        capability_snapshot: input.capabilities,
        capability_hash: input.capabilityHash,
        observed_at: input.observedAt,
        drift: { state: "bound", reason: "none" },
    };
}
function sameBinding(profile, observed) {
    return profile.public_address.toLowerCase() === observed.address.toLowerCase() &&
        profile.account_binding_hash === observed.accountBindingHash &&
        profile.capability_hash === observed.capabilityHash &&
        profile.trust_class === observed.trustClass;
}
function publicProfile(profile, reused) {
    const rebindCommand = `apn wallet connect --profile ${profile.profile} --provider ${profile.provider_id} --expected-revision ${profile.revision}`;
    return {
        profile: profile.profile,
        provider: profile.provider_id,
        status: profile.drift.state,
        address: profile.public_address,
        account_binding_hash: profile.account_binding_hash,
        trust_class: profile.trust_class,
        revision: profile.revision,
        capability_hash: profile.capability_hash,
        observed_at: profile.observed_at,
        reused,
        proof_class: "provider_profile_binding",
        ...(profile.drift.state === "bound" ? {
            funding_guidance: {
                network: "Base",
                asset: "USDC",
                address: profile.public_address,
                action: "Fund manually only; APN performs no funding action.",
            },
            next_actions: ["Use apn wallet balance with an explicit Base RPC URL"],
        } : {
            next_actions: [rebindCommand],
        }),
    };
}
function revisionConflict(message) {
    return new ApnError("APN_PROFILE_REVISION_CONFLICT", message);
}
//# sourceMappingURL=provider-wallet-service.js.map