import { SecureStateStore } from "../secure-state-store.js";
import { type FacilitatorOperationRecord } from "./operation-model.js";
import { type FacilitatorReceipt } from "./receipt.js";
export interface FacilitatorGaslessRepositoryPort {
    findOperation(operationId: string): Promise<FacilitatorOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly FacilitatorOperationRecord[]>;
    listAllOperations(): Promise<readonly FacilitatorOperationRecord[]>;
    persist(op: FacilitatorOperationRecord): Promise<void>;
    repairReceipt(op: FacilitatorOperationRecord): Promise<void>;
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
    persist(op: FacilitatorOperationRecord): Promise<void>;
    repairReceipt(input: FacilitatorOperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<FacilitatorReceipt>;
    private path;
}
