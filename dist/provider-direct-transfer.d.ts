import type { CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
export declare class ProviderDirectTransferService {
    private readonly context;
    private readonly operations;
    private readonly durable;
    constructor(context: RuntimeContext);
    canHandle(profileInput: string): Promise<boolean>;
    prepare(request: Extract<CommandRequest, {
        command: "transfer.prepare";
    }>): Promise<unknown>;
    prepareCoinbaseGasless(request: Extract<CommandRequest, {
        command: "gasless.transfer.prepare";
    }>): Promise<unknown>;
    approve(operationIdInput: string): Promise<unknown>;
    resume(operationIdInput: string, waitSeconds?: number): Promise<unknown>;
    receipt(operationIdInput: string): Promise<unknown>;
    private assertFrozenPreconditions;
    private requiredAdapter;
    private reobserveProvider;
    private applyExecutionResult;
    private observeCoinbaseGasless;
    private handleExecutionFailure;
    private requiredOperation;
    private failBeforeEffect;
}
