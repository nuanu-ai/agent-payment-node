import type { StateStore } from "./state.js";
/** All callers that inspect or change an EVM owner must share this kernel lock. */
export declare function evmAddressLock(address: string): string;
/** Caller holds evmAddressLock(address). Future Relay execution must repeat this check
 * while holding that lock before signing and again before the first submission. */
export declare function assertExclusiveEvmOwner(state: StateStore, address: string, ownProfileHash: string): Promise<void>;
