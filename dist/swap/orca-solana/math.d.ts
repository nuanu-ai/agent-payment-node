import { type TickArrayState, type WhirlpoolState } from "./accounts.js";
export declare const WHIRLPOOL_MIN_SQRT_PRICE = 4295048016n;
export interface WhirlpoolSwapQuote {
    readonly amountInAtomic: string;
    readonly amountOutAtomic: string;
    readonly feeAtomic: string;
    readonly sqrtPriceBefore: string;
    readonly sqrtPriceAfter: string;
    readonly tickBefore: number;
    readonly tickAfter: number;
    readonly steps: number;
    readonly initializedTicksCrossed: number;
    /** USDC for the input after the LP fee at the pre-swap spot price: the zero-impact reference. */
    readonly spotOutputAfterFeeAtomic: string;
    /** USDC for exactly one SOL at the pre-swap spot price, before fees. */
    readonly spotOutputPerSolAtomic: string;
    readonly priceImpactBps: number;
}
/** Negative ticks only: SOL/USDC in atomic units sits near -22500; a non-negative tick is outside this pinned pair. */
export declare function sqrtPriceAtTick(tick: number): bigint;
export declare function quoteWhirlpoolExactInAToB(pool: WhirlpoolState, arrays: readonly TickArrayState[], amountIn: bigint): WhirlpoolSwapQuote;
/** Start tick of the array holding `tick`: floor(tick / (88 * spacing)) * (88 * spacing). */
export declare function tickArrayStart(tick: number, spacing: number): number;
/** sqrtPrice^2 / 2^128 is token B atomic per token A atomic. */
export declare function spotOutput(amountA: bigint, sqrtPrice: bigint): bigint;
