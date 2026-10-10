import type { RpcObservationCounters } from "./rpc-observation-metrics.js";
import type { PinnedAddress } from "./network-policy.js";
export declare const MAX_RPC_BATCH_CALLS = 16;
export declare const BATCH_READ_METHODS: Set<string>;
/** Trace admission is a fixed exhaustive callTracer read, never a supplied JavaScript tracer. */
export declare function readOnlyBatchMethod(method: string, params: readonly unknown[]): boolean;
export declare function parseRpcResultEnvelope(raw: string, id: string, method?: string): unknown;
export declare function parseRpcBatchResultEnvelope(raw: string, ids: readonly number[]): readonly unknown[];
export declare function parseRpcLogEnvelope(raw: string, id: string): {
    readonly kind: "complete";
    readonly value: unknown;
} | {
    readonly kind: "pruned";
} | {
    readonly kind: "range_unavailable";
};
export declare function classifyX402LogAvailabilityMessage(message: string): "pruned" | "range_unavailable" | null;
export declare function postJson(endpoint: URL, body: string, addresses: readonly PinnedAddress[], timeoutMs: number, rpcMethod: string, allowJsonRpcClientError?: boolean, abortSignal?: AbortSignal, counters?: RpcObservationCounters, beforeSend?: () => void): Promise<string>;
export declare function acceptRpcHttpBody(status: number | undefined, allowJsonRpcClientError: boolean): boolean;
export declare function rpcAbortableWait(signal: AbortSignal): (milliseconds: number) => Promise<void>;
