import { type Hex } from "viem";
import type { CommandRequest } from "../../commands.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { type UniswapTokenLane } from "./token-lane.js";
import { type SavedUniswapTokenMaterialStore } from "./token-material.js";
/** The quote request of either lane: Ethereum's `swap.uniswap-token.quote` or BNB Smart Chain's `swap.uniswap-bnb-token.quote`. */
export type UniswapTokenQuoteRequest = Extract<CommandRequest, {
    readonly command: "swap.uniswap-token.quote" | "swap.uniswap-bnb-token.quote";
}>;
export type UniswapTokenPolicyAdmission = (request: UniswapTokenQuoteRequest, now: Date) => Promise<string>;
/**
 * The token lane's quote of one chain: the lane's pinned route and router, its QuoterV2 and its pins, read at one block
 * of the lane's own RPC. A request of another lane's command family refuses before any read.
 */
export declare class UniswapTokenLaneQuoteBuilder {
    private readonly lane;
    private readonly call;
    private readonly store;
    private readonly admit;
    private readonly now;
    private readonly verifyPins;
    constructor(lane: UniswapTokenLane, call: EvmRpcCall, store: SavedUniswapTokenMaterialStore, admit: UniswapTokenPolicyAdmission, now: () => Date, verifyPins: (call: EvmRpcCall, tag: Hex) => Promise<void>);
    inventory(): unknown;
    quote(input: UniswapTokenQuoteRequest): Promise<unknown>;
}
/** The Ethereum token lane's quote builder: canonical USDC and USDT through the original SwapRouter. */
export declare class UniswapTokenQuoteBuilder extends UniswapTokenLaneQuoteBuilder {
    constructor(call: EvmRpcCall, store: SavedUniswapTokenMaterialStore, admit: UniswapTokenPolicyAdmission, now: () => Date, verifyPins?: (call: EvmRpcCall, tag: Hex) => Promise<void>);
}
