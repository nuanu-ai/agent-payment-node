import { SecureStateStore } from "../secure-state-store.js";
import { type OperationStore } from "./adapter.js";
import { type OperationIndexEntry } from "./types.js";
export declare const OPERATION_INDEX_DIRECTORY = "operation-index";
/** An index file APN did not write in this shape. The index repairs itself from the records; it never trusts it. */
export declare class OperationIndexDamage extends Error {
}
export interface StoredRecordName {
    readonly recordPath: string;
    readonly profileHash: string | null;
    readonly operationId: string;
}
export type RawRecord = {
    readonly value: unknown;
} | {
    readonly unreadable: "record_not_json";
};
export declare function validateIndexEntry(value: unknown, operationId: string): OperationIndexEntry;
/** File I/O of `operation-index/` through the secure store (0600 files, atomic writes, strict reads). */
export declare class OperationIndexStore extends SecureStateStore {
    private ensured;
    entry(operationId: string): Promise<OperationIndexEntry | null>;
    openEntry(operationId: string): Promise<OperationIndexEntry | null>;
    entryIds(): Promise<ReadonlySet<string>>;
    openIds(): Promise<readonly string[]>;
    /** The operations bound to one idempotency hash; more than one is a duplicated identity. */
    pointer(idempotencyHash: string): Promise<readonly string[] | null>;
    putEntry(entry: OperationIndexEntry): Promise<void>;
    putOpen(entry: OperationIndexEntry): Promise<void>;
    dropEntry(operationId: string): Promise<void>;
    dropOpen(operationId: string): Promise<void>;
    dropPointer(idempotencyHash: string): Promise<void>;
    /** Create-only when absent; an occupied target reports false so the caller can merge with what is there. */
    putPointer(idempotencyHash: string, operationIds: readonly string[], createOnly: boolean): Promise<boolean>;
    /** Removes every index file that does not validate; the caller then re-derives all entries from the records. */
    removeDamaged(): Promise<void>;
    /** Record names of one store, names only. Stage files, `.DS_Store` and other foreign names are not records. */
    recordNames(store: OperationStore): Promise<readonly StoredRecordName[]>;
    /** The record's bytes as JSON for salvage, or why they cannot be read as such. */
    rawRecord(recordPath: string): Promise<RawRecord | null>;
    private readIndex;
    private indexNames;
    /**
     * Writers race only with other index writers deriving the same entry from the same record (reconcile runs lock-free),
     * so a target that appeared or changed meanwhile is re-read and written again only if it still differs.
     */
    private put;
    private drop;
}
