import type { UniswapNativeLane } from "../uniswap-v3/native-lane.js";
/**
 * BNB Smart Chain native-input lane. Blocks come about every 0.45 s, so the quote-to-send head drift takes the swap quote
 * schema's maximum of 256 blocks (about two minutes); an approval after that refuses before signing and needs a new quote.
 */
export declare const BNB_UNISWAP_NATIVE_LANE: UniswapNativeLane;
