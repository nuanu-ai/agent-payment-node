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
                    assertCurrentRevision(request, profile, pending.permission.revision);
                    const forgotten = await staleRevisionGuidance(request, profile, pending.lifecycle.forget(profileHash, request.expectedRevision));
                    return forgottenOutput(profile, pending.adapter.provider_id, forgotten.warning);
                }
                throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The provider permission is pending consent; its next actions say how to continue or cancel it.", { nextActions: pendingPermissionNextActions(profile, pending.permission, Math.floor(this.context.clock.now().getTime() / 1000)) });
            }
            const adapter = this.context.requireProviderRegistry().resolve(bound.provider_id);
            bound = mutable ? await upgradeProviderProfile(adapter, bound, repository) : await previewProviderProfile(adapter, bound);
            const permissions = requirePermissions(adapter.permissions, profile);
            if (request.command === "wallet.permission.forget") {
                assertCurrentRevision(request, profile, bound.revision);
                const current = await permissions.read(profileHash);
                const forgotten = await staleRevisionGuidance(request, profile, permissions.forget(profileHash, current?.revision ?? request.expectedRevision));
                await repository.remove(profileHash);
                return forgottenOutput(profile, bound.provider_id, forgotten.warning);
            }
            let permission;
            if (request.command === "wallet.permission.list")
                permission = await permissions.read(profileHash);
            else {
                assertCurrentRevision(request, profile, bound.revision);
                const current = await requireCurrentPermission(permissions, profileHash);
                permission = await staleRevisionGuidance(request, profile, request.command === "wallet.permission.sync"
                    ? permissions.sync(profileHash, current.revision)
                    : permissions.disable(profileHash, current.revision));
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
/**
 * The revision a guarded command names must be the one `wallet permission list` shows as `revision` (the provider
 * profile's, or a pending intent's own). A stale one is read again there and the same command repeated with it; it is
 * never a reason to reconnect, which would ask MetaMask for a new permission.
 */
function assertCurrentRevision(request, profile, currentRevision) {
    if (currentRevision !== request.expectedRevision) {
        throw new ApnError("APN_PROFILE_REVISION_CONFLICT", "The expected Smart Account permission revision is stale; read the " +
            "current revision with wallet permission list and repeat this command with it.", {
            current_revision: String(currentRevision),
            nextActions: staleRevisionNextActions(request, profile),
        });
    }
}
/** A revision that moved between that check and the provider lifecycle's own compare-and-set gets the same guidance. */
async function staleRevisionGuidance(request, profile, action) {
    try {
        return await action;
    }
    catch (error) {
        if (!(error instanceof ApnError) || error.code !== "APN_PROFILE_REVISION_CONFLICT" || error.details?.nextActions !== undefined)
            throw error;
        throw new ApnError(error.code, error.message, { ...error.details, nextActions: staleRevisionNextActions(request, profile) });
    }
}
function staleRevisionNextActions(request, profile) {
    const verb = request.command.slice("wallet.permission.".length);
    return [
        `apn wallet permission list --profile ${profile}`,
        `apn wallet permission ${verb} --profile ${profile} --expected-revision <revision>`,
    ];
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