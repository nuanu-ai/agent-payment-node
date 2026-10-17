import { SecureStateStore } from "../secure-state-store.js";
import { type SwapOperationRecord, type SwapOperationState } from "./model.js";
import { type SwapTransitionEvidence } from "./transitions.js";
export declare class SwapOperationRepository extends SecureStateStore {
    private initialized;
    /**
     * The operation ID is derived from the profile and the idempotency key, so a replay finds its record by ID. A new
     * swap is admitted through the operation index before its record is written (a swap prepare reads no RPC; its quote
     * was read by the quote command): the index refuses an ID bound to any other operation and an account another money
     * operation of any family holds, and the swap holds its source account (and its profile under the state's name) until
     * it is terminal.
     */
    create(operationValue: unknown): Promise<SwapOperationRecord>;
    load(ownerProfileHash: string, operationId: string): Promise<SwapOperationRecord | null>;
    /** Lock-free read of one record (the operation index's reader). */
    read(ownerProfileHash: string, operationId: string): Promise<SwapOperationRecord | null>;
    loadAny(operationId: string): Promise<SwapOperationRecord | null>;
    transition(ownerProfileHash: string, operationId: string, expectedIntegrityHash: string, state: SwapOperationState, evidence: SwapTransitionEvidence, now: Date): Promise<SwapOperationRecord>;
    private readBound;
    private path;
    private ready;
}
