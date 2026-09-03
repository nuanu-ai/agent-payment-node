import type { ProviderAdapterBundle, ProviderProfileRepositoryPort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
export declare function upgradeProviderProfile(adapter: ProviderAdapterBundle, profile: ProviderProfileRecord, repository: ProviderProfileRepositoryPort): Promise<ProviderProfileRecord>;
