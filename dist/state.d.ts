import { type ProviderProfileRecord } from "./provider-profile.js";
import type { OperationRecord, ReceiptRecord, WalletRecord } from "./model.js";
import { SecureStateStore } from "./secure-state-store.js";
import { type X402OperationRecord, type X402ReceiptRecord, type X402ResultRecord } from "./x402-state-integrity.js";
export { appendTransition, sealOperation, sealReceipt, sealWallet } from "./state-integrity.js";
export declare class StateStore extends SecureStateStore {
    loadWallet(profileHash: string): Promise<WalletRecord | null>;
    loadWalletArtifacts(profile: string, profileHash: string): Promise<{
        readonly stored: WalletRecord | null;
        readonly encrypted: unknown | null;
    }>;
    writeWallet(wallet: WalletRecord): Promise<void>;
    loadProviderProfile(profileHash: string): Promise<ProviderProfileRecord | null>;
    writeProviderProfile(profile: ProviderProfileRecord): Promise<void>;
    loadEncryptedWalletEnvelope(profile: string): Promise<unknown | null>;
    writeEncryptedWalletEnvelope(profile: string, envelope: unknown): Promise<void>;
    loadEncryptedPolicyEnvelope(profile: string): Promise<unknown | null>;
    writeEncryptedPolicyEnvelope(profile: string, envelope: unknown): Promise<void>;
    loadOperation(profileHash: string, operationId: string): Promise<OperationRecord | null>;
    findOperation(operationId: string): Promise<OperationRecord | null>;
    writeOperation(operation: OperationRecord): Promise<void>;
    listOperations(profileHash: string): Promise<readonly OperationRecord[]>;
    listAllOperations(): Promise<readonly OperationRecord[]>;
    loadX402Operation(profileHash: string, operationId: string): Promise<X402OperationRecord | null>;
    findX402Operation(operationId: string): Promise<X402OperationRecord | null>;
    writeX402Operation(operation: X402OperationRecord): Promise<void>;
    listX402Operations(profileHash: string): Promise<readonly X402OperationRecord[]>;
    listAllX402Operations(): Promise<readonly X402OperationRecord[]>;
    loadX402Result(profileHash: string, operationId: string): Promise<X402ResultRecord | null>;
    /** Exact-path crash recovery only; ordinary result readers intentionally hide unlinked artifacts. */
    loadX402RecoveryResult(profileHash: string, operationId: string): Promise<X402ResultRecord | null>;
    findX402Result(operationId: string): Promise<X402ResultRecord | null>;
    writeX402Result(profileHash: string, result: X402ResultRecord): Promise<void>;
    listX402Results(profileHash: string): Promise<readonly X402ResultRecord[]>;
    loadX402Receipt(profileHash: string, operationId: string): Promise<X402ReceiptRecord | null>;
    /** Exact-path crash recovery only; ordinary receipt readers intentionally hide unlinked artifacts. */
    loadX402RecoveryReceipt(profileHash: string, operationId: string): Promise<X402ReceiptRecord | null>;
    findX402Receipt(operationId: string): Promise<X402ReceiptRecord | null>;
    writeX402Receipt(profileHash: string, receipt: X402ReceiptRecord): Promise<void>;
    listX402Receipts(profileHash: string): Promise<readonly X402ReceiptRecord[]>;
    loadReceipt(profileHash: string, operationId: string): Promise<ReceiptRecord | null>;
    writeReceipt(profileHash: string, receipt: ReceiptRecord): Promise<void>;
    private validateX402TerminalGraph;
    private validateX402RecoveryReceiptAuthority;
    private operationProfiles;
}
