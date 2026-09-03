import type { OperationRecord } from "./model.js";
import type { RpcReceipt } from "./ports.js";
import type { RuntimeContext } from "./runtime.js";
export declare class ProviderDirectState {
    private readonly context;
    constructor(context: RuntimeContext);
    recoverOrphanTerminal(operation: OperationRecord): Promise<OperationRecord>;
    inspectReceipt(operation: OperationRecord): Promise<OperationRecord>;
    transition(operation: OperationRecord, state: OperationRecord["state"], terminal: boolean, reason: string, proofClass: string, extra?: Partial<Pick<OperationRecord, "transactionHash" | "providerEffect">>, rpcReceipt?: RpcReceipt): Promise<OperationRecord>;
    persist(operation: OperationRecord, rpcReceipt?: RpcReceipt): Promise<void>;
    private receiptPending;
    private receiptAmbiguous;
}
