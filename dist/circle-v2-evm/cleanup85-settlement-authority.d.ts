import type { StateStore } from "../state.js";
import type { Cleanup85CancellationProof, Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { type CircleOperationV1 } from "./operation-model.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import type { CircleRpc } from "./rpc.js";
/** Public JSON is evidence, never authority to release held assets. Only this live canonical
 * verifier can issue the private, operation/root/proof-bound one-use settlement capability. */
export interface VerifiedCleanup85Settlement {
    readonly kind: "verified-cleanup85-settlement";
}
export declare function consumeCleanup85Settlement(token: VerifiedCleanup85Settlement, state: StateStore, op: CircleOperationV1, proof: CircleNonceRetirementProof): Promise<{
    readonly operation: CircleOperationV1;
    readonly proof: CircleNonceRetirementProof;
}>;
export declare function verifyCleanup85Settlement(state: StateStore, op: CircleOperationV1, proof: CircleNonceRetirementProof, source: CircleRpc, accounting?: (state: StateStore, request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof) => Promise<void>): Promise<VerifiedCleanup85Settlement>;
