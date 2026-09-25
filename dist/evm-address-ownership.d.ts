import type { StateStore } from "./state.js";
import type { EncryptedSmartAccountPermissionStore } from "./encrypted-smart-account-permission-store.js";
/** All callers that inspect or change an EVM owner must share this kernel lock. */
export declare function evmAddressLock(address: string): string;
/** Caller holds evmAddressLock(address). Future Relay execution must repeat this check
 * while holding that lock before signing and again before the first submission. */
export declare function assertExclusiveEvmOwner(state: StateStore, address: string, ownProfileHash: string): Promise<void>;
/** Execution-only Relay owner check. Call immediately before signing and again
 * before first submission. No network operation belongs in this critical section. */
export declare function assertExclusiveRelayExecutionOwner(state: StateStore, permissions: Pick<EncryptedSmartAccountPermissionStore, "listAll">, address: string, ownProfileHash: string): Promise<void>;
