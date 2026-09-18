import { type TronBlock, type TronRpcPort } from "../../tron/rpc.js";
export interface SunSwapConstantCall {
    readonly owner: string;
    readonly contract: string;
    readonly data: string;
    readonly callValueAtomic: string;
}
export interface SunSwapConstantResult {
    readonly resultHex: string;
    readonly energyUsed: string;
    readonly energyPenalty: string;
}
export interface SunSwapBlockReference {
    readonly number: string;
    readonly id: string;
    readonly timestampMs: string;
}
/** The exact wallet/triggerconstantcontract body for one call; addresses are 41-prefixed hex and data carries no 0x. */
export declare function sunSwapConstantBody(call: SunSwapConstantCall): Readonly<Record<string, unknown>>;
/**
 * Executes one read-only constant call and proves the node echoed the exact owner, contract, calldata and call value.
 * A missing owner account or insufficient call value is an economic refusal, never a protocol failure.
 */
export declare function triggerSunSwapConstant(rpc: TronRpcPort, call: SunSwapConstantCall): Promise<SunSwapConstantResult>;
export declare function sunSwapHead(rpc: TronRpcPort): Promise<TronBlock>;
export declare function sunSwapBlockReference(block: TronBlock): SunSwapBlockReference;
/** Every later read must observe a head at or after the recorded block and within the frozen drift bound. */
export declare function assertSunSwapHeadDrift(reference: {
    readonly number: string;
    readonly id: string;
}, head: TronBlock): string;
/** Converts lossless RPC bigints to decimal strings so raw evidence can be canonically hashed. */
export declare function normalizeTronEvidence(value: unknown, depth?: number): unknown;
