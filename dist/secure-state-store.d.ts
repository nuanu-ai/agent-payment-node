import { type Dirent, type Stats } from "node:fs";
import { type AdvisoryLockPort } from "./macos-advisory-lock.js";
export declare function stateSecurity(message: string): never;
export declare function stateCorrupt(message: string): never;
export declare function stateIdentifier(value: string, label: string): void;
export declare function validateDirectory(stats: Stats, root: boolean): void;
export declare function validateFile(stats: Stats): void;
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
    /** Records only: atomic-write stages are never records, and an abandoned stage cannot wedge a listing. */
    protected readDirectory(relativePath: string): Promise<readonly Dirent[]>;
    /** Raw listing that still shows atomic-write stages; only for code that inspects its own in-flight stage. */
    protected readDirectoryWithStagedWrites(relativePath: string): Promise<readonly Dirent[]>;
    /**
     * The read-side boundary: the root (its ancestors proven once per process) and every directory below it down to
     * `target` is a real, owner-only directory. False when one is absent. Writes keep their full atomic-write checks.
     */
    private readableDirectories;
    protected resolveRelative(relativePath: string): string;
    protected assertNoSymlinkAncestors(target: string): Promise<void>;
    /**
     * One protected read: the directory boundary above, then `O_NOFOLLOW`, `fstat` owner/mode/single-link and the size cap
     * on the opened file itself, then strict UTF-8, JSON and canonical-bytes checks of the content.
     */
    protected readJson(relativePath: string): Promise<unknown | null>;
    /** Optional internal assertion seam for specialized create-only stores. */
    protected beforeCreateOnlyPublication(_relativePath: string, _value: unknown): Promise<void>;
    protected writeJson(relativePath: string, value: unknown, createOnly?: boolean): Promise<void>;
    protected removeFile(relativePath: string): Promise<boolean>;
    private acquireLock;
    private validateOpenedLock;
    private releaseLock;
}
