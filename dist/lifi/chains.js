/** LI.FI execution chains. Kept rail-local so enabling a bridge destination cannot widen x402 or wallet policy. */
export const BRIDGE_CHAIN_IDS = [1, 56, 143, 8453, 42161, 59144];
/** Destinations with a complete local execution and canonical receipt proof. */
export const BRIDGE_EXECUTION_CHAIN_IDS = [1, 56, 143, 8453, 42161, 59144];
/** Chains with the complete LI.FI Diamond/FeeForwarder source execution path. The remaining execution chains are destination-only. */
export const BRIDGE_EXECUTION_SOURCE_CHAIN_IDS = [1, 8453, 42161];
/**
 * Chains whose token rows have that source path while the native coin stays destination-only: BNB Smart Chain sends its
 * Binance-Peg USDT and USDC over Across (Diamond, FeeForwarder and facet pinned 2026-11-23); native BNB has no source path.
 */
export const BRIDGE_TOKEN_SOURCE_CHAIN_IDS = [56];
//# sourceMappingURL=chains.js.map