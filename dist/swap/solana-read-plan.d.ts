/** Explicit headroom: one unplanned split of a batched read and one extra account page. */
export declare const SOLANA_SWAP_PLAN_HEADROOM_REQUESTS = 2;
/** The physical request budget of one Orca keyless or Jupiter command; null for every other command. */
export declare function solanaSwapCommandRequests(command: string): number | null;
