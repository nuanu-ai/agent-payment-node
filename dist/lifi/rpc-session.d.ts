import type { EvmRpcCall } from "../evm-ports.js";
import type { BridgeChainId } from "./chains.js";
export declare const MAX_READ_ATTEMPTS = 2;
export declare const RPC_RETRY_DELAY_MS = 2000;
export interface RpcReadSessionOptions {
    readonly maxUniqueCalls?: number;
    readonly maxHttpAttempts?: number;
    readonly deadlineMs?: number;
    readonly now?: () => number;
    readonly wait?: (milliseconds: number) => Promise<void>;
}
export interface RpcReadTelemetry {
    readonly uniqueCalls: number;
    readonly totalAttempts: number;
    readonly dedupHits: number;
    readonly singleflightHits: number;
    readonly perMethod: Readonly<Record<string, number>>;
    readonly remainingUniqueCalls: number;
    readonly remainingHttpAttempts: number;
    readonly deadline: number;
    readonly retryAfterMs?: number;
}
export declare class RpcHttpFailure extends Error {
    readonly method: string;
    readonly status: number;
    readonly retryAfterMs?: number | undefined;
    constructor(method: string, status: number, retryAfterMs?: number | undefined);
}
/** Command-scoped read coordination with no persistence hook across approval or signing boundaries. */
export declare class RpcReadSession {
    private readonly maxUniqueCalls;
    private readonly maxHttpAttempts;
    private readonly now;
    private readonly wait;
    private readonly deadline;
    private readonly cache;
    private readonly inflight;
    private readonly origins;
    private readonly queue;
    private active;
    private uniqueCalls;
    private totalAttempts;
    private dedupHits;
    private singleflightHits;
    private retryAfterMs;
    private readonly methods;
    constructor(options?: RpcReadSessionOptions);
    telemetry(): RpcReadTelemetry;
    /** Current command clock, used by transports for deterministic Retry-After date parsing. */
    currentTime(): number;
    wrap(origin: string, chainId: BridgeChainId, call: EvmRpcCall, oneAttempt?: EvmRpcCall): EvmRpcCall;
    read(origin: string, chainId: BridgeChainId, method: string, params: readonly unknown[], oneAttempt: EvmRpcCall): Promise<unknown>;
    private retry;
    private schedule;
    private pump;
    private runScheduled;
    private assertBeforeUnique;
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
export declare function rpcEndpointIdentity(endpoint: string): string;
export declare function approvedTransportReason(error: unknown): string | undefined;
export declare function parseRetryAfter(headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined, now: number): number | undefined;
export declare function telemetryDetails(telemetry: RpcReadTelemetry, method: string, reason: string): Record<string, string>;
