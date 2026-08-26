import type { OperationRecord, ReceiptRecord, WalletRecord } from "./model.js";
export { appendTransition, sealOperation, sealReceipt, sealWallet } from "./state-integrity.js";
export declare class StateStore {
    readonly root: string;
    readonly lockWaitMs: number;
    readonly lockLeaseMs: number;
    readonly hostSerialized: boolean;
    constructor(root: string, options?: {
        lockWaitMs?: number;
        lockLeaseMs?: number;
        hostSerialized?: boolean;
    });
    initialize(): Promise<void>;
    profileHash(profile: string): string;
    operationId(profile: string, idempotencyKey: string): string;
    idempotencyHash(idempotencyKey: string): string;
    loadWallet(profileHash: string): Promise<WalletRecord | null>;
    writeWallet(wallet: WalletRecord): Promise<void>;
    loadOperation(profileHash: string, operationId: string): Promise<OperationRecord | null>;
    findOperation(operationId: string): Promise<OperationRecord | null>;
    writeOperation(operation: OperationRecord): Promise<void>;
    listOperations(profileHash: string): Promise<readonly OperationRecord[]>;
    loadReceipt(profileHash: string, operationId: string): Promise<ReceiptRecord | null>;
    writeReceipt(profileHash: string, receipt: ReceiptRecord): Promise<void>;
    withLocks<T>(keys: readonly string[], action: () => Promise<T>): Promise<T>;
    private ensureDirectory;
    private resolveRelative;
    private assertNoSymlinkAncestors;
    private readJson;
    private writeJson;
    private acquireLock;
    private clearStaleLock;
    protected beforeStaleLockTakeover(_path: string): Promise<void>;
    private releaseLock;
}
