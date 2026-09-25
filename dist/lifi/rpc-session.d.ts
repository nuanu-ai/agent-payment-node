import type { EvmRpcCall } from "../evm-ports.js";
import type { BridgeChainId } from "./chains.js";
import { RpcProviderScheduler } from "./rpc-scheduler.js";
export { RpcHttpFailure, RpcProviderScheduler, RPC_RETRY_DELAY_MS, rpcOriginIdentity, rpcProviderFamily } from "./rpc-scheduler.js";
export type { RpcProviderPacingCoordinator } from "./rpc-scheduler.js";
export declare const MAX_READ_ATTEMPTS = 2;
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
    /** Attempts permitted for one logical read. Defaults to the established two-attempt LI.FI contract. */
    readonly maxReadAttempts?: 1 | 2;
    readonly deadlineMs?: number;
    /** HTTP chunk bound for one atomic historical deployment read. General batches retain RPC_BATCH_MAX_ITEMS. */
    readonly archiveDeploymentBatchMaxItems?: number;
    /** One-prepare opt-in: Linea deployment code reads use scalar archive POSTs. */
    readonly lineaArchiveDeploymentScalarCode?: boolean;
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
    readonly attemptsByBatchSize: Readonly<Record<string, number>>;
    readonly maxBatchSize: number;
    readonly budgetRejectedBeforeTransport: number;
    /** Backward-compatible telemetry aliases. */
    readonly uniqueCalls: number;
    readonly totalAttempts: number;
    readonly perMethod: Readonly<Record<string, number>>;
    readonly remainingUniqueCalls: number;
}
type RpcDecoder<T = unknown> = (value: unknown) => T;
/** Command-scoped read coordination with no persistence hook across approval or signing boundaries. */
export declare class RpcReadSession {
    private readonly maxLogicalItems;
    private readonly maxHttpRequests;
    private readonly maxHttpAttempts;
    private readonly maxReadAttempts;
    private readonly archiveDeploymentBatchMaxItems;
    private readonly lineaArchiveDeploymentScalarCode;
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
    private externalAttempts;
    private externalReservations;
    private batchCount;
    private dedupHits;
    private cacheHits;
    private singleflightHits;
    private retryAfterMs;
    private readonly methods;
    private readonly endpoints;
    private readonly roleAttempts;
    private readonly methodClassAttempts;
    private readonly batchSizeAttempts;
    private maxBatchSize;
    private budgetRejectedBeforeTransport;
    constructor(options?: RpcReadSessionOptions);
    telemetry(): RpcReadTelemetry;
    currentTime(): number;
    /** Reserve a physical POST for an effect before signing. Reads and pool probes share this limit. */
    reserveExternalAttempt(): void;
    consumeExternalAttempt(): void;
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
    private recordAttemptShape;
    private assertBeforeAttempt;
    private assertBeforeQueue;
    private assertBeforeWait;
    private assertDeadline;
    private budgetError;
    private rateLimit;
    private httpError;
    private transportError;
}
export declare function rpcEndpointIdentity(endpoint: string): string;
export declare function approvedTransportReason(error: unknown): string | undefined;
export declare function parseRetryAfter(headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined, now: number): number | undefined;
export declare function telemetryDetails(telemetry: RpcReadTelemetry, method: string, reason: string): Record<string, string>;
