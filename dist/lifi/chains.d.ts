/** LI.FI execution chains. Kept rail-local so enabling a bridge destination cannot widen x402 or wallet policy. */
export declare const BRIDGE_CHAIN_IDS: readonly [1, 56, 143, 8453, 42161, 59144];
export type BridgeChainId = typeof BRIDGE_CHAIN_IDS[number];
/** Destinations with a complete local execution and canonical receipt proof. BNB remains discovery only. */
export declare const BRIDGE_EXECUTION_CHAIN_IDS: readonly [1, 143, 8453, 42161, 59144];
export type BridgeExecutionChainId = typeof BRIDGE_EXECUTION_CHAIN_IDS[number];
