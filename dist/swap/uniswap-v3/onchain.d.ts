import { type Hex } from "viem";
import type { EvmRpcCall } from "../../evm-ports.js";
import type { UniswapNativeLane } from "./native-lane.js";
import type { UniswapV3PairPin } from "./pins.js";
/** Everything the owner sees about price is read from the pinned pool and QuoterV2 at one block. */
export interface UniswapV3PoolQuote {
    readonly pool: string;
    readonly fee: number;
    readonly sqrtPriceX96: string;
    readonly tick: number;
    readonly liquidity: string;
    readonly amountOutAtomic: string;
    readonly sqrtPriceX96After: string;
    readonly initializedTicksCrossed: number;
    readonly quoterGasEstimate: string;
    /** Output for exactly one whole native coin (ETH or BNB, 18 decimals) at the slot0 spot price, before fees. */
    readonly spotOutputPerEthAtomic: string;
    /** Spot output for this input after the pool LP fee: the zero-impact reference. */
    readonly spotOutputAfterFeeAtomic: string;
    /** Rounded up shortfall of the quoted output against the fee-adjusted spot output. */
    readonly priceImpactBps: number;
}
/** The lane names its QuoterV2 and wrapped native token; the pair names the pinned pool and output token. */
export declare function readUniswapV3Quote(call: EvmRpcCall, pair: UniswapV3PairPin, amountIn: bigint, tag: Hex, lane: Pick<UniswapNativeLane, "quoter" | "wrappedNative">): Promise<UniswapV3PoolQuote>;
/** sqrtPriceX96^2 / 2^192 is token1 per token0 in atomic units. */
export declare function spotOutput(amountIn: bigint, sqrtPriceX96: bigint, wethIsToken0: boolean): bigint;
