import { type X402OperationRecord } from "./x402-state-integrity.js";
import { X402Lifecycle } from "./x402-lifecycle.js";
import type { X402SealedPaymentMaterial } from "./provider-ports.js";
export declare class X402PaidRequest extends X402Lifecycle {
    protected recoverPaymentMaterial(operation: X402OperationRecord): Promise<X402SealedPaymentMaterial | undefined>;
    protected authorizationExpired(operation: X402OperationRecord): boolean;
    /**
     * Zero attempts means APN never exposed the signed header. After validBefore the token itself proves
     * that nobody else used it: the nonce still reads unused at a finalized block at or after validBefore.
     * Returns null when the operation is not an expired, never-exposed EIP-3009 authorization or the chain
     * cannot prove non-use yet; a used nonce is then left to settlement reconciliation.
     */
    protected closeExpiredUnexposed(operation: X402OperationRecord): Promise<X402OperationRecord | null>;
    protected assertLegacySafeRead(operation: X402OperationRecord): Promise<void>;
    protected withOperationLock(operation: X402OperationRecord, callback: (current: X402OperationRecord) => Promise<unknown>, lockWaitMs?: number): Promise<unknown>;
    protected completeAuthorization(operation: X402OperationRecord, kind: "create" | "get"): Promise<unknown>;
    private providerAuthorization;
    protected sendPaidRequest(operation: X402OperationRecord, purpose: "payment" | "result_recovery", verified: X402SealedPaymentMaterial, terminalizeFromExistingEvidence?: boolean, callerDeadlineMs?: number): Promise<unknown>;
    private delegatedMaterialPort;
    private assertDelegatedPolicy;
    private assertMaterialHashes;
}
