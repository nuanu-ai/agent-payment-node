import { ApnError } from "../errors.js";
import type { RpcDecoder, RpcReadTelemetry } from "./rpc-session.js";
export declare const MAX_READ_ATTEMPTS = 2;
export declare const BRIDGE_INVOCATION_RPC_POST_LIMIT = 24;
/** One invocation's physical transport gate, shared by every chain and read/observation session. */
export declare class BridgeRpcPhysicalBudget {
    private readonly now;
    private readonly wait;
    private posts;
    private lastStart;
    private tail;
    constructor(now?: () => number, wait?: (milliseconds: number) => Promise<void>);
    remaining(): number;
    require(posts: number, method: string): void;
    beforePost(method: string): Promise<void>;
}
export declare const RPC_ARCHIVE_DEPLOYMENT_BATCH_MAX_ITEMS = 3;
export declare const RPC_DEFAULT_LOGICAL_ITEMS = 96;
export declare const RPC_DEFAULT_HTTP_REQUESTS = 8;
export declare const RPC_DEFAULT_HTTP_ATTEMPTS = 10;
export declare const RPC_DEFAULT_DEADLINE_MS = 180000;
export declare const RPC_BATCH_MAX_ITEMS = 33;
export declare const RPC_READ_METHODS: readonly ["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "debug_traceTransaction"];
export type RpcReadMethod = typeof RPC_READ_METHODS[number];
export declare function rpcEndpointIdentity(endpoint: string): string;
export declare function invalidRpcReadMethod(): ApnError;
export declare function assertRpcReadMethod(method: unknown): asserts method is RpcReadMethod;
export declare function approvedTransportReason(error: unknown): string | undefined;
export declare function parseRetryAfter(headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined, now: number): number | undefined;
export declare function telemetryDetails(telemetry: RpcReadTelemetry, method: string, reason: string): Record<string, string>;
export declare function rpcMethodClass(method: string): string;
export declare function positiveBound(value: number, name: string): number;
export declare function identity(value: unknown): unknown;
export declare function decodeRpcValue<T>(decoder: RpcDecoder<T>, raw: unknown): T;
export declare function cloneRpcValue(value: unknown): unknown;
export declare function isSessionCacheable(method: string, params: readonly unknown[], value: unknown): boolean;
