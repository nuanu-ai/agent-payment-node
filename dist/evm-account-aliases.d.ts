import type { StateStore } from "./state.js";
/**
 * Every APN profile that names one EVM account: provider profiles bound to it, local wallets and encrypted wallet
 * envelopes holding it, and profiles of direct operations that sent from it. Several profiles may share one
 * account (aliases are not banned), so a money operation must wait for the unresolved operations of all of them.
 * Caller holds the account's evm-owner lock so no alias can be bound or start an operation meanwhile.
 */
export declare function evmAccountProfileHashes(state: StateStore, account: string, ownProfileHash: string): Promise<ReadonlySet<string>>;
