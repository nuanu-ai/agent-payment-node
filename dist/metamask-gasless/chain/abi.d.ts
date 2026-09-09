import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessBlock } from "../model.js";
import { type MetaMaskGaslessFailureReason } from "../reasons.js";
export type MmRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getCode" | "eth_getStorageAt" | "eth_call" | "eth_getTransactionByHash" | "eth_getTransactionReceipt" | "eth_getLogs";
export type MmRpcCall = (method: MmRpcMethod, params: readonly unknown[]) => Promise<unknown>;
export interface MmRawBlock {
    readonly block: MetaMaskGaslessBlock;
    readonly raw: Record<string, unknown>;
    readonly tag: Hex;
}
export interface MmReceiptLog {
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
    readonly logIndexAtomic: string;
}
export declare const MM_ZERO_HEX_HASH: Hex;
export declare const MM_TRANSFER_TOPIC: `0x${string}`;
export declare const MM_APPROVAL_TOPIC: `0x${string}`;
export declare const MM_INCREASED_COUNT_TOPIC: `0x${string}`;
export declare const MM_REDEEM_SELECTOR: `0x${string}`;
export declare const MM_DECIMALS_CALL: `0x${string}`;
export declare const MM_EXECUTION_PARAMETER: {
    readonly type: "tuple[]";
    readonly components: readonly [{
        readonly name: "target";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }, {
        readonly name: "callData";
        readonly type: "bytes";
    }];
};
export declare const MM_DELEGATION_PARAMETER: {
    readonly type: "tuple[]";
    readonly components: readonly [{
        readonly name: "delegate";
        readonly type: "address";
    }, {
        readonly name: "delegator";
        readonly type: "address";
    }, {
        readonly name: "authority";
        readonly type: "bytes32";
    }, {
        readonly name: "caveats";
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly name: "enforcer";
            readonly type: "address";
        }, {
            readonly name: "terms";
            readonly type: "bytes";
        }, {
            readonly name: "args";
            readonly type: "bytes";
        }];
    }, {
        readonly name: "salt";
        readonly type: "uint256";
    }, {
        readonly name: "signature";
        readonly type: "bytes";
    }];
};
export declare function rpcRecord(value: unknown, reason?: MetaMaskGaslessFailureReason): Record<string, unknown>;
export declare function rpcQuantity(value: unknown, reason?: MetaMaskGaslessFailureReason): bigint;
export declare function rpcHex(value: unknown, maximumBytes?: number, bytes?: number, reason?: MetaMaskGaslessFailureReason): Hex;
export declare function rpcAddress(value: unknown, reason?: MetaMaskGaslessFailureReason): Address;
export declare function rpcWord(value: unknown, reason?: MetaMaskGaslessFailureReason): bigint;
export declare function quantity(value: bigint): Hex;
export declare function addressWord(value: Address): Hex;
export declare function callData(signature: string, words?: readonly Hex[]): Hex;
export declare function rpcBlock(call: MmRpcCall, tag: "latest" | "safe" | "finalized" | Hex, fullTransactions?: boolean): Promise<MmRawBlock>;
export declare function recheckBlock(call: MmRpcCall, block: MetaMaskGaslessBlock, reason?: MetaMaskGaslessFailureReason): Promise<void>;
export declare function sameBlock(left: MetaMaskGaslessBlock, right: MetaMaskGaslessBlock): boolean;
export declare function parseReceiptLogs(value: unknown, transactionHash: Hex, block: MetaMaskGaslessBlock, transactionIndex: bigint): readonly MmReceiptLog[];
export declare function topicAddress(value: Hex): Address;
export declare function twoWords(value: Hex): readonly [bigint, bigint];
export declare function receiptHash(chainId: number, transactionHash: Hex, block: MetaMaskGaslessBlock, status: bigint, logs: readonly MmReceiptLog[]): string;
