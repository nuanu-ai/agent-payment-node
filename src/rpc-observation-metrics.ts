/** Internal POST counters. Dispatch counts actual HTTPS request construction, not logical reads. */
export interface RpcObservationCounters { attempts: number; admissions: number; physicalDispatches: number }
export function rpcObservationCounters(): RpcObservationCounters { return { attempts: 0, admissions: 0, physicalDispatches: 0 }; }
export function rpcObservationSnapshot(value: RpcObservationCounters): Readonly<RpcObservationCounters> {
  return Object.freeze({ ...value });
}
