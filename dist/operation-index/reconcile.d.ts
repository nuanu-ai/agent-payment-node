import type { OperationFamilyAdapter } from "./adapter.js";
import type { OperationRegistry } from "./registry.js";
import { type OperationIndexStore, type StoredRecordName } from "./store.js";
import { type OperationIndexEntry, type UnreadableReason } from "./types.js";
/**
 * Derives index entries from the family journals. Every write is idempotent (same bytes are not rewritten, the
 * idempotency pointer is create-only or a merge) and `entries/` is written last, so a walk can stop at any file and
 * run again, and two processes walking at once converge.
 */
export declare class OperationIndexReconciler {
    private readonly root;
    private readonly store;
    private readonly registry;
    constructor(root: string, store: OperationIndexStore, registry: OperationRegistry);
    /** Names only: each adapter store and `entries/` are listed; a record is read only when its name has no entry yet. */
    reconcile(force?: boolean): Promise<void>;
    /** The entry a record yields today: claims and terminality from its own reader, or a quarantine when it is unreadable. */
    derive(adapter: OperationFamilyAdapter, name: StoredRecordName): Promise<OperationIndexEntry | null>;
    fromRecord(adapter: OperationFamilyAdapter, name: StoredRecordName, record: unknown): Promise<OperationIndexEntry | null>;
    /**
     * An unreadable record keeps the accounts its raw JSON still names canonically. Unknown accounts quarantine every
     * profile the path or the bytes name, or the whole family when nothing names a profile.
     */
    quarantine(adapter: OperationFamilyAdapter, name: StoredRecordName, reason: UnreadableReason): Promise<OperationIndexEntry | null>;
    /** Pointer first, then the open copy, then the entry: presence in `entries/` means fully indexed. */
    write(entry: OperationIndexEntry | null, force?: boolean): Promise<void>;
    bindPointer(idempotencyHash: string, operationId: string): Promise<void>;
    /** One operation ID in two places is corrupt state: it answers only as corrupt, and holds what each copy holds. */
    private indexDuplicate;
}
/** A canonical entry: no undefined members, claims sorted. */
export declare function entryOf(input: Omit<OperationIndexEntry, "schemaVersion">): OperationIndexEntry;
