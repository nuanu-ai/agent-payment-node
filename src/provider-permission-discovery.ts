import { ApnError } from "./errors.js";
import type {
  ProviderAdapterBundle,
  ProviderPendingPermissionBinding,
  ProviderPermissionLifecyclePort,
  ProviderRegistryPort,
} from "./provider-ports.js";

export interface PendingProviderPermission {
  readonly adapter: ProviderAdapterBundle;
  readonly lifecycle: ProviderPermissionLifecyclePort;
  readonly permission: ProviderPendingPermissionBinding;
}

export async function findPendingProviderPermission(
  registry: ProviderRegistryPort,
  profileHash: string,
): Promise<PendingProviderPermission | null> {
  const found: PendingProviderPermission[] = [];
  for (const adapter of registry.permissionAdapters?.() ?? []) {
    const lifecycle = adapter.permissions;
    if (lifecycle?.readPending === undefined) continue;
    const permission = await lifecycle.readPending(profileHash);
    if (permission !== null) found.push({ adapter, lifecycle, permission });
  }
  if (found.length > 1) {
    throw new ApnError("APN_STATE_CORRUPT", "Multiple providers claim the same pending permission profile.");
  }
  return found[0] ?? null;
}
