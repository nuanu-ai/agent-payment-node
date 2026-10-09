import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import type { Cleanup85RecoveryIntent } from "./circle-v2-evm/cleanup85-recovery-store.js";
import type { CircleRpc } from "./circle-v2-evm/rpc.js";
import type { StateStore } from "./state.js";
/** Contract milestone only: all unfinished entry points deliberately fail closed. */
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
}
export declare function resolveCleanup85NativeLineage(_state: StateStore, _request: Cleanup85CancellationRequest): Promise<VerifiedCleanup85NativeLineage>;
export declare function verifiedCleanup85NativeLineage(_token: VerifiedCleanup85NativeLineage, _state: StateStore, _request: Cleanup85CancellationRequest): Cleanup85NativeLineage;
export declare function verifyCleanup85SuccessorFinancialAdmission(_state: StateStore, _source: CircleRpc, _destination: CircleRpc, _request: Cleanup85CancellationRequest, _now: () => number): Promise<VerifiedCleanup85SuccessorFinancialAdmission>;
export declare function verifiedCleanup85SuccessorFinancialAdmission(_token: VerifiedCleanup85SuccessorFinancialAdmission, _state: StateStore, _request: Cleanup85CancellationRequest): Cleanup85SuccessorFinancialAdmission;
