import { SecureStateStore } from "../secure-state-store.js";
import { type BridgeOperationRecord } from "./operation-model.js";
import { type BridgeReceipt } from "./receipt.js";
import { type LegacyBridgeOperationRecord, type StoredBridgeOperationRecord } from "./legacy-operation.js";
export declare class BridgeOperationRepository extends SecureStateStore {
    private initialized;
    /** Past 1 MiB a file holds only first proofs and an end it had no reserve for (history-capacity.ts), up to this. */
    protected stateByteLimit(): number;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<BridgeOperationRecord | null>;
    loadStoredOperation(profileHash: string, operationId: string): Promise<StoredBridgeOperationRecord | null>;
    writeOperation(op: BridgeOperationRecord): Promise<void>;
    /** Caller holds the same profile/operation locks as every other money service. Its receipt is derived on read. */
    persist(op: BridgeOperationRecord): Promise<void>;
    /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
    loadReceipt(profileHash: string, operationId: string): Promise<BridgeReceipt>;
    loadLegacyReceipt(op: LegacyBridgeOperationRecord): Promise<Record<string, unknown>>;
    private path;
}
