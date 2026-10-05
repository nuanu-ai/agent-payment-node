import { type ReadOnlyRpcBatchCall } from "../rpc.js";
import type { StateStore } from "../state.js";
export interface Permit2ObservationMetrics {
    readonly attempts: number;
    readonly admissions: number;
    readonly physicalDispatches: number;
    readonly logicalReads: number;
    readonly errors: number;
    readonly methods: Readonly<Record<string, number>>;
}
/** Concrete configured transport; no injected RPC factory, cache, retries or scalar fallback. */
export declare class Permit2ObserverRpc {
    private readonly rpc;
    private readonly controller;
    private readonly timeout;
    private logicalReads;
    private errors;
    private readonly methods;
    private batches;
    constructor(endpoint: string, state: StateStore);
    batch(calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]>;
    metrics(): Permit2ObservationMetrics;
    close(): void;
}
