import type { EvmRpcCall } from "../evm-ports.js";
import type { Hex } from "../model.js";
import type { BridgeChainId } from "./chains.js";
import type { BridgeBlock } from "./model.js";
export declare const READ_METHODS: Set<string>;
export declare function retryDirect(method: string, _params: readonly unknown[], oneAttempt: () => Promise<unknown>, wait?: (milliseconds: number) => Promise<void>): Promise<unknown>;
export declare function submitDirect(method: string, params: readonly unknown[], oneAttempt: EvmRpcCall): Promise<unknown>;
export declare function withEndpointRole<T>(read: Promise<T>, endpointRole: "primary" | "receipt" | "archive"): Promise<T>;
export declare function isReceiptFallbackError(error: unknown): boolean;
export declare function historicalReceiptUnavailable(value: unknown, chainId: BridgeChainId, target: URL, method: string): boolean;
export declare function knownPublicNodeReceiptCapability(chainId: BridgeChainId, target: URL, method: string, body: string): boolean;
export declare function missingHistoricalArchive(): never;
export declare function rpcBodyMethod(body: string): string;
export declare function decodeAtomicBatchResponse(response: unknown, requests: readonly {
    readonly id: string;
}[]): readonly unknown[];
export declare function isArchiveBatchItem(method: string, params: readonly unknown[]): boolean;
export declare function isReceiptBatchShape(items: readonly {
    readonly method: string;
    readonly params: readonly unknown[];
}[]): boolean;
export declare function rpcArchiveChainValue(chainId: BridgeChainId): (value: unknown) => bigint;
export declare function rpcFallbackChainValue(chainId: BridgeChainId, role: "receipt" | "archive"): (value: unknown) => bigint;
export declare function rpcReceiptFallbackValue(expected: unknown): (value: unknown) => unknown;
export declare function assertMatchingHeader(raw: Record<string, unknown>, expected: BridgeBlock): void;
export declare function quantity(n: bigint): Hex;
export declare function eip7702Delegation(code: Hex): boolean;
