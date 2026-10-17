import { SecureStateStore } from "../secure-state-store.js";
import { type FacilitatorOperationRecord } from "./operation-model.js";
import { type FacilitatorReceipt } from "./receipt.js";
export interface FacilitatorGaslessRepositoryPort {
    findOperation(operationId: string): Promise<FacilitatorOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly FacilitatorOperationRecord[]>;
    listAllOperations(): Promise<readonly FacilitatorOperationRecord[]>;
    persist(op: FacilitatorOperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<FacilitatorReceipt>;
}
export declare class FacilitatorGaslessOperationRepository extends SecureStateStore implements FacilitatorGaslessRepositoryPort {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<FacilitatorOperationRecord | null>;
    findOperation(operationId: string): Promise<FacilitatorOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly FacilitatorOperationRecord[]>;
    listAllOperations(): Promise<readonly FacilitatorOperationRecord[]>;
    /** Caller holds the profile/operation locks, plus the global idempotency lock for preparation. */
    writeOperation(input: FacilitatorOperationRecord): Promise<void>;
    /** The operation is the only record written; its receipt is derived from it on read. */
    persist(op: FacilitatorOperationRecord): Promise<void>;
    /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
    loadReceipt(profileHash: string, operationId: string): Promise<FacilitatorReceipt>;
    private path;
}
