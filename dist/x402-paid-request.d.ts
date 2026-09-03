import { type X402OperationRecord } from "./x402-state-integrity.js";
import { X402Lifecycle } from "./x402-lifecycle.js";
import type { X402SealedPaymentMaterial } from "./provider-ports.js";
export declare class X402PaidRequest extends X402Lifecycle {
    protected recoverPaymentMaterial(operation: X402OperationRecord): Promise<X402SealedPaymentMaterial | undefined>;
    protected authorizationExpired(operation: X402OperationRecord): boolean;
    protected assertLegacySafeRead(operation: X402OperationRecord): Promise<void>;
    protected withOperationLock(operation: X402OperationRecord, callback: (current: X402OperationRecord) => Promise<unknown>, lockWaitMs?: number): Promise<unknown>;
    protected completeAuthorization(operation: X402OperationRecord, kind: "create" | "get"): Promise<unknown>;
    private providerAuthorization;
    protected sendPaidRequest(operation: X402OperationRecord, purpose: "payment" | "result_recovery", verified: X402SealedPaymentMaterial, terminalizeFromExistingEvidence?: boolean, callerDeadlineMs?: number): Promise<unknown>;
    private delegatedMaterialPort;
    private assertDelegatedPolicy;
    private assertMaterialHashes;
}
