import type { ProviderAdapterBundle, ProviderPendingPermissionBinding, ProviderPermissionBinding } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
export declare function publicPendingPermissionProfile(profile: string, adapter: ProviderAdapterBundle, permission: ProviderPendingPermissionBinding): unknown;
export declare function publicPermissionProfile(profile: ProviderProfileRecord, permission: ProviderPermissionBinding, reused: boolean): unknown;
