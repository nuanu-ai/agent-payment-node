import { type RailOperationRecord, type RailReceipt } from "./rail-operation-model.js";
import { SecureStateStore } from "./secure-state-store.js";
export declare class RailOperationRepository extends SecureStateStore {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<RailOperationRecord | null>;
    findOperation(operationId: string): Promise<RailOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly RailOperationRecord[]>;
    listAllOperations(): Promise<readonly RailOperationRecord[]>;
    writeOperation(operation: RailOperationRecord): Promise<void>;
    /** The operation is authoritative and is persisted before its derived receipt. */
    persist(operation: RailOperationRecord): Promise<void>;
    repairReceipt(operation: RailOperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<RailReceipt>;
    private path;
}
