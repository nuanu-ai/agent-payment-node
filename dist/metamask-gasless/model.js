export const MM_CHAINS = [1, 10, 56, 137, 143, 1329, 8453, 42161, 59144];
/** The token scales the lane admits: 6 for the Circle USDC rows, 18 for the Binance-Peg USDT and USDC rows on chain 56. */
export const MM_TOKEN_DECIMALS = [6, 18];
/** keccak256 of empty code: the implementation code hash a row pins for a token that is no proxy. */
export const MM_EMPTY_CODE_HASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
export const MM_TTL_MS = 300_000;
export const MM_MIN_REMAINING_MS = 15_000;
export const MM_OBSERVATION_MAX_AGE_MS = 120_000;
export const MM_MAX_UINT = (1n << 256n) - 1n;
export const MM_PROVIDER_STATUSES = ["awaiting_approval", "pending", "broadcasted", "confirmed", "failed", "denied", "expired",
    "unavailable"];
/** Final provider job statuses: a later failed read cannot replace them. */
export const MM_CLOSED_PROVIDER_STATUSES = ["failed", "denied", "expired"];
export const MM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const MM_ZERO_HASH = "0".repeat(64);
//# sourceMappingURL=model.js.map