import type { Address, Hex } from "../model.js";
import type { GaslessBlock, GaslessLog } from "./model.js";
export type GaslessRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getBalance" | "eth_getCode" | "eth_getStorageAt" | "eth_getTransactionCount" | "eth_call" | "eth_maxPriorityFeePerGas" | "eth_getTransactionByHash" | "eth_getTransactionReceipt" | "eth_getLogs" | "eth_supportedEntryPoints" | "eth_estimateUserOperationGas" | "eth_sendUserOperation" | "eth_getUserOperationReceipt" | "eth_getUserOperationByHash";
export type GaslessRpcCall = (method: GaslessRpcMethod, params: readonly unknown[]) => Promise<unknown>;
export interface GaslessRawBlock {
    readonly block: GaslessBlock;
    readonly tag: Hex;
    readonly raw: Record<string, unknown>;
}
export declare function rpcRecord(value: unknown): Record<string, unknown>;
export declare function rpcJson(value: string, maximumBytes: number): unknown;
export declare function rpcQuantity(value: unknown): bigint;
export declare function rpcHex(value: unknown, maximumBytes?: number, bytes?: number): Hex;
export declare function rpcWord(value: unknown): bigint;
export declare function rpcBool(value: unknown): boolean;
export declare function rpcAddress(value: unknown): Address;
export declare function quantity(value: bigint): Hex;
export declare function addressWord(value: Address): Hex;
export declare function rpcBlock(call: GaslessRpcCall, tag: "latest" | "safe" | Hex): Promise<GaslessRawBlock>;
export declare function recheckBlock(call: GaslessRpcCall, block: GaslessBlock): Promise<void>;
export declare function sameBlock(left: GaslessBlock, right: GaslessBlock): boolean;
export declare function parseReceiptLogs(value: unknown, transactionHash: Hex, block: GaslessBlock, transactionIndex: bigint): readonly GaslessLog[];
export declare function receiptHash(chainId: number, transactionHash: Hex, block: GaslessBlock, status: bigint, logs: readonly GaslessLog[]): string;
