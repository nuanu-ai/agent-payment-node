import type { ProviderAdapterBundle, ProviderProfileRepositoryPort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import { ApnError } from "./errors.js";

export async function upgradeProviderProfile(
  adapter: ProviderAdapterBundle,
  profile: ProviderProfileRecord,
  repository: ProviderProfileRepositoryPort,
): Promise<ProviderProfileRecord> {
  if (adapter.profileMigration === undefined) return profile;
  let current = profile;
  for (let step = 0; step < 4; step += 1) {
    const upgraded = await adapter.profileMigration.upgrade(current);
    if (upgraded === current) return current;
    await repository.save(upgraded);
    current = upgraded;
  }
  throw new ApnError("APN_PROFILE_DRIFT", "Provider profile migration did not reach a stable capability snapshot.");
}
