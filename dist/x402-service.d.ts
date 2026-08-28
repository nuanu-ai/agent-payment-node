import type { CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
import { type X402SettlementWaitProjection } from "./x402-state-integrity.js";
type X402PrepareRequest = Extract<CommandRequest, {
    readonly command: "x402.fetch.prepare";
}>;
type X402ApproveRequest = Extract<CommandRequest, {
    readonly command: "x402.fetch.approve";
}>;
export declare class X402Service {
    private readonly context;
    private readonly operations;
    constructor(context: RuntimeContext);
    prepare(request: X402PrepareRequest): Promise<unknown>;
    approve(request: X402ApproveRequest): Promise<unknown>;
    resume(operationIdInput: string, waitSeconds?: number): Promise<X402SettlementWaitProjection | undefined>;
    private resumeOnce;
    private waitForSettlement;
    private reconcileOnly;
    private recoverPaymentMaterial;
    private authorizationExpired;
    private assertLegacySafeRead;
    private withOperationLock;
    private completeAuthorization;
    private sendPaidRequest;
    private beginPaidAttempt;
    private finishPaidAttempt;
    private markInterruptedPaidAttempt;
    private persistAndLinkResult;
    private recoverOrphanResult;
    private finishReconciledEvidence;
    private recoverOrphanReceipt;
    private commitTerminal;
    private commitTerminalOperation;
    private transition;
}
export {};
