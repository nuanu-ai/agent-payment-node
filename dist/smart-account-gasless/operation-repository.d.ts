import { SecureStateStore } from "../secure-state-store.js";
import { type SmartAccountGaslessOperationRecord, type SmartAccountGaslessReceipt } from "./operation-model.js";
import type { SmartAccountGaslessRepositoryPort } from "./ports.js";
export declare class SmartAccountGaslessOperationRepository extends SecureStateStore implements SmartAccountGaslessRepositoryPort {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<SmartAccountGaslessOperationRecord | null>;
    /** Reads only files named by this ID, so another saved operation can never break this lookup. */
    findOperation(operationId: string): Promise<SmartAccountGaslessOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly SmartAccountGaslessOperationRecord[]>;
    listAllOperations(): Promise<readonly SmartAccountGaslessOperationRecord[]>;
    /** Caller holds the existing profile/operation locks, plus global idempotency lock for preparation. */
    writeOperation(input: SmartAccountGaslessOperationRecord): Promise<void>;
    /** The operation is the only record written; its receipt is derived from it on read. */
    persist(op: SmartAccountGaslessOperationRecord): Promise<void>;
    /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
    loadReceipt(profileHash: string, operationId: string): Promise<SmartAccountGaslessReceipt>;
    private path;
}
