import type { CommandRequest } from "./commands.js";
import type { OperationRecord } from "./model.js";
import type { RuntimeContext } from "./runtime.js";
export declare class TransferService {
    private readonly context;
    private readonly operations;
    private readonly providerDirect;
    private readonly observation;
    private readonly allowlist;
    constructor(context: RuntimeContext);
    prepare(request: Extract<CommandRequest, {
        command: "transfer.prepare";
    }>): Promise<unknown>;
    /** What a caller sees: a 429 as a rate limit, and next actions bound to this invocation's own RPC endpoint. */
    private invocation;
    private prepareOperation;
    prepareCoinbaseGasless(request: Extract<CommandRequest, {
        command: "gasless.transfer.prepare";
    }>): Promise<unknown>;
    approve(operationId: string): Promise<unknown>;
    private approveOperation;
    resume(operationId: string, waitSeconds?: number, observeOnly?: true, coinbaseObservationRpc?: string): Promise<unknown>;
    /** The blocker settle of a dispatched local transfer (direct-transfer-settle.ts): observed once, never dispatched. */
    settleDispatched(operationId: string): Promise<OperationRecord>;
    recoverProviderRequest(operationId: string, providerRequestId: string): Promise<unknown>;
    status(operationId: string): Promise<unknown>;
    abandonLocal(operationId: string): Promise<unknown>;
    receipt(operationId: string): Promise<unknown>;
    private inspectReceipt;
    private requiredOperation;
    private submitAndInspect;
    /** After every approval pre-check and before the native approve-and-sign call; refusals end the operation before effect. */
    private reserveUsage;
    /** The journal owns the effect state; the shared usage ledger follows it forward, idempotently, after each durable write. */
    private followUsage;
    /** Caller holds the profile lock shared by approval and prepare; all local lifecycle writers take it first.
     * Re-read under that lock without nesting another operation lock or changing the established lock order. */
    private retireExpiredDirectTransfers;
    /**
     * The operation stays started after a refused, interrupted or timed-out approval: its reservation is held until
     * resume classifies it, and an approval that Native proved ended before the wallet was opened is closed there.
     * A classified refusal names that one resume; an unclassified fault keeps its own identity.
     */
    private afterFailedApproval;
    private failBeforeEffect;
    private transition;
    private persist;
}
