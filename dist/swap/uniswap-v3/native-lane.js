import { UNISWAP_ROUTER } from "../uniswap-pin.js";
import { decodeUniswapRouterCalldataFor } from "../uniswap-router.js";
import { BNB_UNISWAP_NATIVE_LANE } from "../uniswap-bnb/lane.js";
import { encodeUniswapV3ExactInput } from "./encoder.js";
import { ETHEREUM_WBTC, UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_V3_QUOTER_V2, UNISWAP_WBTC_MECHANISM_PIN, UNISWAP_WETH9, uniswapV3Pair } from "./pins.js";
export const ETHEREUM_UNISWAP_NATIVE_LANE = Object.freeze({
    chain: "eip155:1", chainId: 1, networkName: "Ethereum", screenNetwork: "Ethereum mainnet", nativeSymbol: "ETH", wrappedSymbol: "WETH",
    tokenStandard: "ERC20", router: UNISWAP_ROUTER, routerLabel: "Universal Router 2.2.0", quoter: UNISWAP_V3_QUOTER_V2, wrappedNative: UNISWAP_WETH9,
    rpcEnvironment: "APN_ETHEREUM_RPC_URL", statusCommand: "apn swap ethereum uniswap status", maxHeadDrift: 64,
    pair: uniswapV3Pair,
    mechanismPin: (pair) => pair.outputToken === ETHEREUM_WBTC ? UNISWAP_WBTC_MECHANISM_PIN : UNISWAP_V3_KEYLESS_MECHANISM_PIN,
    encode: encodeUniswapV3ExactInput, decode: decodeUniswapRouterCalldataFor,
});
const LANES = [ETHEREUM_UNISWAP_NATIVE_LANE, BNB_UNISWAP_NATIVE_LANE];
/** The lane of an exact chain identity, or undefined; callers refuse in their own terms. */
export function uniswapNativeLaneOf(chain) {
    return LANES.find((lane) => lane.chain === chain);
}
//# sourceMappingURL=native-lane.js.map