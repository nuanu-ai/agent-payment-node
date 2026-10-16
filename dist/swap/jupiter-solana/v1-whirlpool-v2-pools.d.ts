/** Identity only: fee rates and adaptive-fee constants are tunable by Orca's fee authority and are read, not pinned (SWAP-18). */
export interface ReviewedWhirlpoolV2Pool {
    readonly pool: string;
    readonly config: string;
    readonly bump: number;
    readonly tickSpacing: 2 | 4;
    readonly feeTierIndexSeed: 1027 | 1028;
    readonly vaultA: string;
    readonly vaultB: string;
    readonly oracle: string;
}
export declare const REVIEWED_WHIRLPOOL_V2_POOLS: readonly ReviewedWhirlpoolV2Pool[];
export declare function reviewedWhirlpoolV2Pool(pool: string): ReviewedWhirlpoolV2Pool;
