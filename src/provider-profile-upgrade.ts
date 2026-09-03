import type { ProviderAdapterBundle, ProviderProfileRepositoryPort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";

export async function upgradeProviderProfile(
  adapter: ProviderAdapterBundle,
  profile: ProviderProfileRecord,
  repository: ProviderProfileRepositoryPort,
): Promise<ProviderProfileRecord> {
  if (adapter.profileMigration === undefined) return profile;
  const upgraded = await adapter.profileMigration.upgrade(profile);
  if (upgraded !== profile) await repository.save(upgraded);
  return upgraded;
}
