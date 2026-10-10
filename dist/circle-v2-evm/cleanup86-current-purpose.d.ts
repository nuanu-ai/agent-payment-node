import { type HeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import type { Cleanup85CancellationProof } from "../circle-cleanup85-cancellation-contract.js";
import type { StateStore } from "../state.js";
import { type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { type CircleEnvelope, type CircleOperationV1, type CirclePolicy } from "./operation-model.js";
import { type CircleRpc } from "./rpc.js";
/** Persisted evidence of a new permission decision, never a dispatch capability. */
export interface Cleanup86CurrentPurpose {
    readonly version: "apn.circle-cleanup86-current-purpose.v1";
    readonly rootBinding: string;
    readonly parentOperationId: string;
    readonly parentFingerprint: string;
    readonly recoveryBinding: string;
    readonly recoveryHash: string;
    readonly requestBinding: string;
    readonly cancellationProofHash: string;
    readonly sourceCustodyHash: string;
    readonly envelopeHash: string;
    readonly cleanupReservationId: string;
    readonly cleanupReservationHash: string;
    readonly maximumFeeAtomic: "15000000000000";
    readonly policies: readonly CirclePolicy[];
    readonly capturedAt: string;
    readonly asOfDate: string;
    readonly windowEndsAt: string | null;
    readonly purposeHash: string;
}
export interface VerifiedCleanup86CurrentPurpose {
    readonly kind: "verified-cleanup86-current-purpose";
}
export declare function validateCleanup86CurrentPurpose(value: unknown, stateRoot: string, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Cleanup86CurrentPurpose;
export declare function verifiedCleanup86CurrentPurpose(token: VerifiedCleanup86CurrentPurpose, state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Cleanup86CurrentPurpose;
/** Only canonical F85 plus current owner policies under the real shared lock scope can issue this.
 * Original policy/lease records remain historical; confirm includes their full carry holds once. */
export declare function verifyCleanup86CurrentPurpose(state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, proof: Cleanup85CancellationProof, envelope: CircleEnvelope, source: CircleRpc, destination: CircleRpc, now: () => number, scope: HeldCleanup85Scope, retained?: Cleanup86CurrentPurpose): Promise<VerifiedCleanup86CurrentPurpose>;
/** Policy/custody recheck at every private boundary; canonical public reads stay in preflight. */
export declare function assertCleanup86CurrentPermission(token: VerifiedCleanup86CurrentPurpose, state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Promise<void>;
export declare function claimCleanup86CurrentStart(token: VerifiedCleanup86CurrentPurpose, state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Cleanup86CurrentPurpose;
export declare function claimCleanup86CurrentExecution(token: VerifiedCleanup86CurrentPurpose, state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, envelope: CircleEnvelope): Cleanup86CurrentPurpose;
/** Historical authentication only: later activation/expiry cannot invalidate a recorded86 proof. */
export declare function authenticateCleanup86CurrentHistory(root: string, op: CircleOperationV1, purpose: Cleanup86CurrentPurpose): Promise<void>;
