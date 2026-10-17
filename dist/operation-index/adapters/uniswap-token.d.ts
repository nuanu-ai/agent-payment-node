import { type UniswapTokenOperation } from "../../swap/uniswap-v3/token-operation.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/** The Uniswap token lane runs on Ethereum mainnet only (its route reads pin chain 1). */
export declare const UNISWAP_TOKEN_CHAIN_ID = 1;
/**
 * Uniswap token swaps: approval, swap and cleanup all sign with the account on Ethereum. A `prepared` swap is retired
 * unsigned once its route deadline passed (approve and execute both retire it first).
 */
export declare const uniswapTokenAdapter: OperationFamilyAdapter<UniswapTokenOperation>;
