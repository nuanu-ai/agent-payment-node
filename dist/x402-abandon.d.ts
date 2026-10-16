import { X402Lifecycle } from "./x402-lifecycle.js";
/**
 * Owner exit for a local x402 purchase whose outcome the chain cannot settle for APN. It is offered
 * only after validBefore, when the signed authorization can no longer execute, and never replaces
 * a proof APN already holds. It signs, sends and pays nothing.
 */
export declare class X402AbandonService extends X402Lifecycle {
    abandon(operationIdInput: string): Promise<unknown>;
}
