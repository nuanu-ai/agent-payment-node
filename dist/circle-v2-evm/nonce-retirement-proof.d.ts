import { type ConsumedBurnRetirementProof } from "./consumed-burn-proof.js";
import { type SealedBurnRetirementProof } from "./burn-retirement-proof.js";
import { type CircleOperationV1 } from "./operation-model.js";
export interface CircleNonceRetirementProof {
    readonly consumedBurn?: ConsumedBurnRetirementProof;
    readonly sealedBurn?: SealedBurnRetirementProof;
    readonly intentHash: string;
    readonly originalApprovalHash: string;
    readonly originalNonceAtomic: string;
    readonly finalizedNonceAtomic: string;
    readonly finalizedBlockHash: string;
    readonly finalizedBlockNumberAtomic: string;
    readonly cleanupTransactionHash: string;
    readonly actualCleanupFeeAtomic: string;
    readonly proofHash: string;
}
export declare function validateCircleNonceRetirementProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void;
