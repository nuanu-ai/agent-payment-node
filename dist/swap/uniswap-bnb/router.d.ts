import { type Hex } from "viem";
import type { UniswapV3ExactInputCall } from "../uniswap-v3/encoder.js";
import type { UniswapNativeRoute, UniswapNativeRouteExpectation } from "../uniswap-v3/native-lane.js";
/**
 * SwapRouter02 multicall(deadline, [exactInputSingle(WBNB, output, pinned fee, recipient, amountIn, amountOutMinimum, 0)])
 * with msg.value = amountIn: the router wraps exactly the native input into WBNB and pays the pinned pool (PeripheryPayments
 * .pay). The multicall deadline is the quote expiry; amountOutMinimum is the only floor; no price limit, no refund call.
 */
export declare function encodeBnbUniswapExactInput(input: UniswapV3ExactInputCall): {
    readonly data: Hex;
    readonly route: UniswapNativeRoute;
};
/**
 * Strict SwapRouter02 proof: exactly one exactInputSingle inside multicall(deadline, …), canonically encoded, from WBNB to
 * the expected pinned output at its pinned fee tier, for the exact recipient and input, with a floor at least the expected
 * minimum and no price limit. Anything else (another function, a second call, a sweep or unwrap) is refused.
 */
export declare function decodeBnbUniswapRouterCalldataFor(data: Hex, expected: UniswapNativeRouteExpectation): UniswapNativeRoute;
