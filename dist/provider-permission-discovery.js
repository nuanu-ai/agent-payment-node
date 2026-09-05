import { ApnError } from "./errors.js";
export async function findPendingProviderPermission(registry, profileHash) {
    const found = [];
    for (const adapter of registry.permissionAdapters?.() ?? []) {
        const lifecycle = adapter.permissions;
        if (lifecycle?.readPending === undefined)
            continue;
        const permission = await lifecycle.readPending(profileHash);
        if (permission !== null)
            found.push({ adapter, lifecycle, permission });
    }
    if (found.length > 1) {
        throw new ApnError("APN_STATE_CORRUPT", "Multiple providers claim the same pending permission profile.");
    }
    return found[0] ?? null;
}
//# sourceMappingURL=provider-permission-discovery.js.map