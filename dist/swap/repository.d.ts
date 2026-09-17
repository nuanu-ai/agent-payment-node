import { SecureStateStore } from "../secure-state-store.js";
import { type SwapOperationRecord, type SwapOperationState } from "./model.js";
import { type SwapTransitionEvidence } from "./transitions.js";
export declare class SwapOperationRepository extends SecureStateStore {
    private initialized;
    create(operationValue: unknown): Promise<SwapOperationRecord>;
    load(ownerProfileHash: string, operationId: string): Promise<SwapOperationRecord | null>;
    loadAny(operationId: string): Promise<SwapOperationRecord | null>;
    transition(ownerProfileHash: string, operationId: string, expectedIntegrityHash: string, state: SwapOperationState, evidence: SwapTransitionEvidence, now: Date): Promise<SwapOperationRecord>;
    private findByIdempotency;
    private readBound;
    private path;
    private ready;
}
