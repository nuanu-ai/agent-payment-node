import type { ProviderAdapterBundle, ProviderProfileRepositoryPort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
export declare function upgradeProviderProfile(adapter: ProviderAdapterBundle, profile: ProviderProfileRecord, repository: ProviderProfileRepositoryPort): Promise<ProviderProfileRecord>;
/** The same migration without persisting it; read-only commands use this while an operation is in flight. */
export declare function previewProviderProfile(adapter: ProviderAdapterBundle, profile: ProviderProfileRecord): Promise<ProviderProfileRecord>;
