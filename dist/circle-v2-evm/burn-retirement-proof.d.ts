import { type SealedBurnEvidence } from "./burn-retirement-rpc.js";
import { type CircleOperationV1 } from "./operation-model.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
export interface SealedBurnRetirementProof extends SealedBurnEvidence {
    readonly version: "apn.circle-sealed-burn-retirement-proof.v1";
    readonly originalBurnHash: string;
    readonly originalBurnMaterialHash: string;
}
export declare function assertSealedBurnEvidence(e: SealedBurnEvidence, op: CircleOperationV1): void;
export declare function validateSealedBurnProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void;
