import { ApnError } from "../errors.js";
import type { OperationFamilyAdapter } from "./adapter.js";
import type { OperationRegistry } from "./registry.js";
import { OperationIndexDamage, type OperationIndexStore, type StoredRecordName } from "./store.js";
import { normalizeClaims, OPERATION_INDEX_ENTRY_SCHEMA, profileClaim, unreadableFamilyClaim, unreadableProfileClaim,
  type OperationClaim, type OperationIndexEntry, type UnreadableReason } from "./types.js";

type Named = { readonly adapter: OperationFamilyAdapter; readonly name: StoredRecordName };

/** A failure of the file system itself (not of the record's content) is never turned into a quarantine. */
function systemFailure(error: unknown): boolean {
  return !(error instanceof ApnError) && error !== null && typeof error === "object" && "syscall" in error;
}

/**
 * Derives index entries from the family journals. Every write is idempotent (same bytes are not rewritten, the
 * idempotency pointer is create-only or a merge) and `entries/` is written last, so a walk can stop at any file and
 * run again, and two processes walking at once converge.
 */
export class OperationIndexReconciler {
  constructor(private readonly root: string, private readonly store: OperationIndexStore, private readonly registry: OperationRegistry) {}

  /**
   * Names only: each adapter store and `entries/` are listed; a record is read only when its name has no entry yet.
   * Terminal records found by one walk (the bulk after an upgrade) are written together through `putTerminal`.
   */
  async reconcile(force = false): Promise<void> {
    const indexed = force ? new Set<string>() : await this.store.entryIds();
    const seen = new Map<string, Named[]>();
    for (const adapter of this.registry.values()) {
      for (const store of adapter.stores) {
        for (const name of await this.store.recordNames(store)) {
          const named = seen.get(name.operationId) ?? [];
          named.push({ adapter, name }); seen.set(name.operationId, named);
        }
      }
    }
    const terminal: OperationIndexEntry[] = [];
    for (const [operationId, named] of seen) {
      if (named.length > 1) { await this.indexDuplicate(operationId, named, force); continue; }
      if (indexed.has(operationId)) continue;
      const entry = await this.derive(named[0]!.adapter, named[0]!.name);
      // A repair (force) keeps the one-file-at-a-time path; it is rare and rewrites files that may already exist.
      if (!force && entry?.state === "terminal") terminal.push(entry); else await this.write(entry, force);
    }
    if (terminal.length > 0) await this.store.putTerminal(terminal, async (hash, id) => await this.bindPointer(hash, id));
  }

  /** The entry a record yields today: claims and terminality from its own reader, or a quarantine when it is unreadable. */
  async derive(adapter: OperationFamilyAdapter, name: StoredRecordName): Promise<OperationIndexEntry | null> {
    let record: unknown;
    try { record = await adapter.load(this.root, name.recordPath); }
    catch (error) {
      if (systemFailure(error)) throw error;
      return await this.quarantine(adapter, name, "record_invalid");
    }
    return record === null ? null : await this.fromRecord(adapter, name, record);
  }

  async fromRecord(adapter: OperationFamilyAdapter, name: StoredRecordName, record: unknown): Promise<OperationIndexEntry | null> {
    const identity = adapter.identity(record);
    if (identity.operationId !== name.operationId || name.profileHash !== null && identity.profileHash !== name.profileHash) {
      return await this.quarantine(adapter, name, "record_invalid");
    }
    let terminal = false, undecided = false;
    // A lifecycle that cannot be decided (a damaged sidecar) keeps the record's claims and reads as unreadable.
    try { terminal = await adapter.terminal(record, this.root); } catch (error) { if (systemFailure(error)) throw error; undecided = true; }
    const held = adapter.claims(record);
    const profile = held === null || adapter.holdsProfile?.(record) !== false ? [profileClaim(identity.profileHash)] : [];
    const claims = terminal ? [] : normalizeClaims([...profile, ...(held ?? [unreadableProfileClaim(identity.profileHash), ...adapter.unknownClaims ?? []])]);
    return entryOf({ operationId: name.operationId, family: adapter.family, profileHash: identity.profileHash,
      idempotencyHash: identity.idempotencyHash, requestHash: identity.requestHash, recordPath: name.recordPath, claims,
      state: terminal ? "terminal" : undecided ? "unreadable" : "active", admittedAt: null,
      ...(undecided ? { unreadableReason: "record_invalid" as const } : {}) });
  }

  /**
   * An unreadable record holds exactly the claims its raw JSON still names canonically: its accounts (and a profile only
   * where the family's own claims name one, as Circle names its destination profile). It can never be advanced, so the
   * account claims are what keeps another signer off its nonces; it does not take its profile from profile-wide work.
   * Unknown accounts quarantine every profile the path or the bytes name (holding those profiles), or the whole family
   * when nothing names a profile.
   */
  async quarantine(adapter: OperationFamilyAdapter, name: StoredRecordName, reason: UnreadableReason): Promise<OperationIndexEntry | null> {
    const raw = await this.store.rawRecord(name.recordPath);
    if (raw === null) return null;
    const salvaged = "value" in raw ? adapter.salvage(raw.value) : null;
    const profiles = name.profileHash !== null ? [name.profileHash] : salvaged?.profileHashes ?? [];
    const claims = salvaged?.claims ?? [...profiles.map(profileClaim),
      ...profiles.length > 0 ? profiles.map(unreadableProfileClaim) : [unreadableFamilyClaim(adapter.family)], ...adapter.unknownClaims ?? []];
    return entryOf({ operationId: name.operationId, family: adapter.family, profileHash: profiles[0] ?? null,
      idempotencyHash: salvaged?.idempotencyHash ?? null, requestHash: null, recordPath: name.recordPath,
      claims: normalizeClaims(claims), state: "unreadable", admittedAt: null,
      unreadableReason: "value" in raw ? reason : raw.unreadable });
  }

  /** Pointer first, then the open copy, then the entry: presence in `entries/` means fully indexed. */
  async write(entry: OperationIndexEntry | null, force = false): Promise<void> {
    if (entry === null) return;
    if (force || entry.state === "unreadable") {
      const existing = await this.store.entry(entry.operationId).catch(error => { if (error instanceof OperationIndexDamage) return null; throw error; });
      // An owner release of a quarantine stays released while the record still cannot be read.
      if (existing?.state === "released" && entry.state === "unreadable") return;
    }
    if (entry.idempotencyHash !== null) await this.bindPointer(entry.idempotencyHash, entry.operationId);
    if (entry.claims.length > 0) await this.store.putOpen(entry); else await this.store.dropOpen(entry.operationId);
    await this.store.putEntry(entry);
  }

  async bindPointer(idempotencyHash: string, operationId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.store.pointer(idempotencyHash);
      if (current?.includes(operationId)) return;
      if (await this.store.putPointer(idempotencyHash, [...current ?? [], operationId], current === null)) return;
    }
    throw new ApnError("APN_STATE_BUSY", "The operation index changed concurrently; retry the operation.");
  }

  /** One operation ID in two places is corrupt state: it answers only as corrupt, and holds what each copy holds. */
  private async indexDuplicate(operationId: string, named: readonly Named[], force: boolean): Promise<void> {
    if (!force && (await this.store.entry(operationId).catch(() => null))?.unreadableReason === "duplicate_operation_id") return;
    const derived = (await Promise.all(named.map(async ({ adapter, name }) => await this.derive(adapter, name))))
      .filter((entry): entry is OperationIndexEntry => entry !== null);
    const first = derived[0];
    if (first === undefined) return;
    for (const entry of derived) if (entry.idempotencyHash !== null) await this.bindPointer(entry.idempotencyHash, operationId);
    await this.write(entryOf({ ...first, idempotencyHash: null, requestHash: null, state: "unreadable", admittedAt: null,
      claims: normalizeClaims(derived.flatMap(entry => entry.claims)), unreadableReason: "duplicate_operation_id" }));
  }
}

/** A canonical entry: no undefined members, claims sorted. */
export function entryOf(input: Omit<OperationIndexEntry, "schemaVersion">): OperationIndexEntry {
  const { unreadableReason, ...rest } = input;
  return { schemaVersion: OPERATION_INDEX_ENTRY_SCHEMA, ...rest, claims: normalizeClaims(rest.claims as readonly OperationClaim[]),
    ...(unreadableReason === undefined ? {} : { unreadableReason }) };
}
