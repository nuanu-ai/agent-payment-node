import { SecureStateStore } from "../secure-state-store.js";
import { type BridgeOperationRecord } from "./operation-model.js";
import { type BridgeReceipt } from "./receipt.js";
export declare class BridgeOperationRepository extends SecureStateStore {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<BridgeOperationRecord | null>;
    findOperation(operationId: string): Promise<BridgeOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly BridgeOperationRecord[]>;
    listAllOperations(): Promise<readonly BridgeOperationRecord[]>;
    writeOperation(op: BridgeOperationRecord): Promise<void>;
    /** Caller holds the same profile/operation locks as every other money service. */
    persist(op: BridgeOperationRecord): Promise<void>;
    repairReceipt(op: BridgeOperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<BridgeReceipt>;
    private path;
}
