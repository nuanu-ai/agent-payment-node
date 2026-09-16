import type { WalletRecord } from "./model.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { StateStore } from "./state.js";
/** Inspect every local identity before importing a second signing key. */
export declare function listLocalWallets(state: StateStore): Promise<readonly WalletRecord[]>;
export declare function listEncryptedWalletEnvelopes(state: StateStore): Promise<readonly {
    profile: string;
    value: unknown;
}[]>;
export declare function listLocalProviderProfiles(state: StateStore): Promise<readonly ProviderProfileRecord[]>;
