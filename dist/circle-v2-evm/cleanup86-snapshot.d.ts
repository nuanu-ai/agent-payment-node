import { SecureStateStore } from "../secure-state-store.js";
export interface Cleanup86FileIdentity {
    readonly sha256: string;
    readonly dev: number;
    readonly ino: number;
    readonly uid: number;
    readonly mode: number;
    readonly nlink: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
}
export interface Cleanup86Snapshot {
    readonly rootIdentity: string;
    readonly directoryIdentity: string;
    readonly entries: Readonly<Record<string, {
        readonly identity: Cleanup86FileIdentity;
        readonly value: unknown;
    }>>;
}
/** Narrow protected negative-evidence read. Uses the same file/directory validators as every
 * state store, plus open-handle/path identity and two complete stable directory snapshots. */
export declare class Cleanup86SnapshotStore extends SecureStateStore {
    capture(operationId: string): Promise<Cleanup86Snapshot>;
}
