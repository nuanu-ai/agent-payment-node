import { SecureStateStore } from "../secure-state-store.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { type CircleExternalFulfillment } from "./external-proof.js";
export declare class CircleExternalStore extends SecureStateStore {
    private paths;
    evidence(proof: CircleExternalFulfillment): Promise<unknown>;
    readClaim(op: CircleOperationV1): Promise<CircleExternalFulfillment | null>;
    /** Public permanent tombstone: a restored owned mint cannot enter consent, estimation or custody. */
    assertOwnedMintAvailable(op: CircleOperationV1): Promise<void>;
    claim(op: CircleOperationV1, proof: CircleExternalFulfillment, evidence: unknown): Promise<void>;
}
