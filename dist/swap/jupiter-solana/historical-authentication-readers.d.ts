import { ChainAccountStore } from "../../chain-account-store.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import { StateStore } from "../../state.js";
import { JupiterV1ExecutionBindingStore, type JupiterV1ExecutionBinding, type JupiterV1SendClaim, type JupiterV1SignedMarker } from "./v1-effects.js";
import type { SwapOperationRecord } from "../model.js";
import { SavedJupiterV1MaterialStore } from "./v1-material.js";
export declare function historicalAuthenticationRefused(): never;
export declare function existingHistoricalRoot(root: string): Promise<void>;
/** Pure existing-directory checks. A shared guard pins identities across all finite readers and locks. */
export declare class HistoricalDirectoryGuard {
    #private;
    readonly root: string;
    constructor(root: string);
    /** Read and retain the finite public marker leaf identity across the entire authentication session. */
    signedMarkerSnapshot(op: Pick<SwapOperationRecord, "operationId" | "ownerProfileHash">, marker: JupiterV1SignedMarker): Promise<string>;
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
export type HistoricalRetainedClaimEvidence = {
    readonly kind: "retained_send_claim_present";
    readonly claimHash: string;
    readonly signedMarkerSnapshotHash: string;
} | {
    readonly kind: "retained_send_claim_absent";
    readonly observation: "current_observation";
    readonly submissionHistory: "unknown";
    readonly transactionMayHaveBeenSubmitted: true;
    readonly absenceSnapshotHash: string;
    readonly signedMarkerSnapshotHash: string;
};
export interface HistoricalRetainedEvidence {
    readonly signedMarker: JupiterV1SignedMarker;
    readonly claim: JupiterV1SendClaim | null;
    readonly evidence: HistoricalRetainedClaimEvidence;
}
export declare class HistoricalBindingReader extends JupiterV1ExecutionBindingStore {
    #private;
    constructor(root: string, guard?: HistoricalDirectoryGuard);
    /** Only exact ea25 may authenticate retained signed material while observing an absent claim. */
    retainedEvidence(op: SwapOperationRecord, binding: JupiterV1ExecutionBinding): Promise<HistoricalRetainedEvidence>;
    /** Production issuer only: generated wallets cannot replace this original public file anchor. */
    assertOriginalAbsentSignedMarker(op: SwapOperationRecord, retained: HistoricalRetainedEvidence): Promise<void>;
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
