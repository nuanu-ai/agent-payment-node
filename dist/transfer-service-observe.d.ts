import type { Economics, Hex, OperationRecord } from "./model.js";
import type { RpcPort, RpcReceipt } from "./ports.js";
import type { RuntimeContext } from "./runtime.js";
import { ProviderDirectTransferService } from "./provider-direct-transfer.js";
/** Existing lifecycle mutations only; recovery cannot introduce an arbitrary signer. */
export interface TransferObserveLifecycle {
    followUsage<T extends OperationRecord>(operation: T): Promise<T>;
    transition(operation: LocalOperationRecord, state: OperationRecord["state"], terminal: boolean, reason: string, proofClass: string, extra?: Partial<Pick<OperationRecord, "transactionHash" | "rawTransactionHash" | "lastSubmissionAt" | "allowlistLease">>, rpcReceipt?: RpcReceipt): Promise<LocalOperationRecord>;
    failBeforeEffect(operation: LocalOperationRecord, reason: string): Promise<never>;
}
/** Observation/recovery implementation behind the unchanged TransferService facade. */
export declare class TransferServiceObservation {
    private readonly context;
    private readonly providerDirect;
    private readonly lifecycle;
    private readonly providerDirectRecovery;
    constructor(context: RuntimeContext, providerDirect: ProviderDirectTransferService, lifecycle: TransferObserveLifecycle);
    submitAndInspect(operationInput: LocalOperationRecord, rawTransaction: Hex): Promise<LocalOperationRecord>;
    private dispatchAndInspect;
    resume(operationIdInput: string, waitSeconds?: number, observeOnly?: true): Promise<unknown>;
    recoverProviderRequest(operationIdInput: string, providerRequestId: string): Promise<unknown>;
    status(operationIdInput: string): Promise<unknown>;
    receipt(operationIdInput: string): Promise<unknown>;
    inspectReceipt(operation: LocalOperationRecord, rpc: RpcPort): Promise<LocalOperationRecord>;
    private proveSuperseding;
    requiredOperation(operationId: string): Promise<OperationRecord>;
    private effectFor;
}
export type LocalOperationRecord = OperationRecord & {
    readonly providerDirect?: never;
    readonly transactionData: Hex;
    readonly economics: Economics;
    readonly preparedBlockNumberAtomic: string;
};
export declare function requiredLocal(operation: OperationRecord): LocalOperationRecord;
