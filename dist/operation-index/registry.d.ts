import type { OperationFamilyAdapter } from "./adapter.js";
import type { OperationFamily } from "./types.js";
export type OperationRegistry = ReadonlyMap<OperationFamily, OperationFamilyAdapter>;
/**
 * Every family the index covers, in the order the guard reports blockers (the order the former store scan used).
 * Phase 4b WP2 appends the swap, Uniswap-token, Stargate, USDT, 1Click, Circle-source, Circle-approval and
 * MetaMask-native adapters to this list.
 */
export declare function operationRegistry(): OperationRegistry;
