export const MM_CHAINS = [1, 10, 137, 143, 1329, 8453, 42161, 59144];
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