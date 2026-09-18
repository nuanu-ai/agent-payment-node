import { type UniswapDecodedRoute } from "../uniswap-router.js";
import { type UniswapV3PairPin } from "./pins.js";
export interface UniswapV3ExactInputCall {
    readonly recipient: string;
    readonly inputAmountAtomic: string;
    readonly minimumOutputAtomic: string;
    readonly deadline: number;
    readonly pair: UniswapV3PairPin;
}
/**
 * Exact inverse of decodeUniswapRouterCalldataFor: execute(0x0b00, [WRAP_ETH(ADDRESS_THIS, amountIn),
 * V3_SWAP_EXACT_IN(recipient, amountIn, amountOutMin, WETH|fee|output, payerIsUser=false, minHopPriceX36=[])], deadline).
 * The empty per-hop floor array is the router's documented "no per-hop check"; the single-hop amountOutMin is the floor.
 */
export declare function encodeUniswapV3ExactInput(input: UniswapV3ExactInputCall): {
    readonly data: `0x${string}`;
    readonly route: UniswapDecodedRoute;
};
