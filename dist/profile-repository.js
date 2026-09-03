export class StateProfileRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async load(profileHash) {
        return await this.state.loadProviderProfile(profileHash);
    }
    async save(profile) {
        await this.state.writeProviderProfile(profile);
    }
    async remove(profileHash) {
        await this.state.removeProviderProfile(profileHash);
    }
}
//# sourceMappingURL=profile-repository.js.map