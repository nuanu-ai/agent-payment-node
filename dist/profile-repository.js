import { evmAddressLock } from "./evm-address-ownership.js";
import { ApnError } from "./errors.js";
export class StateProfileRepository {
    state;
    constructor(state) {
        this.state = state;
    }
    async load(profileHash) {
        return await this.state.loadProviderProfile(profileHash);
    }
    async save(profile) {
        const previous = await this.state.loadProviderProfile(profile.profile_hash);
        // A rebind holds both identities so a reader of the old address cannot race it.
        const keys = [evmAddressLock(profile.public_address), ...(previous === null ? [] : [evmAddressLock(previous.public_address)])];
        await this.state.withLocks(keys, async () => {
            const current = await this.state.loadProviderProfile(profile.profile_hash);
            if (current?.public_address.toLowerCase() !== previous?.public_address.toLowerCase()) {
                throw new ApnError("APN_PROFILE_DRIFT", "Provider identity changed while acquiring EVM owner locks.");
            }
            await this.state.writeProviderProfile(profile);
        });
    }
    async remove(profileHash) {
        const previous = await this.state.loadProviderProfile(profileHash);
        if (previous === null)
            return;
        await this.state.withLocks([evmAddressLock(previous.public_address)], async () => {
            const current = await this.state.loadProviderProfile(profileHash);
            if (current?.public_address.toLowerCase() !== previous.public_address.toLowerCase()) {
                throw new ApnError("APN_PROFILE_DRIFT", "Provider identity changed while acquiring EVM owner lock.");
            }
            await this.state.removeProviderProfile(profileHash);
        });
    }
}
//# sourceMappingURL=profile-repository.js.map