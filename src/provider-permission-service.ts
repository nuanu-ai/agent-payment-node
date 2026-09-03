import type { CommandRequest } from "./commands.js";
import { ApnError } from "./errors.js";
import { publicPermissionProfile } from "./provider-permission-output.js";
import type { ProviderPermissionBinding, ProviderPermissionLifecyclePort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import { upgradeProviderProfile } from "./provider-profile-upgrade.js";
import type { RuntimeContext } from "./runtime.js";
import { canonicalProfile } from "./wallet-policy.js";

type PermissionCommand = Extract<CommandRequest, {
  readonly command: "wallet.permission.list" | "wallet.permission.sync" |
    "wallet.permission.disable" | "wallet.permission.forget";
}>;

export class ProviderPermissionService {
  constructor(private readonly context: RuntimeContext) {}

  async execute(request: PermissionCommand): Promise<unknown> {
    const profile = canonicalProfile(request.profile);
    await this.context.ready();
    const profileHash = this.context.state.profileHash(profile);
    return await this.context.state.withLocks([`profile:${profileHash}`], async () => {
      const repository = this.context.requireProfileRepository();
      let bound = await repository.load(profileHash);
      if (bound === null || bound.provider_id === "local") {
        throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "The profile has no provider permission lifecycle.");
      }
      const adapter = this.context.requireProviderRegistry().resolve(bound.provider_id);
      bound = await upgradeProviderProfile(adapter, bound, repository);
      const permissions = requirePermissions(adapter.permissions);
      if (request.command === "wallet.permission.forget") {
        assertExpectedRevision(bound, request.expectedRevision);
        const current = await permissions.read(profileHash);
        const forgotten = await permissions.forget(profileHash, current?.revision ?? request.expectedRevision);
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
      let permission: ProviderPermissionBinding | null;
      if (request.command === "wallet.permission.list") permission = await permissions.read(profileHash);
      else {
        assertExpectedRevision(bound, request.expectedRevision);
        const current = await requireCurrentPermission(permissions, profileHash);
        permission = request.command === "wallet.permission.sync"
          ? await permissions.sync(profileHash, current.revision)
          : await permissions.disable(profileHash, current.revision);
      }
      if (permission === null) throw new ApnError("APN_STATE_CORRUPT", "The provider profile has no committed permission.");
      const aligned = alignRevision(bound, permission);
      if (aligned !== bound) await repository.save(aligned);
      return publicPermissionProfile(aligned, permission, true);
    });
  }
}

function requirePermissions(value: ProviderPermissionLifecyclePort | undefined): ProviderPermissionLifecyclePort {
  if (value === undefined) {
    throw new ApnError("APN_PROVIDER_EFFECT_UNAVAILABLE", "This provider profile has no permission lifecycle.");
  }
  return value;
}

function alignRevision(profile: ProviderProfileRecord, permission: ProviderPermissionBinding): ProviderProfileRecord {
  if (permission.revision < profile.revision) return profile;
  if (profile.observed_at === permission.observed_at) return profile;
  return { ...profile, revision: Math.max(profile.revision + 1, permission.revision), observed_at: permission.observed_at };
}

async function requireCurrentPermission(
  permissions: ProviderPermissionLifecyclePort,
  profileHash: string,
): Promise<ProviderPermissionBinding> {
  const permission = await permissions.read(profileHash);
  if (permission === null) throw new ApnError("APN_STATE_CORRUPT", "The provider profile has no committed permission.");
  return permission;
}

function assertExpectedRevision(profile: ProviderProfileRecord, expectedRevision: number): void {
  if (profile.revision !== expectedRevision) {
    throw new ApnError("APN_PROFILE_REVISION_CONFLICT", "The expected Smart Account permission revision is stale.", {
      current_revision: String(profile.revision),
    });
  }
}
