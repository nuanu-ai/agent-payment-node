import type { Economics, Hex, OperationRecord } from "./model.js";
import type { RpcPort, RpcReceipt } from "./ports.js";
import type { RuntimeContext } from "./runtime.js";
import { ProviderDirectTransferService } from "./provider-direct-transfer.js";
/** Existing lifecycle mutations only; recovery cannot introduce an arbitrary signer. */
export interface TransferObserveLifecycle {
    followUsage<T extends OperationRecord>(operation: T): Promise<T>;
    transition(operation: LocalOperationRecord, state: OperationRecord["state"], terminal: boolean, reason: string, proofClass: string, extra?: Partial<Pick<OperationRecord, "transactionHash" | "rawTransactionHash" | "lastSubmissionAt" | "allowlistLease">>, rpcReceipt?: RpcReceipt): Promise<LocalOperationRecord>;
    /** Caller protects and releases its exact reservation without recursively taking the bucket lock. */
    persistNoPrivateEntry(operation: LocalOperationRecord): Promise<LocalOperationRecord>;
    failBeforeEffect(operation: LocalOperationRecord, reason: string): Promise<never>;
}
/** Observation/recovery implementation behind the unchanged TransferService facade. */
export declare class TransferServiceObservation {
    private readonly context;
    private readonly providerDirect;
    private readonly lifecycle;
    private readonly providerDirectRecovery;
    constructor(context: RuntimeContext, providerDirect: ProviderDirectTransferService, lifecycle: TransferObserveLifecycle);
    /**
     * Every check that can refuse (policy, funding, fees, nonce) ran before signing. A persisted signature is only ever
     * dispatched, as these exact bytes, or kept resumable; nothing after signing may strand it.
     */
    submitAndInspect(operationInput: LocalOperationRecord, rawTransaction: Hex): Promise<LocalOperationRecord>;
    private dispatchAndInspect;
    resume(operationIdInput: string, waitSeconds?: number, observeOnly?: true, coinbaseObservationRpc?: string): Promise<unknown>;
    /**
     * No receipt. A finalized sender nonce past the frozen one, read in the same POST as the missing receipt, proves another
     * transaction consumed it: this one can never land. A hash the RPC does not hold at all is re-sent as the identical
     * signed bytes; at most one copy of them can ever be included, so observing first and re-sending never adds an effect.
     */
    private settleUnlanded;
    /** The persisted signed bytes, read back from encrypted custody and checked against the frozen transfer; never a new signature. */
    private signedRawTransaction;
    /** Signed but never dispatched by APN: after the owner's foreground acknowledgement it is closed and never sent. */
    abandonUndispatched(operationIdInput: string): Promise<unknown>;
    recoverProviderRequest(operationIdInput: string, providerRequestId: string): Promise<unknown>;
    status(operationIdInput: string): Promise<unknown>;
    receipt(operationIdInput: string): Promise<unknown>;
    inspectReceipt(operation: LocalOperationRecord, rpc: RpcPort): Promise<LocalOperationRecord>;
    private observeReceipt;
    private classifyReceipt;
    requiredOperation(operationId: string): Promise<OperationRecord>;
}
export type LocalOperationRecord = OperationRecord & {
    readonly providerDirect?: never;
    readonly transactionData: Hex;
    readonly economics: Economics;
    readonly preparedBlockNumberAtomic: string;
};
export declare function requiredLocal(operation: OperationRecord): LocalOperationRecord;
