import type { ClockPort, X402RpcPort } from "./ports.js";
import { type X402OperationRecord } from "./x402-state-integrity.js";
export interface X402ReconciliationStore {
    persist(operation: X402OperationRecord): Promise<void>;
}
export interface X402ReconciliationOutcome {
    readonly operation: X402OperationRecord;
    readonly completeZeroScanValidated: boolean;
    readonly completeZeroScanRead: boolean;
}
export declare class X402RpcReconciler {
    private readonly rpc;
    private readonly clock;
    private readonly store;
    constructor(rpc: X402RpcPort, clock: ClockPort, store: X402ReconciliationStore);
    reconcile(input: X402OperationRecord): Promise<X402ReconciliationOutcome>;
    private reconcileHint;
    private persist;
}
