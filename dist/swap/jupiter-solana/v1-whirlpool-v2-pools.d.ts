export interface ReviewedWhirlpoolV2Pool {
    readonly pool: string;
    readonly config: string;
    readonly bump: number;
    readonly tickSpacing: 2 | 4;
    readonly feeTierIndexSeed: 1027 | 1028;
    readonly feeRate: 200 | 400;
    readonly protocolFeeRate: 1300;
    readonly vaultA: string;
    readonly vaultB: string;
    readonly oracle: string;
    readonly adaptiveFeeControlFactor: 80000 | 60000;
}
export declare const REVIEWED_WHIRLPOOL_V2_POOLS: readonly ReviewedWhirlpoolV2Pool[];
export declare function reviewedWhirlpoolV2Pool(pool: string): ReviewedWhirlpoolV2Pool;
