import type { WalletSecretState } from "./encrypted-wallet-store.js";
import type { StateStore } from "./state.js";
/**
 * Bounds the encrypted wallet envelope. It keeps signed material only while something can still use it:
 * - a local x402 authorization until its validBefore: native custody refuses to return or re-sign it afterwards
 *   (ensureX402Live), and no chain can settle it any more;
 * - a generic direct-transfer effect until its operation is terminal: a terminal operation is never signed,
 *   resumed into a send or abandoned again, and its public journal keeps the transaction hashes.
 * Every other slot (Relay, Uniswap token custody, or anything not proven to belong to a terminal direct
 * operation) is kept unchanged. An unreadable operation record keeps its slot: retention never wedges signing.
 */
export declare function releaseSettledWalletEffects(state: StateStore, profile: string, secret: WalletSecretState, nowMs: number): Promise<void>;
