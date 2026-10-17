import { type RailOperationRecord, type RailReceipt } from "./rail-operation-model.js";
import { SecureStateStore } from "./secure-state-store.js";
export declare class RailOperationRepository extends SecureStateStore {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<RailOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly RailOperationRecord[]>;
    writeOperation(operation: RailOperationRecord): Promise<void>;
    /** The operation is the only record written; its receipt is derived from it on read. */
    persist(operation: RailOperationRecord): Promise<void>;
    /**
     * The receipt of the operation's current transition. A receipt file a released version wrote for that transition is
     * returned as written; a file of an earlier transition is history, so the receipt is then derived from the operation.
     */
    loadReceipt(profileHash: string, operationId: string): Promise<RailReceipt>;
    private path;
}
