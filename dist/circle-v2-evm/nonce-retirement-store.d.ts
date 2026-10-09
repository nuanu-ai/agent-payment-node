import { SecureStateStore } from "../secure-state-store.js";
import { type CircleEnvelope, type CircleOperationV1 } from "./operation-model.js";
export interface CircleNonceRetirementIntent {
    readonly version: "apn.circle-nonce-retirement.v1";
    readonly operationId: string;
    readonly binding: string;
    readonly prefix: readonly string[];
    readonly cleanupEnvelope: CircleEnvelope;
    readonly intentHash: string;
}
/** Immutable public identity only. No sealed wire, ciphertext or signing key enters this record. */
export declare function circleRetirementBinding(op: CircleOperationV1): string;
export declare class CircleNonceRetirementStore extends SecureStateStore {
    private path;
    intent(op: CircleOperationV1): Promise<CircleNonceRetirementIntent | null>;
    start(op: CircleOperationV1, cleanupEnvelope: CircleEnvelope): Promise<CircleNonceRetirementIntent>;
    assertOriginalEffectsAvailable(operationId: string): Promise<void>;
    claim(op: CircleOperationV1, boundary: "sign" | "send"): Promise<void>;
    assertClaim(op: CircleOperationV1, boundary: "sign" | "send"): Promise<void>;
    hasClaim(op: CircleOperationV1, boundary: "sign" | "send"): Promise<boolean>;
}
