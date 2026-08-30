import type { CommandRequest } from "./commands.js";
import type { RuntimeContext } from "./runtime.js";
import { type X402SettlementWaitProjection } from "./x402-state-integrity.js";
type X402PrepareRequest = Extract<CommandRequest, {
    readonly command: "x402.fetch.prepare";
}>;
type X402ApproveRequest = Extract<CommandRequest, {
    readonly command: "x402.fetch.approve";
}>;
import { X402PaidRequest } from "./x402-paid-request.js";
export declare class X402Service extends X402PaidRequest {
    private readonly providerX402;
    constructor(context: RuntimeContext);
    prepare(request: X402PrepareRequest): Promise<unknown>;
    approve(request: X402ApproveRequest): Promise<unknown>;
    resume(operationIdInput: string, waitSeconds?: number): Promise<X402SettlementWaitProjection | undefined>;
    recoverRead(operationIdInput: string): Promise<void>;
    private resumeOnce;
    private waitForSettlement;
    private reconcileOnly;
}
export {};
