import { ApnError } from "./errors.js";
export async function upgradeProviderProfile(adapter, profile, repository) {
    if (adapter.profileMigration === undefined)
        return profile;
    let current = profile;
    for (let step = 0; step < 4; step += 1) {
        const upgraded = await adapter.profileMigration.upgrade(current);
        if (upgraded === current)
            return current;
        await repository.save(upgraded);
        current = upgraded;
    }
    throw new ApnError("APN_PROFILE_DRIFT", "Provider profile migration did not reach a stable capability snapshot.");
}
/** The same migration without persisting it; read-only commands use this while an operation is in flight. */
export async function previewProviderProfile(adapter, profile) {
    if (adapter.profileMigration === undefined)
        return profile;
    let current = profile;
    for (let step = 0; step < 4; step += 1) {
        const upgraded = await adapter.profileMigration.upgrade(current);
        if (upgraded === current)
            return current;
        current = upgraded;
    }
    throw new ApnError("APN_PROFILE_DRIFT", "Provider profile migration did not reach a stable capability snapshot.");
}
//# sourceMappingURL=provider-profile-upgrade.js.map