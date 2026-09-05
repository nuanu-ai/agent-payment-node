import type { ProviderAdapterBundle, ProviderPendingPermissionBinding, ProviderPermissionLifecyclePort, ProviderRegistryPort } from "./provider-ports.js";
export interface PendingProviderPermission {
    readonly adapter: ProviderAdapterBundle;
    readonly lifecycle: ProviderPermissionLifecyclePort;
    readonly permission: ProviderPendingPermissionBinding;
}
export declare function findPendingProviderPermission(registry: ProviderRegistryPort, profileHash: string): Promise<PendingProviderPermission | null>;
