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
}
//# sourceMappingURL=profile-repository.js.map