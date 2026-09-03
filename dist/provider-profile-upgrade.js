export async function upgradeProviderProfile(adapter, profile, repository) {
    if (adapter.profileMigration === undefined)
        return profile;
    const upgraded = await adapter.profileMigration.upgrade(profile);
    if (upgraded !== profile)
        await repository.save(upgraded);
    return upgraded;
}
//# sourceMappingURL=provider-profile-upgrade.js.map