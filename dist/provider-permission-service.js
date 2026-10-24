import { ApnError } from "./errors.js";
import { findPendingProviderPermission } from "./provider-permission-discovery.js";
import { pendingPermissionNextActions, publicPendingPermissionProfile, publicPermissionProfile } from "./provider-permission-output.js";
import { previewProviderProfile, upgradeProviderProfile } from "./provider-profile-upgrade.js";
import { canonicalProfile } from "./wallet-policy.js";
import { assertWalletLifecycleAvailable, walletLifecycleMutable } from "./wallet-lifecycle-guard.js";
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
            // Listing never waits for a money operation; it only skips profile upkeep while one is in flight.
            const mutable = request.command === "wallet.permission.list"
                ? await walletLifecycleMutable(this.context, profileHash)
                : (await assertWalletLifecycleAvailable(this.context, profileHash), true);
            const repository = this.context.requireProfileRepository();
            let bound = await repository.load(profileHash);
            if (bound === null || bound.provider_id === "local") {
                const pending = await findPendingProviderPermission(this.context.requireProviderRegistry(), profileHash);
                if (pending === null) {
                    throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The profile has no provider permission lifecycle.", { nextActions: permissionLifecycleActions(profile) });
                }
                if (request.command === "wallet.permission.list") {
                    return publicPendingPermissionProfile(profile, pending.adapter, pending.permission, Math.floor(this.context.clock.now().getTime() / 1000));
                }
                if (request.command === "wallet.permission.forget") {
                    assertPendingExpectedRevision(pending.permission.revision, request.expectedRevision);
                    const forgotten = await pending.lifecycle.forget(profileHash, request.expectedRevision);
                    return forgottenOutput(profile, pending.adapter.provider_id, forgotten.warning);
                }
                throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The provider permission is pending consent; retry the exact connect intent while it is live, or forget the current revision first.", { nextActions: pendingPermissionNextActions(profile, pending.permission, Math.floor(this.context.clock.now().getTime() / 1000)) });
            }
            const adapter = this.context.requireProviderRegistry().resolve(bound.provider_id);
            bound = mutable ? await upgradeProviderProfile(adapter, bound, repository) : await previewProviderProfile(adapter, bound);
            const permissions = requirePermissions(adapter.permissions, profile);
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
            const aligned = mutable ? alignRevision(bound, permission) : bound;
            if (aligned !== bound)
                await repository.save(aligned);
            return publicPermissionProfile(aligned, permission, true);
        });
    }
}
function requirePermissions(value, profile) {
    if (value === undefined) {
        throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "This provider profile has no permission lifecycle.", { nextActions: permissionLifecycleActions(profile) });
    }
    return value;
}
/** Permission commands manage a MetaMask Smart Account grant; for any other profile the useful step is its own status. */
function permissionLifecycleActions(profile) {
    return ["Permission commands apply only to a MetaMask Smart Account profile (provider metamask-smart-account) and its ERC-7715 grant; this profile has none to list or change.",
        `apn wallet status --profile ${profile}`];
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