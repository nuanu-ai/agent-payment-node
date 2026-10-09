import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import type { StateStore } from "../state.js";
import { type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { type ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { currentCircleDeployments, type CircleRpc } from "./rpc.js";
import { type CircleOperationV1 } from "./operation-model.js";
/** Detached private verification provenance, never a caller-supplied boolean or persisted authority. */
export interface VerifiedCleanup85RecoveryAdmission {
    readonly kind: "verified-cleanup85-recovery-admission";
}
interface VerifiedBody {
    readonly request: Cleanup85CancellationRequest;
    readonly intent: Cleanup85RecoveryIntent;
    readonly parent: CircleOperationV1;
    readonly evidence: ConsumedBurnEvidence;
    readonly deployments: Readonly<Awaited<ReturnType<typeof currentCircleDeployments>>>;
}
export declare function verifiedCleanup85RecoveryAdmission(token: VerifiedCleanup85RecoveryAdmission, request: Cleanup85CancellationRequest): VerifiedBody;
/** Public-only. B calls under its reacquired Buyer/Default owner+policy locks and uses its own policy/TTY grant.
 * Both RPCs must be real bounded public readers; source archive and Sei deployment pins remain mandatory. */
export declare function verifyCleanup85RecoveryAdmission(state: StateStore, source: CircleRpc, destination: CircleRpc, request: Cleanup85CancellationRequest): Promise<VerifiedCleanup85RecoveryAdmission>;
export {};
