import type { Address, Hex } from "./model.js";
import type { EvmRpcCall } from "./evm-ports.js";
export declare function evmRpcRecord(value: unknown, details?: {
    readonly rpcMethod: string;
    readonly stage: string;
    readonly blockTag: string;
}): Record<string, unknown>;
export declare function evmRpcQuantity(value: unknown): bigint;
export declare function evmRpcHex(value: unknown, bytes?: number): Hex;
export declare function evmRpcWord(value: unknown): bigint;
export declare function evmRpcAddress(value: unknown): Address;
export declare function evmRpcBlock(call: EvmRpcCall, tag: string): Promise<{
    readonly tag: Hex;
    readonly number: string;
    readonly hash: Hex;
    readonly raw: Record<string, unknown>;
}>;
/** Decode a block already fetched with other independent reads in one RPC batch. */
export declare function evmRpcBlockResult(value: unknown, tag: string): {
    readonly tag: Hex;
    readonly number: string;
    readonly hash: Hex;
    readonly raw: Record<string, unknown>;
};
export declare function recheckEvmBlock(call: EvmRpcCall, block: {
    readonly tag: Hex;
    readonly hash: Hex;
}): Promise<void>;
export declare function evmTokenBalance(call: EvmRpcCall, token: Address, address: Address, tag: Hex): Promise<bigint>;
