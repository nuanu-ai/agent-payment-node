import type { RuntimeContext } from "./runtime.js";
export declare class ProviderDirectRequestRecoveryService {
    private readonly context;
    constructor(context: RuntimeContext);
    recover(operationIdInput: string, providerRequestIdInput: string): Promise<unknown>;
    private requiredOperation;
    private persistRecoveredReference;
}
