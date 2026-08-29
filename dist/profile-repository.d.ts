import type { ProviderProfileRepositoryPort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { StateStore } from "./state.js";
export declare class StateProfileRepository implements ProviderProfileRepositoryPort {
    private readonly state;
    constructor(state: StateStore);
    load(profileHash: string): Promise<ProviderProfileRecord | null>;
    save(profile: ProviderProfileRecord): Promise<void>;
}
