/** LI.FI execution chains. Kept rail-local so enabling a bridge destination cannot widen x402 or wallet policy. */
export declare const BRIDGE_CHAIN_IDS: readonly [1, 56, 143, 8453, 42161, 59144];
export type BridgeChainId = typeof BRIDGE_CHAIN_IDS[number];
/** Destinations with a complete local execution and canonical receipt proof. */
export declare const BRIDGE_EXECUTION_CHAIN_IDS: readonly [1, 56, 143, 8453, 42161, 59144];
export type BridgeExecutionChainId = typeof BRIDGE_EXECUTION_CHAIN_IDS[number];
/** Chains with the complete LI.FI Diamond/FeeForwarder source execution path. The remaining execution chains are destination-only. */
export declare const BRIDGE_EXECUTION_SOURCE_CHAIN_IDS: readonly [1, 8453, 42161];
export type BridgeExecutionSourceChainId = typeof BRIDGE_EXECUTION_SOURCE_CHAIN_IDS[number];
