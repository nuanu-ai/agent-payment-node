import type { CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
export declare class TransferService {
    private readonly context;
    private readonly operations;
    constructor(context: RuntimeContext);
    prepare(request: Extract<CommandRequest, {
        command: "transfer.prepare";
    }>): Promise<unknown>;
    approve(operationIdInput: string): Promise<unknown>;
    resume(operationIdInput: string): Promise<unknown>;
    status(operationIdInput: string): Promise<unknown>;
    receipt(operationIdInput: string): Promise<unknown>;
    private submitAndInspect;
    private inspectReceipt;
    private proveSuperseding;
    private requiredOperation;
    private failBeforeEffect;
    private transition;
    private persist;
}
