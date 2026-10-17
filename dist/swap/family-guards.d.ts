import type { SwapOperationRecord } from "./model.js";
import { type SwapProtocolRegistry } from "./protocol-registry.js";
import type { GuardedSwapPolicyResolver } from "./runtime.js";
/** The keyless swap families that share these pre-sign guards. The key is part of their reasons and hash domains. */
export type SwapFamily = "uniswap" | "sunswap" | "orca";
/** The protocol registry the driver runs with must be the one the operation was prepared under and admit its mechanism. */
export declare function assertOperationProtocolRegistry(operation: SwapOperationRecord, registryValue: unknown, family: SwapFamily): SwapProtocolRegistry;
/** Owner admission, policy half: the profile's active sealed policy must still be the one the operation was prepared under. */
export declare function assertActiveSwapPolicyUnchanged(policy: GuardedSwapPolicyResolver, operation: SwapOperationRecord): Promise<void>;
