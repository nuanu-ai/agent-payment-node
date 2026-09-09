import type { GaslessRequest } from "./model.js";
/** Shared command surface only; each provider retains its own strict persisted schema. */
export declare const GASLESS_COMMAND_CHAINS: readonly [1, 10, 130, 137, 143, 1329, 8453, 42161, 43114, 59144];
export type GaslessCommandChainId = typeof GASLESS_COMMAND_CHAINS[number];
export type GaslessCommandRequest = Omit<GaslessRequest, "chainId"> & {
    readonly chainId: GaslessCommandChainId;
};
export declare function gaslessCommandChain(value: number): GaslessCommandChainId;
export declare function gaslessCommandRequest(request: GaslessCommandRequest): GaslessCommandRequest;
