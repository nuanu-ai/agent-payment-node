import type { CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
import { type ProviderSettlementWaitProjection } from "./provider-x402-wait.js";
type PrepareRequest = Extract<CommandRequest, {
    readonly command: "x402.fetch.prepare";
}>;
export declare class ProviderX402Service {
    private readonly context;
    private readonly repository;
    private readonly operations;
    constructor(context: RuntimeContext);
    canHandle(profileInput: string): Promise<boolean>;
    prepare(request: PrepareRequest): Promise<unknown>;
    private completePreparation;
    approve(operationIdInput: string): Promise<unknown>;
    recoverRead(operationIdInput: string): Promise<void>;
    resume(operationIdInput: string, waitSeconds?: number): Promise<ProviderSettlementWaitProjection | undefined>;
    private reconcile;
    private terminalizeSettled;
    private terminalReceipt;
    private recoverOrphanReceipt;
    private withOperationLock;
    private failBeforeEffect;
    private transition;
}
export {};
