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
    /** Caller holds the same profile/operation locks as all money families. Its receipt is derived on read. */
    persist(op: GaslessOperationRecord): Promise<void>;
    /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
    loadReceipt(profileHash: string, operationId: string): Promise<GaslessReceipt>;
    private path;
}
