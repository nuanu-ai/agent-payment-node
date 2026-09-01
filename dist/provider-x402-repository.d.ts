import { SecureStateStore } from "./secure-state-store.js";
import { type ProviderX402OperationRecord, type ProviderX402ReceiptRecord } from "./provider-x402-model.js";
import { type ProviderX402TransactionReservation } from "./provider-x402-transaction-binding.js";
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
    reserveTransactionRecovery(input: {
        readonly operationId: string;
        readonly profileHash: string;
        readonly transactionHash: `0x${string}`;
        readonly idempotencyDigest: string;
        readonly materialDigest: string;
        readonly createdAt: string;
    }): Promise<ProviderX402TransactionReservation>;
    private profileDirectories;
}
