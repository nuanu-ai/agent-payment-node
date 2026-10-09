import { type CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { type CircleLifecyclePorts } from "./lifecycle.js";
import type { CircleNonceRetirementIntent } from "./nonce-retirement-store.js";
export interface CircleNonceRetirementPorts extends CircleLifecyclePorts {
    assertRetirementMaterial(op: CircleOperationV1): Promise<void>;
    prepareRetirement(op: CircleOperationV1): Promise<CircleNonceRetirementIntent>;
    retirementClaimed(op: CircleOperationV1): Promise<boolean>;
    retirementProof(op: CircleOperationV1, intent: CircleNonceRetirementIntent): Promise<CircleNonceRetirementProof | null>;
}
export declare function assertCircleNonceRetirementCase(op: CircleOperationV1, now: number): void;
export declare function retireCircleNonce(input: CircleOperationV1, ports: CircleNonceRetirementPorts, allowFinancialStart?: boolean): Promise<CircleOperationV1>;
