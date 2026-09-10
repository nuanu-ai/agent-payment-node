import type { RuntimeContext } from "./runtime.js";
export declare class OperationAbandonService {
    private readonly context;
    private readonly operations;
    private readonly durable;
    constructor(context: RuntimeContext);
    abandon(operationIdInput: string): Promise<unknown>;
}
