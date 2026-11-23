import type { UniswapNativeLane } from "../uniswap-v3/native-lane.js";
import { BNB_CHAIN, BNB_CHAIN_ID, BNB_UNISWAP_MECHANISM_PIN, BNB_UNISWAP_QUOTER_V2, BNB_UNISWAP_SWAP_ROUTER_02, BNB_WBNB, bnbUniswapPair } from "./pins.js";
import { decodeBnbUniswapRouterCalldataFor, encodeBnbUniswapExactInput } from "./router.js";

/**
 * BNB Smart Chain native-input lane. Blocks come about every 0.45 s, so the quote-to-send head drift takes the swap quote
 * schema's maximum of 256 blocks (about two minutes); an approval after that refuses before signing and needs a new quote.
 */
export const BNB_UNISWAP_NATIVE_LANE: UniswapNativeLane = Object.freeze({
  chain: BNB_CHAIN, chainId: BNB_CHAIN_ID, networkName: "BNB Smart Chain", screenNetwork: "BNB Smart Chain", nativeSymbol: "BNB",
  wrappedSymbol: "WBNB", tokenStandard: "BEP-20", router: BNB_UNISWAP_SWAP_ROUTER_02, routerLabel: "SwapRouter02",
  quoter: BNB_UNISWAP_QUOTER_V2, wrappedNative: BNB_WBNB, rpcEnvironment: "APN_BNB_RPC_URL", statusCommand: "apn swap bnb uniswap status",
  maxHeadDrift: 256, pair: bnbUniswapPair, mechanismPin: () => BNB_UNISWAP_MECHANISM_PIN,
  encode: encodeBnbUniswapExactInput, decode: decodeBnbUniswapRouterCalldataFor,
} as const);
