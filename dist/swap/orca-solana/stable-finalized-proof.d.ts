import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapOperationRecord, type SwapReceiptProof } from "../model.js";
declare const VERSION: "apn.orca-stable-finalized-observation.v1";
export interface OrcaStableFinalizedObservation {
    readonly schemaVersion: typeof VERSION;
    readonly operationId: string;
    readonly ownerProfileHash: string;
    readonly markerHash: string;
    readonly materialDigest: string;
    readonly bindingHash: string;
    readonly claimHash: string;
    readonly accountIdentityHash: string;
    readonly reservationId: string;
    readonly reservedLeaseDigest: string;
    readonly outcome: "succeeded" | "reverted";
    readonly proof: SwapReceiptProof;
    readonly observationHash: string;
}
export declare function sealOrcaStableFinalizedObservation(operation: SwapOperationRecord, bindings: {
    materialDigest: string;
    bindingHash: string;
    claimHash: string;
    accountIdentityHash: string;
}, outcome: "succeeded" | "reverted", proof: SwapReceiptProof): OrcaStableFinalizedObservation;
export declare function validateOrcaStableFinalizedObservation(value: unknown, operation: SwapOperationRecord): OrcaStableFinalizedObservation;
/** Occupancy is authoritative: a malformed or JSON-null file must never be treated as absent. */
export declare class OrcaStableFinalizedObservationStore extends SecureStateStore {
    private initialized;
    load(operation: SwapOperationRecord): Promise<OrcaStableFinalizedObservation | null>;
    save(operation: SwapOperationRecord, value: OrcaStableFinalizedObservation): Promise<OrcaStableFinalizedObservation>;
    private path;
    private ready;
}
export {};
