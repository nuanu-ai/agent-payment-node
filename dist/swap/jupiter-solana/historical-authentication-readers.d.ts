import { ChainAccountStore } from "../../chain-account-store.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import { StateStore } from "../../state.js";
import { JupiterV1ExecutionBindingStore } from "./v1-effects.js";
import { SavedJupiterV1MaterialStore } from "./v1-material.js";
export declare function historicalAuthenticationRefused(): never;
export declare function existingHistoricalRoot(root: string): Promise<void>;
/** Pure existing-directory checks. A shared guard pins identities across all finite readers and locks. */
export declare class HistoricalDirectoryGuard {
    #private;
    readonly root: string;
    constructor(root: string);
    check(directories?: readonly string[]): Promise<void>;
}
export declare class HistoricalReadState extends StateStore {
    #private;
    constructor(root: string, guard?: HistoricalDirectoryGuard);
    directoryGuard(): HistoricalDirectoryGuard;
    initialize(): Promise<void>;
    protected ensureDirectory(path: string): Promise<void>;
    protected readJson(path: string): Promise<unknown | null>;
    protected readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]>;
    protected writeJson(): Promise<void>;
    protected beforeLockAcquire(): Promise<void>;
    withLocks<T>(keys: readonly string[], action: () => Promise<T>, options?: {
        readonly waitMs?: number;
    }): Promise<T>;
}
export declare class HistoricalMaterialReader extends SavedJupiterV1MaterialStore {
    #private;
    constructor(root: string, guard?: HistoricalDirectoryGuard);
    initialize(): Promise<void>;
    protected initializeStorage(): Promise<void>;
    protected ensureDirectory(path: string): Promise<void>;
    protected readJson(path: string): Promise<unknown | null>;
    protected readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]>;
    protected writeJson(): Promise<void>;
    protected beforeLockAcquire(): Promise<void>;
}
export declare class HistoricalBindingReader extends JupiterV1ExecutionBindingStore {
    #private;
    constructor(root: string, guard?: HistoricalDirectoryGuard);
    initialize(): Promise<void>;
    protected initializeStorage(): Promise<void>;
    protected ensureDirectory(path: string): Promise<void>;
    protected readJson(path: string): Promise<unknown | null>;
    protected readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]>;
    protected writeJson(): Promise<void>;
    protected beforeLockAcquire(): Promise<void>;
}
export declare class HistoricalCustodyReader extends ChainAccountStore {
    #private;
    constructor(root: string, wrapping: WrappingSecretPort, guard?: HistoricalDirectoryGuard);
    initialize(): Promise<void>;
    protected initializeStorage(): Promise<void>;
    protected ensureDirectory(path: string): Promise<void>;
    protected readJson(path: string): Promise<unknown | null>;
    protected readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]>;
    protected writeJson(): Promise<void>;
    protected beforeLockAcquire(): Promise<void>;
}
