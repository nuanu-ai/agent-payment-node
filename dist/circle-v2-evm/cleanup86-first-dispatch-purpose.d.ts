import { type HeldCleanup85Scope } from "../circle-cleanup85-financial-scope.js";
import type { StateStore } from "../state.js";
import type { Cleanup85CancellationProof } from "../circle-cleanup85-cancellation-contract.js";
import { type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { type CircleOperationV1, type CirclePolicy } from "./operation-model.js";
import type { Cleanup86Intent } from "./cleanup86-store.js";
import type { Cleanup86FirstDispatchBinding } from "./cleanup86-first-dispatch-authority.js";
/** A separate current financial decision. Historical intent/purpose/windows are never renewed. */
export interface Cleanup86FirstDispatchPurpose {
    readonly version: "apn.circle-cleanup86-first-dispatch-purpose.v1";
    readonly action: "first_dispatch_exact_sealed_zero_approval";
    readonly binding: Cleanup86FirstDispatchBinding;
    readonly originalIntentDigest: string;
    readonly originalPurposeDigest: string;
    readonly parentDigest: string;
    readonly parentFingerprint: string;
    readonly custodyDigest: string;
    readonly policies: readonly CirclePolicy[];
    readonly maximumFeeAtomic: "15000000000000";
    readonly frozenFeeUpperAtomic: string;
    readonly nativeUsageAtomic: string;
    readonly capturedAt: string;
    readonly windowEndsAt: string;
    readonly purposeHash: string;
}
export interface VerifiedCleanup86FirstDispatchPurpose {
    readonly kind: "verified-cleanup86-first-dispatch-purpose";
}
/** Called after complete fresh public admission under the same private held financial scope. */
export declare function verifyCleanup86FirstDispatchPurpose(state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, intent: Cleanup86Intent, binding: Cleanup86FirstDispatchBinding, proof: Cleanup85CancellationProof, scope: HeldCleanup85Scope, now: () => number): Promise<VerifiedCleanup86FirstDispatchPurpose>;
export declare function verifiedCleanup86FirstDispatchPurpose(token: VerifiedCleanup86FirstDispatchPurpose, binding: Cleanup86FirstDispatchBinding): Cleanup86FirstDispatchPurpose;
export declare function claimCleanup86FirstDispatchPurpose(token: VerifiedCleanup86FirstDispatchPurpose, binding: Cleanup86FirstDispatchBinding): {
    readonly purpose: Cleanup86FirstDispatchPurpose;
    readonly now: () => number;
};
export declare function assertCleanup86FirstDispatchPermission(token: VerifiedCleanup86FirstDispatchPurpose, binding: Cleanup86FirstDispatchBinding): Promise<void>;
