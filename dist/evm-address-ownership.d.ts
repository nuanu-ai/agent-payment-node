import type { StateStore } from "./state.js";
import type { EncryptedSmartAccountPermissionStore } from "./encrypted-smart-account-permission-store.js";
/** All callers that inspect or change an EVM owner must share this kernel lock. */
export declare function evmAddressLock(address: string): string;
/** Caller holds evmAddressLock(address). Future Relay execution must repeat this check
 * while holding that lock before signing and again before the first submission. */
export declare function assertExclusiveEvmOwner(state: StateStore, address: string, ownProfileHash: string): Promise<void>;
/** Ethereum raw signing owns the local key and nonce. A Base Smart Account
 * delegation for the same EOA does not own that raw signer. Caller holds evmAddressLock. */
export declare function assertExclusiveEvmRawSigner(state: StateStore, address: string, ownProfileHash: string): Promise<void>;
/** Check a prepared token operation before and after foreground consent. */
export declare function assertExclusiveUniswapTokenSigner(state: StateStore, address: string, ownProfileHash: string): Promise<void>;
/** Execution-only Relay owner check. Call immediately before signing and again
 * before first submission. No network operation belongs in this critical section. */
export declare function assertExclusiveRelayExecutionOwner(state: StateStore, permissions: Pick<EncryptedSmartAccountPermissionStore, "listAll">, address: string, ownProfileHash: string): Promise<void>;
/** Caller holds evmAddressLock(address), including through the effect boundary. */
export declare function assertExclusiveEvmOwnerIncludingGrants(state: StateStore, permissions: Pick<EncryptedSmartAccountPermissionStore, "listAll">, address: string, ownProfileHash: string): Promise<void>;
