import type { WalletRecord } from "./model.js";
import type { ProviderProfileRecord } from "./provider-profile.js";
import type { StateStore } from "./state.js";
/** Inspect every local identity before importing a second signing key. */
export declare function listLocalWallets(state: StateStore): Promise<readonly WalletRecord[]>;
/**
 * A first provider binding of a profile whose local key is sealed without its public record (an incomplete wallet, see
 * incompleteWallet) would strand that key behind another owner. Callers refuse it under the profile lock, before any
 * provider contact, consent or write, naming the command that completes the local wallet.
 */
export declare function assertNoIncompleteLocalWallet(state: StateStore, profile: string): Promise<void>;
export declare function listEncryptedWalletEnvelopes(state: StateStore): Promise<readonly {
    profile: string;
    value: unknown;
}[]>;
export declare function listLocalProviderProfiles(state: StateStore): Promise<readonly ProviderProfileRecord[]>;
