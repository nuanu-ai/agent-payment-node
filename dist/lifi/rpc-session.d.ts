import type { EvmRpcCall } from "../evm-ports.js";
import type { BridgeChainId } from "./chains.js";
export declare const MAX_READ_ATTEMPTS = 2;
export declare const RPC_RETRY_DELAY_MS = 2000;
export declare const RPC_ARCHIVE_DEPLOYMENT_BATCH_MAX_ITEMS = 3;
export declare const RPC_BATCH_MAX_ITEMS = 33;
export declare const RPC_READ_METHODS: readonly ["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "debug_traceTransaction"];
export type RpcReadMethod = typeof RPC_READ_METHODS[number];
export type RpcBatchAttempt = (canonicalBody: string) => Promise<unknown>;
export interface RpcBatchReadItem<T = unknown> {
    readonly method: string;
    readonly params: readonly unknown[];
    readonly cachePolicy?: "auto" | "immutable" | "snapshot" | "none";
    readonly decoder: (value: unknown) => T;
    /** Transport-owned whole-batch attempt. All uncached items in one readBatch call must use the same function. */
    readonly batchAttempt: RpcBatchAttempt;
}
export interface RpcReadSessionOptions {
    readonly maxLogicalItems?: number;
    readonly maxHttpRequests?: number;
    readonly maxHttpAttempts?: number;
    readonly deadlineMs?: number;
    /** HTTP chunk bound for one atomic historical deployment read. General batches retain RPC_BATCH_MAX_ITEMS. */
    readonly archiveDeploymentBatchMaxItems?: number;
    /** Backward-compatible alias. */
    readonly maxUniqueCalls?: number;
    readonly now?: () => number;
    readonly wait?: (milliseconds: number) => Promise<void>;
    /** Shared by related commands so one provider family cannot be burst through separate sessions. */
    readonly providerScheduler?: RpcProviderScheduler;
}
export interface RpcReadTelemetry {
    readonly logicalItems: number;
    readonly httpRequests: number;
    readonly httpAttempts: number;
    readonly batchCount: number;
    readonly batchItemsByMethod: Readonly<Record<string, number>>;
    readonly dedupHits: number;
    readonly cacheHits: number;
    readonly singleflightHits: number;
    readonly endpointIdentities: readonly string[];
    readonly remainingLogicalItems: number;
    readonly remainingHttpRequests: number;
    readonly remainingHttpAttempts: number;
    readonly deadline: number;
    readonly retryAfterMs?: number;
    readonly attemptsByEndpointRole: Readonly<Record<"primary" | "receipt" | "archive", number>>;
    readonly attemptsByMethodClass: Readonly<Record<string, number>>;
    readonly maxBatchSize: number;
    readonly budgetRejectedBeforeTransport: number;
    /** Backward-compatible telemetry aliases. */
    readonly uniqueCalls: number;
    readonly totalAttempts: number;
    readonly perMethod: Readonly<Record<string, number>>;
    readonly remainingUniqueCalls: number;
}
export declare class RpcHttpFailure extends Error {
    readonly method: string;
    readonly status: number;
    readonly retryAfterMs?: number | undefined;
    constructor(method: string, status: number, retryAfterMs?: number | undefined);
}
export interface RpcProviderPacingCoordinator {
    coordinate<T>(family: string, work: (lastStart: number | null, saveStart: (value: number) => Promise<void>, cooldownUntil: number | null, saveCooldownUntil: (value: number) => Promise<void>) => Promise<T>): Promise<T>;
}
/** Provider-family coordination. A coordinator can serialize starts and retain pacing across CLI processes. */
export declare class RpcProviderScheduler {
    private readonly coordinator?;
    private readonly pacingNow?;
    private readonly families;
    private readonly queue;
    private active;
    constructor(coordinator?: RpcProviderPacingCoordinator | undefined, pacingNow?: (() => number) | undefined);
    schedule(origin: string, now: () => number, wait: (milliseconds: number) => Promise<void>, beforeWait: (milliseconds: number) => void, task: () => Promise<unknown>): Promise<unknown>;
    private pump;
    private run;
}
type RpcDecoder<T = unknown> = (value: unknown) => T;
/** Command-scoped read coordination with no persistence hook across approval or signing boundaries. */
export declare class RpcReadSession {
    private readonly maxLogicalItems;
    private readonly maxHttpRequests;
    private readonly maxHttpAttempts;
    private readonly archiveDeploymentBatchMaxItems;
    private readonly now;
    private readonly wait;
    private readonly deadline;
    private readonly providerScheduler;
    private readonly cache;
    private readonly inflight;
    private readonly batchInflight;
    private logicalItems;
    private httpRequests;
    private httpAttempts;
    private batchCount;
    private dedupHits;
    private cacheHits;
    private singleflightHits;
    private retryAfterMs;
    private readonly methods;
    private readonly endpoints;
    private readonly roleAttempts;
    private readonly methodClassAttempts;
    private maxBatchSize;
    private budgetRejectedBeforeTransport;
    constructor(options?: RpcReadSessionOptions);
    telemetry(): RpcReadTelemetry;
    currentTime(): number;
    recordPhysicalAttempt(endpointRole: "primary" | "receipt" | "archive", methods: readonly string[]): void;
    wrap(origin: string, chainId: BridgeChainId, call: EvmRpcCall, oneAttempt?: EvmRpcCall): EvmRpcCall;
    read(origin: string, chainId: BridgeChainId, method: string, params: readonly unknown[], oneAttempt: EvmRpcCall, decoder?: RpcDecoder): Promise<unknown>;
    /** Strict whole-batch read. Cached exact immutable/snapshot keys are removed before the one HTTP request. */
    readBatch<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T): Promise<{
        readonly [K in keyof T]: unknown;
    }>;
    /** One logical archive deployment read, transported sequentially in provider-sized chunks with one atomic cache commit. */
    readArchiveDeploymentBatch<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T): Promise<{
        readonly [K in keyof T]: unknown;
    }>;
    /** One atomic receipt identity read. Partial cache hits never remove chainId or receipt from the logical read. */
    readReceiptBatch<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T, maxItemsPerRequest: 1 | 3): Promise<{
        readonly [K in keyof T]: unknown;
    }>;
    private readBatchBounded;
    private executeBatch;
    private decodeBatch;
    private key;
    private reserveLogical;
    private reserveRequest;
    private retry;
    private schedule;
    private assertBeforeAttempt;
    private assertBeforeQueue;
    private assertBeforeWait;
    private assertDeadline;
    private budgetError;
    private rateLimit;
    private httpError;
    private transportError;
}
export declare function rpcOriginIdentity(origin: string): string;
export declare function rpcProviderFamily(origin: string): string;
export declare function rpcEndpointIdentity(endpoint: string): string;
export declare function approvedTransportReason(error: unknown): string | undefined;
export declare function parseRetryAfter(headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined, now: number): number | undefined;
export declare function telemetryDetails(telemetry: RpcReadTelemetry, method: string, reason: string): Record<string, string>;
export {};
