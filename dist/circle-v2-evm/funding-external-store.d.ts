import { SecureStateStore } from "../secure-state-store.js";
import type { CircleFundingOperationV2 } from "./funding-operation.js";
import { type CircleFundingExternalFulfillment } from "./funding-external-proof.js";
export declare class CircleFundingExternalStore extends SecureStateStore {
    private paths;
    evidence(proof: CircleFundingExternalFulfillment): Promise<unknown>;
    readClaim(op: CircleFundingOperationV2): Promise<CircleFundingExternalFulfillment | null>;
    /** Public permanent tombstone: a restored owned mint cannot enter consent, estimation or custody. */
    assertOwnedMintAvailable(op: CircleFundingOperationV2): Promise<void>;
    claim(op: CircleFundingOperationV2, proof: CircleFundingExternalFulfillment, evidence: unknown): Promise<void>;
}
