import { ApnError } from "./errors.js";
import { findPendingProviderPermission } from "./provider-permission-discovery.js";
import { publicPendingPermissionProfile, publicPermissionProfile } from "./provider-permission-output.js";
import { upgradeProviderProfile } from "./provider-profile-upgrade.js";
import { canonicalProfile } from "./wallet-policy.js";
export class ProviderPermissionService {
    context;
    constructor(context) {
        this.context = context;
    }
    async execute(request) {
        const profile = canonicalProfile(request.profile);
        await this.context.ready();
        const profileHash = this.context.state.profileHash(profile);
        return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
            const repository = this.context.requireProfileRepository();
            let bound = await repository.load(profileHash);
            if (bound === null || bound.provider_id === "local") {
                const pending = await findPendingProviderPermission(this.context.requireProviderRegistry(), profileHash);
                if (pending === null) {
                    throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The profile has no provider permission lifecycle.");
                }
                if (request.command === "wallet.permission.list") {
                    return publicPendingPermissionProfile(profile, pending.adapter, pending.permission);
                }
                if (request.command === "wallet.permission.forget") {
                    assertPendingExpectedRevision(pending.permission.revision, request.expectedRevision);
                    const forgotten = await pending.lifecycle.forget(profileHash, request.expectedRevision);
                    return forgottenOutput(profile, pending.adapter.provider_id, forgotten.warning);
                }
                throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The provider permission is pending consent; retry the exact connect intent or forget the current revision first.");
            }
            const adapter = this.context.requireProviderRegistry().resolve(bound.provider_id);
            bound = await upgradeProviderProfile(adapter, bound, repository);
            const permissions = requirePermissions(adapter.permissions);
            if (request.command === "wallet.permission.forget") {
                assertExpectedRevision(bound, request.expectedRevision);
                const current = await permissions.read(profileHash);
                const forgotten = await permissions.forget(profileHash, current?.revision ?? request.expectedRevision);
                await repository.remove(profileHash);
                return forgottenOutput(profile, bound.provider_id, forgotten.warning);
            }
            let permission;
            if (request.command === "wallet.permission.list")
                permission = await permissions.read(profileHash);
            else {
                assertExpectedRevision(bound, request.expectedRevision);
                const current = await requireCurrentPermission(permissions, profileHash);
                permission = request.command === "wallet.permission.sync"
                    ? await permissions.sync(profileHash, current.revision)
                    : await permissions.disable(profileHash, current.revision);
            }
            if (permission === null)
                throw new ApnError("APN_STATE_CORRUPT", "The provider profile has no committed permission.");
            const aligned = alignRevision(bound, permission);
            if (aligned !== bound)
                await repository.save(aligned);
            return publicPermissionProfile(aligned, permission, true);
        });
    }
}
function requirePermissions(value) {
    if (value === undefined) {
        throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "This provider profile has no permission lifecycle.");
    }
    return value;
}
function alignRevision(profile, permission) {
    if (permission.revision < profile.revision)
        return profile;
    if (profile.observed_at === permission.observed_at)
        return profile;
    return { ...profile, revision: Math.max(profile.revision + 1, permission.revision), observed_at: permission.observed_at };
}
async function requireCurrentPermission(permissions, profileHash) {
    const permission = await permissions.read(profileHash);
    if (permission === null)
        throw new ApnError("APN_STATE_CORRUPT", "The provider profile has no committed permission.");
    return permission;
}
function assertExpectedRevision(profile, expectedRevision) {
    if (profile.revision !== expectedRevision) {
        throw new ApnError("APN_PROFILE_REVISION_CONFLICT", "The expected Smart Account permission revision is stale.", {
            current_revision: String(profile.revision),
        });
    }
}
function assertPendingExpectedRevision(currentRevision, expectedRevision) {
    if (currentRevision !== expectedRevision) {
        throw new ApnError("APN_PROFILE_REVISION_CONFLICT", "The expected Smart Account permission revision is stale.", {
            current_revision: String(currentRevision),
        });
    }
}
function forgottenOutput(profile, provider, warning) {
    return {
        profile,
        provider,
        status: "forgotten",
        proof_class: "provider_permission_binding",
        warning,
        provider_revoke: "not_performed",
        next_actions: ["Review and revoke any remaining authority in MetaMask if desired."],
    };
}
//# sourceMappingURL=provider-permission-service.js.map