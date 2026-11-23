import { type UniswapTokenOperation } from "../../swap/uniswap-v3/token-operation.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/** The Ethereum token lane's chain; a BNB Smart Chain route (its own schema) claims chain 56. */
export declare const UNISWAP_TOKEN_CHAIN_ID = 1;
/**
 * Uniswap token swaps: approval, swap and cleanup all sign with the account on the route's own chain (Ethereum, or BNB
 * Smart Chain for a BNB route). A `prepared` swap is retired unsigned once its route deadline passed (approve and
 * execute both retire it first).
 */
export declare const uniswapTokenAdapter: OperationFamilyAdapter<UniswapTokenOperation>;
