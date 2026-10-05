export function rpcObservationCounters() { return { attempts: 0, admissions: 0, physicalDispatches: 0 }; }
export function rpcObservationSnapshot(value) {
    return Object.freeze({ ...value });
}
//# sourceMappingURL=rpc-observation-metrics.js.map