import { type Hex } from "viem";
import type { CommandRequest } from "../../commands.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { type SavedUniswapTokenMaterialStore } from "./token-material.js";
export type UniswapTokenQuoteRequest = Extract<CommandRequest, {
    readonly command: "swap.uniswap-token.quote";
}>;
export type UniswapTokenPolicyAdmission = (request: UniswapTokenQuoteRequest, now: Date) => Promise<string>;
export declare class UniswapTokenQuoteBuilder {
    private readonly call;
    private readonly store;
    private readonly admit;
    private readonly now;
    private readonly verifyPins;
    constructor(call: EvmRpcCall, store: SavedUniswapTokenMaterialStore, admit: UniswapTokenPolicyAdmission, now: () => Date, verifyPins?: (call: EvmRpcCall, tag: Hex) => Promise<void>);
    inventory(): {
        chain: string;
        router: "0xE592427A0AEce92De3Edee1F18E0157C05861564";
        pair: string;
        fee: number;
        mechanism: import("../pin.js").SwapMechanismPin;
        approval: string;
        transactionValue: string;
    };
    quote(input: UniswapTokenQuoteRequest): Promise<unknown>;
}
