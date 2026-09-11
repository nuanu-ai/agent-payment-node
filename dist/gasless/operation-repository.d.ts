import { SecureStateStore } from "../secure-state-store.js";
import type { GaslessOperationRecord } from "./operation-model.js";
import { type GaslessReceipt } from "./receipt.js";
export declare class GaslessOperationRepository extends SecureStateStore {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<GaslessOperationRecord | null>;
    findOperation(operationId: string): Promise<GaslessOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly GaslessOperationRecord[]>;
    listAllOperations(): Promise<readonly GaslessOperationRecord[]>;
    writeOperation(op: GaslessOperationRecord): Promise<void>;
    /** Caller holds the same profile/operation locks as all money families. */
    persist(op: GaslessOperationRecord): Promise<void>;
    repairReceipt(op: GaslessOperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<GaslessReceipt>;
    private path;
}
