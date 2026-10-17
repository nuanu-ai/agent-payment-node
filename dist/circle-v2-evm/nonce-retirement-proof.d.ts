import { type Cleanup85RecoveryProof } from "../legacy/circle-cleanup85-retirement-proof.js";
import { type ConsumedBurnRetirementProof, type SealedBurnRetirementProof } from "../legacy/circle-sealed-burn-retirement.js";
import { type CircleOperationV1 } from "./operation-model.js";
export interface CircleNonceRetirementProof {
    readonly cleanup85Recovery?: Cleanup85RecoveryProof;
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
