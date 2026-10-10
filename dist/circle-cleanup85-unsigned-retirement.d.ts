import { type HeldCleanup85Scope } from "./circle-cleanup85-financial-scope.js";
import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import { type Cleanup85RecoveryIntent } from "./circle-v2-evm/cleanup85-recovery-store.js";
import { type VerifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import type { CircleOperationV1 } from "./circle-v2-evm/operation-model.js";
import type { CircleRpc } from "./circle-v2-evm/rpc.js";
import type { StateStore } from "./state.js";
export interface VerifiedCleanup85NativeLineage {
    readonly kind: "verified-cleanup85-native-lineage";
}
export interface Cleanup85NativeLineage {
    readonly originalOperationId: string;
    readonly operationId: string;
    readonly namespace: string;
    readonly retirementProofHash: string | null;
    readonly readmission: Cleanup85RecoveryIntent | null;
}
export interface VerifiedCleanup85SuccessorFinancialAdmission {
    readonly kind: "verified-cleanup85-successor-financial-admission";
}
export interface Cleanup85SuccessorFinancialAdmission {
    readonly lineage: Cleanup85NativeLineage;
    readonly readmission: Cleanup85RecoveryIntent;
    readonly originalAdmission: VerifiedCleanup85RecoveryAdmission;
}
export declare function resolveCleanup85NativeLineage(state: StateStore, request: Cleanup85CancellationRequest): Promise<VerifiedCleanup85NativeLineage>;
export declare function verifiedCleanup85NativeLineage(token: VerifiedCleanup85NativeLineage, state: StateStore, request: Cleanup85CancellationRequest): Cleanup85NativeLineage;
/** Revalidates the full canonical original public admission and both current policies. No DTO can issue this token. */
export declare function verifyCleanup85SuccessorFinancialAdmission(state: StateStore, source: CircleRpc, destination: CircleRpc, request: Cleanup85CancellationRequest, now: () => number, scope: HeldCleanup85Scope): Promise<VerifiedCleanup85SuccessorFinancialAdmission>;
export declare function verifiedCleanup85SuccessorFinancialAdmission(token: VerifiedCleanup85SuccessorFinancialAdmission, state: StateStore, request: Cleanup85CancellationRequest): Cleanup85SuccessorFinancialAdmission;
/** A invokes under its complete canonical owner/address/operation and both true policy locks. */
export declare function prepareCleanup85UnsignedRetirement(state: StateStore, source: CircleRpc, destination: CircleRpc, parent: CircleOperationV1, frame: Cleanup85RecoveryIntent, now: () => number, scope: HeldCleanup85Scope): Promise<boolean>;
