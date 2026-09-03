import { CHAIN_CAIP2, BASE_USDC, ETH_DECIMALS, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { formatAtomic, parseAtomic } from "./money.js";
import { accountBindingHash, capabilityHash, markProviderProfileDrift, } from "./provider-profile.js";
import { publicPermissionProfile } from "./provider-permission-output.js";
import { upgradeProviderProfile } from "./provider-profile-upgrade.js";
import { canonicalIdempotencyKey } from "./transfer-policy.js";
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
            let existing = await repository.load(profileHash);
            if (existing !== null) {
                if (existing.provider_id !== request.providerId) {
                    throw new ApnError("APN_PROFILE_DRIFT", "The APN profile is already bound to a different provider.");
                }
            }
            const adapter = this.context.requireProviderRegistry().resolve(request.providerId);
            if (existing !== null)
                existing = await upgradeProviderProfile(adapter, existing, repository);
            if (hasPermissionIntent(request) && adapter.permissions === undefined) {
                throw new ApnError("APN_INVALID_INPUT", "Permission arguments are valid only for a permission-lifecycle provider.");
            }
            if (adapter.permissions !== undefined) {
                return await this.connectPermissionProfile(request, profile, profileHash, existing, adapter, adapter.permissions);
            }
            if (existing === null && request.expectedRevision !== undefined) {
                throw revisionConflict("Initial provider connection must omit --expected-revision.");
            }
            if (existing !== null && request.expectedRevision !== undefined && request.expectedRevision !== existing.revision) {
                throw revisionConflict("The expected profile revision is stale.");
            }
            if (request.authenticationMethod !== undefined &&
                !adapter.lifecycle.authenticationMethods?.includes(request.authenticationMethod)) {
                throw new ApnError("APN_INVALID_INPUT", "The requested authentication method is not supported by this wallet provider.");
            }
            await adapter.lifecycle.connect(this.context.requireForegroundAuthentication(), {
                ...(request.authenticationMethod === undefined ? {} : { authenticationMethod: request.authenticationMethod }),
            });
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
            let current = await repository.load(profileHash);
            if (current === null)
                throw new ApnError("APN_STATE_CORRUPT", "Provider profile disappeared during status.");
            const adapter = this.context.requireProviderRegistry().resolve(current.provider_id);
            current = await upgradeProviderProfile(adapter, current, repository);
            if (adapter.permissions !== undefined) {
                let permission = await adapter.permissions.read(profileHash);
                if (permission === null) {
                    throw new ApnError("APN_STATE_CORRUPT", "The Smart Account profile has no committed permission record.");
                }
                if (permission.state === "grant_committed_pending_profile") {
                    permission = await adapter.permissions.activate(profileHash);
                }
                const observed = permissionObservation(adapter, permission);
                const checked = sameBinding(current, observed)
                    ? alignPermissionProfile(current, adapter, permission)
                    : alignPermissionRevision(markProviderProfileDrift(current, observed), permission);
                if (checked !== current)
                    await repository.save(checked);
                return publicPermissionProfile(checked, permission, true);
            }
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
            let bound = await this.context.requireProfileRepository().load(profileHash);
            if (bound === null || bound.provider_id === "local") {
                throw new ApnError("APN_STATE_CORRUPT", "Provider profile changed during balance read.");
            }
            const adapter = this.context.requireProviderRegistry().resolve(bound.provider_id);
            bound = await upgradeProviderProfile(adapter, bound, this.context.requireProfileRepository());
            if (adapter.permissions !== undefined) {
                let permission = await adapter.permissions.read(profileHash);
                if (permission === null) {
                    throw new ApnError("APN_STATE_CORRUPT", "The Smart Account profile has no committed permission record.");
                }
                if (permission.state === "grant_committed_pending_profile") {
                    permission = await adapter.permissions.activate(profileHash);
                }
                const observed = permissionObservation(adapter, permission);
                if (!sameBinding(bound, observed) || bound.drift.state !== "bound") {
                    const drifted = bound.drift.state === "bound" ? markProviderProfileDrift(bound, observed) : bound;
                    if (drifted !== bound)
                        await this.context.requireProfileRepository().save(drifted);
                    throw new ApnError("APN_PROFILE_DRIFT", "Provider identity or capabilities changed; balance remains unavailable until a new foreground identity is created.");
                }
                const [owner, session] = await Promise.all([
                    this.context.requireRpc().getBalances(permission.owner_address),
                    this.context.requireRpc().getBalances(permission.session_address),
                ]);
                validateBalance(owner, permission.owner_address);
                validateBalance(session, permission.session_address);
                return permissionBalance(profile, bound, permission, owner, session);
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
        await this.context.ready();
        await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            const repository = this.context.requireProfileRepository();
            let bound = await repository.load(profileHash);
            if (bound === null || bound.provider_id === "local")
                return;
            const adapter = this.context.requireProviderRegistry().resolve(bound.provider_id);
            bound = await upgradeProviderProfile(adapter, bound, repository);
            if (bound.drift.state !== "bound") {
                throw new ApnError("APN_PROFILE_DRIFT", "Provider profile drift blocks new payment effects.");
            }
            const capability = kind === "direct" ? bound.capability_snapshot.direct : bound.capability_snapshot.x402;
            if (!capability.available) {
                if (bound.capability_snapshot.permission === undefined &&
                    (kind === "direct" || bound.provider_id === "metamask-agent-wallet")) {
                    throw new ApnError("APN_PROFILE_DRIFT", `The persisted provider profile predates ${kind}-effect binding; explicit foreground rebind is required.`, {
                        current_revision: String(bound.revision),
                    });
                }
                throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "This provider profile does not support the requested payment effect in this APN version.");
            }
        });
    }
    async connectPermissionProfile(request, profile, profileHash, existing, adapter, permissions) {
        if (request.authenticationMethod !== "browser") {
            throw new ApnError("APN_INVALID_INPUT", "MetaMask Smart Account connect requires --auth-method browser.");
        }
        if (request.expectedRevision !== undefined) {
            throw new ApnError("APN_INVALID_INPUT", "Permission-lifecycle connect does not accept --expected-revision; retry with the same idempotency key.");
        }
        const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey);
        const capAtomic = parseAtomic(request.permissionCapUsdcAtomic, { positive: true }).toString();
        if (!Number.isSafeInteger(request.permissionExpiresAt) || Number(request.permissionExpiresAt) <= 0) {
            throw new ApnError("APN_INVALID_INPUT", "Permission expiry must be a positive absolute Unix timestamp.");
        }
        if (existing !== null && await permissions.read(profileHash) === null) {
            throw new ApnError("APN_STATE_CORRUPT", "The Smart Account profile has no committed permission record.");
        }
        const permission = await permissions.connect({
            profile,
            profileHash,
            authenticationMethod: "browser",
            idempotencyKey,
            capAtomic,
            expiresAtUnix: Number(request.permissionExpiresAt),
        });
        const observed = permissionObservation(adapter, permission);
        let bound;
        if (existing === null) {
            bound = boundProfile({
                profile,
                profileHash,
                providerId: adapter.provider_id,
                revision: permission.revision,
                capabilities: adapter.capabilities,
                ...observed,
            });
            await this.context.requireProfileRepository().save(bound);
        }
        else {
            if (!sameBinding(existing, observed) || existing.drift.state !== "bound") {
                throw new ApnError("APN_PROFILE_DRIFT", "The persisted Smart Account binding differs from the exact committed permission.");
            }
            bound = alignPermissionProfile(existing, adapter, permission);
            if (bound !== existing)
                await this.context.requireProfileRepository().save(bound);
        }
        const active = await permissions.activate(profileHash);
        const aligned = alignPermissionProfile(bound, adapter, active);
        if (aligned !== bound)
            await this.context.requireProfileRepository().save(aligned);
        return publicPermissionProfile(aligned, active, existing !== null);
    }
}
function hasPermissionIntent(request) {
    return request.permissionCapUsdcAtomic !== undefined || request.permissionExpiresAt !== undefined || request.idempotencyKey !== undefined;
}
function permissionObservation(adapter, permission) {
    return {
        address: permission.owner_address,
        accountBindingHash: accountBindingHash(adapter.provider_id, permission.owner_address),
        capabilityHash: capabilityHash(adapter.capabilities),
        observedAt: permission.observed_at,
        trustClass: adapter.trust_class,
    };
}
function alignPermissionProfile(profile, adapter, permission) {
    const observed = permissionObservation(adapter, permission);
    if (permission.revision < profile.revision && sameBinding(profile, observed))
        return profile;
    if (profile.revision === permission.revision && profile.observed_at === permission.observed_at && sameBinding(profile, observed)) {
        return profile;
    }
    return {
        ...profile,
        revision: Math.max(profile.revision, permission.revision),
        observed_at: permission.observed_at,
        public_address: permission.owner_address,
        account_binding_hash: observed.accountBindingHash,
        capability_snapshot: adapter.capabilities,
        capability_hash: observed.capabilityHash,
        trust_class: adapter.trust_class,
    };
}
function alignPermissionRevision(profile, permission) {
    if (profile.observed_at === permission.observed_at)
        return profile;
    return { ...profile, revision: Math.max(profile.revision + 1, permission.revision), observed_at: permission.observed_at };
}
function permissionBalance(profile, bound, permission, owner, session) {
    const balances = (snapshot) => ({
        ETH: { atomic: snapshot.ethAtomic, decimal: formatAtomic(snapshot.ethAtomic, ETH_DECIMALS), decimals: ETH_DECIMALS },
        USDC: {
            atomic: snapshot.usdcAtomic,
            decimal: formatAtomic(snapshot.usdcAtomic, USDC_DECIMALS),
            decimals: USDC_DECIMALS,
            contract: BASE_USDC,
        },
    });
    return {
        profile,
        provider: bound.provider_id,
        revision: bound.revision,
        capability_hash: bound.capability_hash,
        status: permission.state,
        funding_address: permission.owner_address,
        explorer_url: `https://basescan.org/address/${permission.owner_address}`,
        chain: CHAIN_CAIP2,
        proof_class: "chain_verified_public_read",
        balances: balances(owner),
        provenance: publicProvenance(owner),
        accounts: {
            owner_smart_account: {
                address: permission.owner_address,
                role: "funding_and_usdc_owner",
                balances: balances(owner),
                provenance: publicProvenance(owner),
            },
            session_execution_account: {
                address: permission.session_address,
                role: "delegated_execution_and_gas",
                balances: balances(session),
                provenance: publicProvenance(session),
                gas_readiness: parseAtomic(session.ethAtomic) === 0n
                    ? "not_ready_zero_balance"
                    : "unverified_sufficiency_nonzero",
            },
        },
        funding_guidance: {
            action: `Manually send only Base USDC to owner Smart Account ${permission.owner_address}; future delegated execution also requires Base ETH at session ${permission.session_address}.`,
            warning: "This read performs no funding action and does not prove future effect availability or gas sufficiency.",
        },
        next_actions: permission.state === "active"
            ? ["Fund manually only if intended", "Re-run apn wallet balance"]
            : ["Review the permission lifecycle state before any future effect."],
    };
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