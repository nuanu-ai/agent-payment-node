import { ApnError } from "./errors.js";
import { publicPermissionProfile } from "./provider-permission-output.js";
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
            const bound = await repository.load(profileHash);
            if (bound === null || bound.provider_id === "local") {
                throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The profile has no provider permission lifecycle.");
            }
            const permissions = requirePermissions(this.context.requireProviderRegistry().resolve(bound.provider_id).permissions);
            if (request.command === "wallet.permission.forget") {
                assertExpectedRevision(bound, request.expectedRevision);
                const forgotten = await permissions.forget(profileHash, request.expectedRevision);
                await repository.remove(profileHash);
                return {
                    profile,
                    provider: bound.provider_id,
                    status: "forgotten",
                    proof_class: "provider_permission_binding",
                    warning: forgotten.warning,
                    provider_revoke: "not_performed",
                    next_actions: ["Review and revoke any remaining authority in MetaMask if desired."],
                };
            }
            const permission = request.command === "wallet.permission.list"
                ? await permissions.read(profileHash)
                : request.command === "wallet.permission.sync"
                    ? await permissions.sync(profileHash, request.expectedRevision)
                    : await permissions.disable(profileHash, request.expectedRevision);
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
    if (profile.revision === permission.revision)
        return profile;
    return { ...profile, revision: permission.revision, observed_at: permission.observed_at };
}
function assertExpectedRevision(profile, expectedRevision) {
    if (profile.revision !== expectedRevision) {
        throw new ApnError("APN_PROFILE_REVISION_CONFLICT", "The expected Smart Account permission revision is stale.", {
            current_revision: String(profile.revision),
        });
    }
}
//# sourceMappingURL=provider-permission-service.js.map