import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import type { SecureStateStore } from "../secure-state-store.js";
import { type OperationFamilyAdapter } from "./adapter.js";
import { type OperationRegistry } from "./registry.js";
import { type OperationIndexEntry, type PrepareIdentity, type WantedClaims } from "./types.js";
/** Same bound as ORPHAN_TEMPORARY_AGE_MS: an admission without a record older than this belongs to a crashed prepare. */
export declare const ADMISSION_LEASE_MS: number;
/** The one leaf lock: held only around index file operations, always innermost, never around another acquisition. */
export declare const OPERATION_INDEX_LOCK = "operation-index";
/**
 * The operation index over the family journals: O(1) lookup by operation ID and idempotency hash, and one account
 * claim mechanism for every family. The journals stay the only source of truth; this is a derived cache.
 */
export declare class OperationIndex {
    private readonly state;
    readonly registry: OperationRegistry;
    private readonly now;
    readonly root: string;
    private readonly store;
    private readonly reconciler;
    constructor(state: SecureStateStore, registry?: OperationRegistry, now?: () => number);
    /** Indexes every record whose name has no entry yet (names-only walk). */
    reconcile(): Promise<void>;
    /** The entry for this ID; the record stores are walked (names only) only when there is none yet. */
    find(operationId: string): Promise<OperationIndexEntry | null>;
    /** The entry bound to this idempotency hash; a hash bound to two operations is corrupt state. */
    findByIdempotency(idempotencyHash: string): Promise<OperationIndexEntry | null>;
    /** Null for a new identity; the existing entry for an exact replay; APN_IDEMPOTENCY_CONFLICT on any mismatch. */
    resolvePrepare(identity: PrepareIdentity): Promise<OperationIndexEntry | null>;
    /** APN_OPERATION_BLOCKED when an unresolved operation holds a colliding claim; the details name the blocker. */
    assertAvailable(wanted: WantedClaims): Promise<void>;
    /**
     * Admits a new operation: replay and conflict checks, then the claim is written (as `admitted`) before `work` runs
     * the family's prepare body. On success the entry follows the record; when `work` throws and wrote no record, the
     * admission is removed. A crash leaves `admitted`, which blocks others for at most ADMISSION_LEASE_MS, and an
     * immediate retry of the same identity replaces it at once. The caller holds its family locks; `work` must not call
     * the index for this operation's own claims except through `except`.
     */
    admit<T>(identity: PrepareIdentity, wanted: WantedClaims, work: () => Promise<T>): Promise<T>;
    private dropIfRecordless;
    /** A claim taken after creation (for example a gasless USDT execution). The adapter must derive it from the record too. */
    addClaims(operationId: string, wanted: WantedClaims): Promise<void>;
    /** Optional fast path after a terminal write: the claims go now instead of at the next check that meets them. */
    settle(operationId: string): Promise<void>;
    /**
     * The owner exit for an unreadable record or an orphaned admission: after TTY consent naming the record path and
     * reason, its claims are dropped. The record file and any ledger reservation stay untouched (the reservation stays
     * charged). A readable record must use its family's own exit.
     */
    releaseByOwner(operationId: string, consent: OperationAbandonApprovalPort): Promise<OperationIndexEntry>;
    /** The record behind an entry through its family's reader; null when absent; throws when it is invalid. */
    loadRecord(entry: OperationIndexEntry): Promise<unknown | null>;
    adapter(entry: Pick<OperationIndexEntry, "family">): OperationFamilyAdapter | undefined;
    private byIdempotency;
    private afterReconcile;
    /** Every claim this admission wants: its own, its profile's quarantine and its family's (every family's when unstated). */
    private wantedClaims;
    /** Verifies every colliding open entry against its record; returns those that do not block. */
    private check;
    /** Writes under the leaf lock only when the colliding set did not grow since it was verified (one retry). */
    private claimUnderLock;
    private openEntries;
    /**
     * Verifies one open entry against its record and keeps the index in step with it. With `wanted`, returns the
     * APN_OPERATION_BLOCKED error when it still blocks that admission; without, it only collects.
     */
    private inspect;
    /** After `work`: the admitted entry becomes the entry its record yields, keeping the admitted claims while unresolved. */
    private follow;
    /** Drops an entry whose record does not exist (a crashed or failed admission), unless it changed meanwhile. */
    private forget;
    private forgetLocked;
    private recordPathFor;
    /** A damaged index file is removed and every record re-derived; a second failure names the safe manual rebuild. */
    private repairing;
}
