import type { Address, Hex } from "../../model.js";
import type { SmartAccountGaslessBlock } from "../model.js";
import { type SmartAccountGaslessReason } from "../reasons.js";
export type SaRpcMethod = "eth_chainId" | "eth_getBlockByNumber" | "eth_getCode" | "eth_getStorageAt" | "eth_call" | "eth_getBalance" | "eth_getTransactionByHash" | "eth_getTransactionReceipt" | "eth_getLogs";
export type SaRpcCall = (method: SaRpcMethod, params: readonly unknown[]) => Promise<unknown>;
/** Internal sanitized signals used to preserve a truthful partial cursor. */
export declare class SaRpcBudgetError extends Error {
}
export declare class SaRpcRangeError extends Error {
}
export declare class SaRpcReorgError extends Error {
}
export declare class SaScanLimitError extends Error {
}
export interface SaRawBlock {
    readonly block: SmartAccountGaslessBlock;
    readonly raw: Record<string, unknown>;
    readonly tag: Hex;
}
export interface SaReceiptLog {
    readonly address: Address;
    readonly topics: readonly Hex[];
    readonly data: Hex;
    readonly logIndexAtomic: string;
    readonly transactionHash: Hex;
}
export declare const SA_ZERO_HEX_HASH: Hex;
export declare const SA_TRANSFER_TOPIC: `0x${string}`;
export declare const SA_REDEEMED_TOPIC: `0x${string}`;
export declare const SA_INCREASED_SPENT_TOPIC: `0x${string}`;
export declare const SA_REDEEM_SELECTOR: `0x${string}`;
export declare const SA_GET_AVAILABLE_SELECTOR: Hex;
export declare const SA_CURRENT_NONCE_SELECTOR: Hex;
export declare const SA_SPENT_MAP_SELECTOR: `0x${string}`;
export declare const SA_DECIMALS_SELECTOR: `0x${string}`;
export declare const SA_DOMAIN_SEPARATOR_SELECTOR: `0x${string}`;
export declare const SA_BALANCE_OF_SELECTOR: `0x${string}`;
export declare const SA_TRANSFER_SELECTOR: `0x${string}`;
export declare const SA_SINGLE_DEFAULT: Hex;
export declare const SA_CAVEAT_PARAMETER: {
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
};
export declare const SA_DELEGATION_TUPLE_PARAMETER: {
    readonly type: "tuple";
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
export declare const SA_DELEGATION_ARRAY_PARAMETER: {
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
export declare function rpcRecord(value: unknown, reason?: SmartAccountGaslessReason): Record<string, unknown>;
/** JSON-RPC quantities are canonical lower-case uint256 values. */
export declare function rpcQuantity(value: unknown, reason?: SmartAccountGaslessReason): bigint;
export declare function rpcHex(value: unknown, maximumBytes?: number, bytes?: number, reason?: SmartAccountGaslessReason): Hex;
export declare function rpcAddress(value: unknown, reason?: SmartAccountGaslessReason): Address;
export declare function rpcWord(value: unknown, reason?: SmartAccountGaslessReason): bigint;
export declare function quantity(value: bigint): Hex;
export declare function addressWord(value: Address): Hex;
export declare function topicAddress(value: Hex): Address;
export declare function twoWords(value: Hex): readonly [bigint, bigint];
export declare function rpcBlock(call: SaRpcCall, tag: "latest" | "safe" | "finalized" | Hex, fullTransactions?: boolean): Promise<SaRawBlock>;
export declare function sameBlock(left: SmartAccountGaslessBlock, right: SmartAccountGaslessBlock): boolean;
export declare function recheckBlock(call: SaRpcCall, block: SmartAccountGaslessBlock, reason?: SmartAccountGaslessReason, signalReorg?: boolean): Promise<void>;
export declare function parseReceiptLogs(value: unknown, transactionHash: Hex, block: SmartAccountGaslessBlock, transactionIndex: bigint): readonly SaReceiptLog[];
export declare function receiptHash(chainId: number, transactionHash: Hex, block: SmartAccountGaslessBlock, status: bigint, logs: readonly SaReceiptLog[]): string;
