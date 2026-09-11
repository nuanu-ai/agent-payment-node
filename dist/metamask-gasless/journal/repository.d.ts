import { SecureStateStore } from "../../secure-state-store.js";
import { type MetaMaskGaslessOperationRecord, type MetaMaskGaslessReceipt } from "../operation-model.js";
import type { MetaMaskGaslessRepositoryPort } from "../ports.js";
export declare class MetaMaskGaslessOperationRepository extends SecureStateStore implements MetaMaskGaslessRepositoryPort {
    private initialized;
    private ready;
    loadOperation(profileHash: string, operationId: string): Promise<MetaMaskGaslessOperationRecord | null>;
    findOperation(operationId: string): Promise<MetaMaskGaslessOperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly MetaMaskGaslessOperationRecord[]>;
    listAllOperations(): Promise<readonly MetaMaskGaslessOperationRecord[]>;
    writeOperation(operationInput: MetaMaskGaslessOperationRecord): Promise<void>;
    /** Caller holds the shared profile and operation locks. The operation is always authoritative. */
    persist(operation: MetaMaskGaslessOperationRecord): Promise<void>;
    repairReceipt(operationInput: MetaMaskGaslessOperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<MetaMaskGaslessReceipt>;
    private path;
}
