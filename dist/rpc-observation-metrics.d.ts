/** Internal POST counters. Dispatch counts actual HTTPS request construction, not logical reads. */
export interface RpcObservationCounters {
    attempts: number;
    admissions: number;
    physicalDispatches: number;
}
export declare function rpcObservationCounters(): RpcObservationCounters;
export declare function rpcObservationSnapshot(value: RpcObservationCounters): Readonly<RpcObservationCounters>;
