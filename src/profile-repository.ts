import type { ProviderProfileRepositoryPort } from "./provider-ports.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { StateStore } from "./state.js";

export class StateProfileRepository implements ProviderProfileRepositoryPort {
  constructor(private readonly state: StateStore) {}

  async load(profileHash: string): Promise<ProviderProfileRecord | null> {
    return await this.state.loadProviderProfile(profileHash);
  }

  async save(profile: ProviderProfileRecord): Promise<void> {
    await this.state.writeProviderProfile(profile);
  }
}
