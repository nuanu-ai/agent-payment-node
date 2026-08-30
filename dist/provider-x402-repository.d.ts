import { SecureStateStore } from "./secure-state-store.js";
import { type ProviderX402OperationRecord, type ProviderX402ReceiptRecord } from "./provider-x402-model.js";
export declare class ProviderX402Repository extends SecureStateStore {
    private initialized;
    private ready;
    private initializeRoots;
    loadOperation(profileHash: string, operationId: string): Promise<ProviderX402OperationRecord | null>;
    findOperation(operationId: string): Promise<ProviderX402OperationRecord | null>;
    listOperations(profileHash: string): Promise<readonly ProviderX402OperationRecord[]>;
    listAllOperations(): Promise<readonly ProviderX402OperationRecord[]>;
    writeOperation(operation: ProviderX402OperationRecord): Promise<void>;
    loadReceipt(profileHash: string, operationId: string): Promise<ProviderX402ReceiptRecord | null>;
    writeReceipt(profileHash: string, receipt: ProviderX402ReceiptRecord): Promise<void>;
    private profileDirectories;
}
