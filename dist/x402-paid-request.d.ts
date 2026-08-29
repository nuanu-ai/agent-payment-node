import { type X402OperationRecord } from "./x402-state-integrity.js";
import { type VerifiedX402PaymentMaterial } from "./x402-native.js";
import { X402Lifecycle } from "./x402-lifecycle.js";
export declare class X402PaidRequest extends X402Lifecycle {
    protected recoverPaymentMaterial(operation: X402OperationRecord): Promise<VerifiedX402PaymentMaterial | undefined>;
    protected authorizationExpired(operation: X402OperationRecord): boolean;
    protected assertLegacySafeRead(operation: X402OperationRecord): Promise<void>;
    protected withOperationLock(operation: X402OperationRecord, callback: (current: X402OperationRecord) => Promise<unknown>): Promise<unknown>;
    protected completeAuthorization(operation: X402OperationRecord, kind: "create" | "get"): Promise<unknown>;
    protected sendPaidRequest(operation: X402OperationRecord, purpose: "payment" | "result_recovery", verified: VerifiedX402PaymentMaterial, terminalizeFromExistingEvidence?: boolean): Promise<unknown>;
}
