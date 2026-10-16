import type { CommandRequest } from "./commands.js";
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
    recoverProviderRequest(operationId: string, providerRequestId: string): Promise<unknown>;
    status(operationId: string): Promise<unknown>;
    abandonUndispatched(operationId: string): Promise<unknown>;
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
    private failBeforeEffect;
    private transition;
    private persist;
}
