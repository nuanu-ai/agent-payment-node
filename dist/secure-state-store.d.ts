import { type Stats } from "node:fs";
import { type AdvisoryLockPort } from "./macos-advisory-lock.js";
export declare function stateSecurity(message: string): never;
export declare function stateCorrupt(message: string): never;
export declare function stateIdentifier(value: string, label: string): void;
export declare function validateDirectory(stats: Stats, root: boolean): void;
export declare function isCode(error: unknown, code: string): boolean;
export declare class SecureStateStore {
    readonly root: string;
    readonly lockWaitMs: number;
    private readonly lockPort;
    constructor(root: string, options?: {
        lockWaitMs?: number;
        lockPort?: AdvisoryLockPort;
    });
    initialize(): Promise<void>;
    profileHash(profile: string): string;
    operationId(profile: string, idempotencyKey: string): string;
    idempotencyHash(idempotencyKey: string): string;
    withLocks<T>(keys: readonly string[], action: () => Promise<T>, options?: {
        readonly waitMs?: number;
    }): Promise<T>;
    protected beforeLockAcquire(_key: string): Promise<void>;
    protected ensureDirectory(relativePath: string): Promise<void>;
    protected resolveRelative(relativePath: string): string;
    protected assertNoSymlinkAncestors(target: string): Promise<void>;
    protected readJson(relativePath: string): Promise<unknown | null>;
    protected writeJson(relativePath: string, value: unknown): Promise<void>;
    protected removeFile(relativePath: string): Promise<boolean>;
    private acquireLock;
    private validateOpenedLock;
    private releaseLock;
}
