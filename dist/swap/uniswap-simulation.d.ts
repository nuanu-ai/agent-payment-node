import type { EvmRpcCall } from "../evm-ports.js";
import type { UniswapTransactionEnvelope } from "./uniswap-codec.js";
export interface UniswapSimulationProof {
    readonly requestHash: string;
    readonly resultHash: string;
    readonly success: true;
    readonly blockNumber: string;
    readonly blockHash: `0x${string}`;
    readonly headBlockNumber: string;
    readonly maxHeadDrift: number;
    readonly gasEstimate: string;
}
export declare class UniswapEvmSimulator {
    private readonly call;
    private readonly maxHeadDrift;
    constructor(call: EvmRpcCall, maxHeadDrift?: number);
    simulate(envelope: UniswapTransactionEnvelope): Promise<UniswapSimulationProof>;
}
