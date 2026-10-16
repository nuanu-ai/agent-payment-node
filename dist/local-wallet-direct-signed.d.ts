import type { WalletIdentity, WalletSecretState } from "./encrypted-wallet-store.js";
import type { StateStore } from "./state.js";
type WithWallet = <T>(profile: string, action: (identity: WalletIdentity, secret: WalletSecretState) => Promise<T>) => Promise<T>;
/**
 * The exact bytes the owner already approved and APN already signed, read back for their first or a repeated dispatch.
 * It never signs: the encrypted effect must match the operation's public signed evidence byte for byte.
 */
export declare function signedDirectTransaction(state: StateStore, payload: Readonly<Record<string, unknown>>, withWallet: WithWallet): Promise<unknown>;
export {};
