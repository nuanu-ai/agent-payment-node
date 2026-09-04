import type { ClockPort, X402RpcPort } from "./ports.js";
import { type X402OperationRecord } from "./x402-state-integrity.js";
export interface Erc7710ReconciliationStore {
    persist(operation: X402OperationRecord): Promise<void>;
}
export declare class X402Erc7710RpcReconciler {
    private readonly rpc;
    private readonly clock;
    private readonly store;
    constructor(rpc: X402RpcPort, clock: ClockPort, store: Erc7710ReconciliationStore);
    reconcile(operation: X402OperationRecord): Promise<X402OperationRecord>;
    private canProveExpiredUnused;
    private reconcileExpiredUnused;
    private firstExpiredBlock;
    private scanExactTransfers;
}
