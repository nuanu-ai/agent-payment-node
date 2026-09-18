import type { EvmRpcCall } from "../../evm-ports.js";
import type { GuardedSwapReadOnlyBuilder } from "../runtime.js";
import { type UniswapV3PinVerifier } from "./pins.js";
import { SavedUniswapQuoteStore, type UniswapKeylessMaterial } from "./material.js";
export interface UniswapKeylessQuoteRequest {
    readonly profile: string;
    readonly account: string;
    readonly recipient: string;
    readonly outputToken: string;
    readonly amountAtomic: string;
    readonly slippageBps: number;
    readonly ownerSlippageCapBps: number;
    readonly deadline: number;
    readonly maxGasLimit: string;
    readonly maxFeePerGas: string;
    readonly maxPriorityFeePerGas: string;
}
/**
 * Keyless read-only builder: price, output, slippage floor and impact come from the pinned pool and QuoterV2 by eth_call;
 * the Universal Router calldata is encoded locally and simulated at the same block. No API key or off-chain quote is used.
 */
export declare class KeylessUniswapQuoteBuilder implements GuardedSwapReadOnlyBuilder<UniswapKeylessQuoteRequest> {
    private readonly call;
    private readonly quotes;
    private readonly verifyPins;
    constructor(call: EvmRpcCall, quotes: SavedUniswapQuoteStore, verifyPins: UniswapV3PinVerifier);
    quote(input: UniswapKeylessQuoteRequest & {
        readonly now: Date;
    }): Promise<unknown>;
    load(quoteHash: string): Promise<UniswapKeylessMaterial | null>;
    private assertChain;
}
