import { type Hex } from "viem";
import type { EvmRpcCall } from "../../evm-ports.js";
import type { UniswapV3CodePin } from "../uniswap-v3/pins.js";
import { BNB_UNISWAP_SWAP_ROUTER_02, BNB_UNISWAP_USDC_WBNB_500, BNB_UNISWAP_USDT_WBNB_500, BNB_USDC, BNB_USDT, BNB_WBNB } from "./pins.js";
/**
 * Token input on BNB Smart Chain: Binance-Peg USDT or USDC into native BNB, and USDT into USDC and back, exact input
 * through the pinned SwapRouter02 after an exact ERC-20 approval of that router. The router, quoter, factory, WBNB, both
 * tokens and the two WBNB pools are the native lane's pins (pins.ts). The USDT/USDC pool was read on chain 56 on
 * 2026-11-24 over https://bsc-rpc.publicnode.com, every read pinned to one block hash (EIP-1898, requireCanonical):
 *
 * - Block 135304384 (0xbdc594b5…13ac69): factory.getPool(USDT, USDC, fee) and each pool's liquidity(), slot0(), token0(),
 *   token1(), fee(), factory() and the pool's USDT and USDC balances. In-range liquidity per tier: 100 = 3.375e25
 *   (239 264 USDT, 39 671 USDC held), 500 = 5.13e24, 3000 = 6.67e22, 10000 = 2.09e21. The 0.01% pool is the deepest.
 *   The same block re-read the WBNB pools: USDT/WBNB 500 (8.86e23) and USDC/WBNB 500 (1.10e21) stay the deepest of
 *   their pairs; USDC/WBNB 500 holds only 1 609 USDC and 5.22 WBNB.
 * - Block 135304716 (0xdd847d78…71ee66): eth_getCode of every pinned contract (each hash equals its pin, the new pool's
 *   below), the USDC proxy implementation slot, decimals() of both tokens (18), SwapRouter02 and QuoterV2 factory()
 *   and WETH9(), and the factory's getPool of all three pools.
 * - Block 135304528 (0xc2064d37…c1c4b): QuoterV2 quoteExactInputSingle for 1, 10, 100, 1000 and 10000 units of input.
 *   10 USDT gave 0.017659 WBNB and 10 USDC 0.017680 WBNB (one tick crossed); 1000 USDC gave 1.7074 WBNB against
 *   1.7658 for 1000 USDT (21 ticks crossed), and 10000 USDC only 4.886 WBNB: the USDC/WBNB pool is thin. 10 USDT gave
 *   9.98996 USDC and 10 USDC 10.00804 USDT; 10000 USDT gave 9987.23 USDC (four ticks crossed).
 * - Block 135304637 (0x275c7d3a…5ebe2e): this module's calldata for 10 units of each direction, run by eth_call from an
 *   account whose token balance and router allowance were set by a state override: amountOutMinimum equal to the
 *   QuoterV2 output succeeded, quoted + 1 reverted "Too little received", a past deadline reverted "Transaction too
 *   old". eth_estimateGas under the same override: USDT to BNB 182 317, USDC to BNB 200 046, USDT to USDC 143 700, USDC
 *   to USDT 144 357; approve from a zero allowance: USDT 46 576, USDC 54 235. Both tokens' approve returns true.
 */
export declare const BNB_UNISWAP_USDT_USDC_100: "0x2C3c320D49019D4f9A92352e947c7e5AcFE47D68";
export declare const BNB_UNISWAP_USDT_USDC_100_PIN: UniswapV3CodePin;
export declare const BNB_UNISWAP_TOKEN_ROUTE_SCHEMA: "apn.uniswap-v3.bnb.swap-router-02.multicall.v1";
/** SwapRouter02 reads recipient 0x…01 as msg.sender and 0x…02 as the router itself (Constants.MSG_SENDER, ADDRESS_THIS). */
export declare const SWAP_ROUTER_02_MSG_SENDER: "0x0000000000000000000000000000000000000001";
export declare const SWAP_ROUTER_02_ADDRESS_THIS: "0x0000000000000000000000000000000000000002";
/** One reviewed direction: the pool's input and output token, and whether the router unwraps the WBNB output to native BNB. */
export interface BnbUniswapTokenPair {
    readonly inputToken: typeof BNB_USDT | typeof BNB_USDC;
    readonly outputToken: typeof BNB_USDT | typeof BNB_USDC | typeof BNB_WBNB;
    readonly output: "token" | "native";
    readonly pool: typeof BNB_UNISWAP_USDT_WBNB_500 | typeof BNB_UNISWAP_USDC_WBNB_500 | typeof BNB_UNISWAP_USDT_USDC_100;
    readonly fee: 100 | 500;
    readonly inputSymbol: "USDT" | "USDC";
    readonly outputSymbol: "USDT" | "USDC" | "BNB";
}
export declare const BNB_UNISWAP_TOKEN_PAIRS: readonly BnbUniswapTokenPair[];
/** What the owner admits: SwapRouter02 with the factory, WBNB and the three pools it may touch (the native lane's route lists two). */
export declare const BNB_UNISWAP_TOKEN_MECHANISM_PIN: import("../pin.js").SwapMechanismPin;
export interface BnbUniswapTokenRoute {
    readonly schemaVersion: typeof BNB_UNISWAP_TOKEN_ROUTE_SCHEMA;
    readonly inputToken: string;
    /** The token the pool pays: the output token, or WBNB when `output` is native (the router unwraps it). */
    readonly outputToken: string;
    readonly output: "token" | "native";
    readonly recipient: string;
    readonly amountIn: string;
    readonly amountOutMinimum: string;
    readonly deadline: number;
    readonly router: typeof BNB_UNISWAP_SWAP_ROUTER_02;
    readonly pool: string;
    readonly fee: 100 | 500;
    readonly calldata: Hex;
    readonly routeHash: string;
}
/** The pinned direction from `inputToken` to `output`: native BNB, or the other Binance-Peg token. */
export declare function bnbUniswapTokenPair(inputToken: string, output: string): BnbUniswapTokenPair;
/**
 * SwapRouter02 multicall(deadline, calls) with value zero. Token output: one exactInputSingle(input, output, fee,
 * recipient, amountIn, amountOutMinimum, 0). Native output: exactInputSingle(input, WBNB, 500, ADDRESS_THIS, amountIn,
 * amountOutMinimum, 0), then unwrapWETH9(amountOutMinimum, recipient): the pool pays WBNB to the router, which unwraps all
 * of it and sends that BNB to the recipient (Uniswap's own encoding of a native output). The floor binds both calls.
 */
export declare function createBnbUniswapTokenRoute(input: {
    readonly inputToken: string;
    readonly outputToken: string;
    readonly recipient: string;
    readonly amountIn: string;
    readonly amountOutMinimum: string;
    readonly deadline: number;
}): BnbUniswapTokenRoute;
/** Every stored or created BNB route is re-derived from its own calldata by the strict decoder; any other field refuses. */
export declare function validateBnbUniswapTokenRoute(value: unknown): BnbUniswapTokenRoute;
/**
 * Strict SwapRouter02 proof: multicall(deadline, …) canonically encoded, holding exactly one exactInputSingle of a pinned
 * direction at its pinned fee with no price limit; a native output adds exactly one unwrapWETH9 whose floor equals the
 * swap's and pays the recipient, and its swap pays the router (ADDRESS_THIS). Anything else (a sweep, a refund, a second
 * swap, another tier, a sentinel or pinned-contract recipient) is refused.
 */
export declare function decodeBnbUniswapTokenCalldata(data: Hex): Omit<BnbUniswapTokenRoute, "routeHash">;
/** The exact approval of SwapRouter02 for one Binance-Peg token; the amount is the route's input, or zero for the cleanup. */
export declare function encodeBnbUniswapTokenApproval(tokenAddress: string, amount: string): {
    readonly to: string;
    readonly spender: string;
    readonly data: Hex;
    readonly amount: string;
};
/** Every contract a token-input swap touches or authorizes: the spender, WBNB, both tokens and the three pools. */
export declare const BNB_UNISWAP_TOKEN_CODE_PINS: readonly UniswapV3CodePin[];
/**
 * The lane's pin check, at quote and again by the signing guard before every approval, swap and cleanup, all at the one
 * block it just read: chain 56, the runtime code hash of every contract a swap touches (which fixes each pool's tokens,
 * fee and factory and the router's WETH9), the USDC proxy implementation and its code, and decimals() of both tokens (a
 * storage value no code hash fixes; anything but 18 refuses). Twelve reads in four provider-compatible batches.
 */
export declare function verifyBnbUniswapTokenRoutePins(call: EvmRpcCall, tag: Hex): Promise<void>;
