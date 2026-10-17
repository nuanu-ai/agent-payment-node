import { SecureStateStore } from "../secure-state-store.js";
import { type BridgeOperationRecord } from "./operation-model.js";
import { type BridgeReceipt } from "./receipt.js";
import { type LegacyBridgeOperationRecord, type StoredBridgeOperationRecord } from "./legacy-operation.js";
export declare class BridgeOperationRepository extends SecureStateStore {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<BridgeOperationRecord | null>;
    loadStoredOperation(profileHash: string, operationId: string): Promise<StoredBridgeOperationRecord | null>;
    findStoredOperation(operationId: string): Promise<StoredBridgeOperationRecord | null>;
    listStoredOperations(profileHash: string): Promise<readonly StoredBridgeOperationRecord[]>;
    listAllStoredOperations(): Promise<readonly StoredBridgeOperationRecord[]>;
    findOperation(operationId: string): Promise<BridgeOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly BridgeOperationRecord[]>;
    listAllOperations(): Promise<readonly BridgeOperationRecord[]>;
    writeOperation(op: BridgeOperationRecord): Promise<void>;
    /** Caller holds the same profile/operation locks as every other money service. Its receipt is derived on read. */
    persist(op: BridgeOperationRecord): Promise<void>;
    /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
    loadReceipt(profileHash: string, operationId: string): Promise<BridgeReceipt>;
    loadLegacyReceipt(op: LegacyBridgeOperationRecord): Promise<Record<string, unknown>>;
    private path;
}
