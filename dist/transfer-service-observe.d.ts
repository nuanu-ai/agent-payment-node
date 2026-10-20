import type { Economics, Hex, OperationRecord } from "./model.js";
import type { RpcPort, RpcReceipt } from "./ports.js";
import type { RuntimeContext } from "./runtime.js";
import { ProviderDirectTransferService } from "./provider-direct-transfer.js";
/** Existing lifecycle mutations only; recovery cannot introduce an arbitrary signer. */
export interface TransferObserveLifecycle {
    followUsage<T extends OperationRecord>(operation: T): Promise<T>;
    transition(operation: LocalOperationRecord, state: OperationRecord["state"], terminal: boolean, reason: string, proofClass: string, extra?: Partial<Pick<OperationRecord, "transactionHash" | "rawTransactionHash" | "lastSubmissionAt" | "allowlistLease" | "evmActualFee">>, rpcReceipt?: RpcReceipt): Promise<LocalOperationRecord>;
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
    submitAndInspect(operationInput: LocalOperationRecord, rawTransaction: Hex, publicEffectProven?: boolean): Promise<LocalOperationRecord>;
    private dispatchAndInspect;
    resume(operationIdInput: string, waitSeconds?: number, observeOnly?: true, coinbaseObservationRpc?: string): Promise<unknown>;
    /**
     * No receipt. The shared never-lands rule (R4 exit 2) decides first: a finalized sender nonce past the frozen one while
     * a node indexing the prepared block knows neither the transaction nor a receipt proves another transaction consumed
     * it, so this one can never land. Below that nonce, a hash the RPC does not hold at all is re-sent as the identical
     * signed bytes; at most one copy of them can ever be included, so observing first and re-sending never adds an effect.
     */
    private settleUnlanded;
    /** The persisted signed bytes, read back from encrypted custody and checked against the frozen transfer; never a new signature. */
    private signedRawTransaction;
    /**
     * The owner's exit (R4 exit 3) of a local transfer, after foreground acknowledgement; nothing is signed or sent. A
     * signature APN never dispatched is closed and never sent (its hold released: nothing left the account). A dispatched
     * one that no proof decided (no receipt, never-lands not proven) closes past its approval window with its usage hold
     * still charged, since the transaction may still land; one last receipt read closes it by proof instead when it landed.
     */
    abandonLocal(operationIdInput: string): Promise<unknown>;
    recoverProviderRequest(operationIdInput: string, providerRequestId: string): Promise<unknown>;
    status(operationIdInput: string): Promise<unknown>;
    receipt(operationIdInput: string): Promise<unknown>;
    /** A completed transfer's fee: recorded, or (records written before APN recorded it) its receipt-facts sidecar or one read. */
    private actualFee;
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
