import type { JupiterV1SemanticAccount } from "./v1-material.js";
import type { JupiterV1RawBuildResponse } from "./v1-codec.js";
import { type WhirlpoolV2NamedRoles } from "./v1-route-config.js";
export interface MutableByteRange {
    readonly offset: number;
    readonly length: number;
}
export interface WhirlpoolV2PoolState {
    readonly config: string;
    readonly bump: number;
    readonly feeTierIndexSeed: number;
    readonly tickSpacing: 2 | 4;
    readonly feeRate: 200 | 400;
    readonly protocolFeeRate: 1300;
    readonly mintA: string;
    readonly mintB: string;
    readonly vaultA: string;
    readonly vaultB: string;
    readonly liquidity: bigint;
    readonly sqrtPrice: bigint;
    readonly tickCurrentIndex: number;
    readonly mutableRanges: readonly MutableByteRange[];
}
export interface WhirlpoolV2Tick {
    readonly initialized: boolean;
    readonly liquidityNet: bigint;
    readonly liquidityGross: bigint;
    readonly feeGrowthOutsideA: bigint;
    readonly feeGrowthOutsideB: bigint;
    readonly rewardGrowthsOutside: readonly bigint[];
}
export interface WhirlpoolV2TickArrayState {
    readonly kind: "fixed" | "dynamic";
    readonly address: string;
    readonly whirlpool: string;
    readonly startTickIndex: number;
    readonly bitmap: bigint;
    readonly ticks: readonly WhirlpoolV2Tick[];
    readonly mutableRanges: readonly MutableByteRange[];
}
export interface WhirlpoolV2OracleState {
    readonly whirlpool: string;
    readonly tradeEnableTimestamp: bigint;
    readonly constants: {
        readonly filterPeriod: number;
        readonly decayPeriod: number;
        readonly reductionFactor: number;
        readonly adaptiveFeeControlFactor: number;
        readonly maxVolatilityAccumulator: number;
        readonly tickGroupSize: number;
        readonly majorSwapThresholdTicks: number;
    };
    readonly variables: {
        readonly lastReferenceUpdateTimestamp: bigint;
        readonly lastMajorSwapTimestamp: bigint;
        readonly volatilityReference: number;
        readonly tickGroupIndexReference: number;
        readonly volatilityAccumulator: number;
    };
    readonly mutableRanges: readonly MutableByteRange[];
}
export declare function decodeWhirlpoolV2Pool(a: JupiterV1SemanticAccount): WhirlpoolV2PoolState;
export declare function assertWhirlpoolV2PoolPda(a: JupiterV1SemanticAccount): Promise<void>;
export declare function decodeWhirlpoolV2TickArray(a: JupiterV1SemanticAccount): WhirlpoolV2TickArrayState;
export declare const WHIRLPOOL_V2_ORACLE_MUTABLE_RANGES: readonly MutableByteRange[];
export declare function decodeWhirlpoolV2Oracle(a: JupiterV1SemanticAccount): WhirlpoolV2OracleState;
export declare function assertWhirlpoolV2ClassicMint(a: JupiterV1SemanticAccount, mint: string): void;
export declare function assertWhirlpoolV2Memo(a: JupiterV1SemanticAccount): void;
export declare function assertWhirlpoolV2FixedPrograms(accounts: readonly JupiterV1SemanticAccount[]): void;
export declare function assertWhirlpoolV2ClassicTokenAccount(a: JupiterV1SemanticAccount, mint: string, owner: string): void;
export interface WhirlpoolV2AccountSnapshot {
    readonly roles: WhirlpoolV2NamedRoles;
    readonly pool: WhirlpoolV2PoolState;
    readonly ticks: readonly WhirlpoolV2TickArrayState[];
    readonly oracle: WhirlpoolV2OracleState;
}
/** Synchronous state parsing also runs on material reload; async PDA/ATA checks run in resolver and B guard. */
export declare function decodeWhirlpoolV2AccountSnapshot(build: JupiterV1RawBuildResponse, accounts: readonly JupiterV1SemanticAccount[]): WhirlpoolV2AccountSnapshot;
export declare function validateWhirlpoolV2AccountSnapshot(payer: string, build: JupiterV1RawBuildResponse, accounts: readonly JupiterV1SemanticAccount[]): Promise<WhirlpoolV2AccountSnapshot>;
