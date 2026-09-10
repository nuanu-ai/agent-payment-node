import { SecureStateStore } from "../secure-state-store.js";
import { type SmartAccountGaslessOperationRecord, type SmartAccountGaslessReceipt } from "./operation-model.js";
import type { SmartAccountGaslessRepositoryPort } from "./ports.js";
export declare class SmartAccountGaslessOperationRepository extends SecureStateStore implements SmartAccountGaslessRepositoryPort {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<SmartAccountGaslessOperationRecord | null>;
    findOperation(operationId: string): Promise<SmartAccountGaslessOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly SmartAccountGaslessOperationRecord[]>;
    listAllOperations(): Promise<readonly SmartAccountGaslessOperationRecord[]>;
    /** Caller holds the existing profile/operation locks, plus global idempotency lock for preparation. */
    writeOperation(input: SmartAccountGaslessOperationRecord): Promise<void>;
    persist(op: SmartAccountGaslessOperationRecord): Promise<void>;
    repairReceipt(input: SmartAccountGaslessOperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<SmartAccountGaslessReceipt>;
    private path;
}
