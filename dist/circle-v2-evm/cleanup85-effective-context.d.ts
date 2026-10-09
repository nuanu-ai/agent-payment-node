import { type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { type CircleOperationV1 } from "./operation-model.js";
import type { StateStore } from "../state.js";
export interface VerifiedCleanup86RecoveryContext {
    readonly kind: "verified-cleanup86-recovery-context";
}
export interface Cleanup86RecoveryContext {
    readonly original: Cleanup85RecoveryIntent;
    readonly readmission: Cleanup85RecoveryIntent;
    readonly retirementProofHash: string | null;
    readonly readmissionHash: string;
}
export declare function verifyCleanup86RecoveryContext(state: StateStore, op: CircleOperationV1, original: Cleanup85RecoveryIntent): Promise<VerifiedCleanup86RecoveryContext>;
export declare function verifiedCleanup86RecoveryContext(token: VerifiedCleanup86RecoveryContext, state: StateStore, op: CircleOperationV1, original: Cleanup85RecoveryIntent): Cleanup86RecoveryContext;
