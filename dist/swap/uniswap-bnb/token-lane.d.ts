import type { UniswapTokenLane } from "../uniswap-v3/token-lane.js";
/**
 * BNB Smart Chain token input: Binance-Peg USDT or USDC into native BNB, and USDT into USDC and back, through the pinned
 * SwapRouter02 over APN_BNB_RPC_URL. Its own pins, route schema, mechanism pin, nonce space and command family
 * (`apn swap bnb uniswap-token`); the approval, swap and cleanup rules are the Ethereum token lane's.
 */
export declare const BNB_UNISWAP_TOKEN_LANE: UniswapTokenLane;
