import { type ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { type CircleOperationV1, type CircleEnvelope } from "./operation-model.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
export interface ConsumedBurnRetirementProof extends ConsumedBurnEvidence {
    readonly version: "apn.circle-consumed-burn-retirement-proof.v1";
    readonly originalBurnHash: string;
    readonly originalBurnMaterialHash: string;
}
export declare function assertConsumedCleanup(op: CircleOperationV1, e: CircleEnvelope): void;
export declare function validateConsumedBurnProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void;
