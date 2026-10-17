import { randomInt } from "node:crypto";
import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import type { SecureStateStore } from "../secure-state-store.js";
import { parseRecordPath, type OperationFamilyAdapter } from "./adapter.js";
import { entryOf, OperationIndexReconciler } from "./reconcile.js";
import { operationRegistry, type OperationRegistry } from "./registry.js";
import { OPERATION_INDEX_DIRECTORY, OPERATION_INDEX_LOCK, OperationIndexDamage, OperationIndexStore, type StoredRecordName } from "./store.js";
import { collidingClaims, normalizeClaims, OPERATION_FAMILIES, profileClaim, UNREADABLE_PROVIDER_CLAIM, unreadableFamilyClaim,
  unreadableProfileClaim, type OperationClaim, type OperationIndexEntry, type PrepareIdentity, type WantedClaims } from "./types.js";

/** Same bound as ORPHAN_TEMPORARY_AGE_MS: an admission without a record older than this belongs to a crashed prepare. */
export const ADMISSION_LEASE_MS = 10 * 60_000;
export { OPERATION_INDEX_LOCK } from "./store.js";
const GC_PER_CHECK = 2;
const ACCOUNT_KEY = /^(evm|solana|tron):([^:]+):([^:]+)$/u;

function systemFailure(error: unknown): boolean {
  return !(error instanceof ApnError) && error !== null && typeof error === "object" && "syscall" in error;
}
const idempotencyConflict = (message: string) => new ApnError("APN_IDEMPOTENCY_CONFLICT", message);

/**
 * The operation index over the family journals: O(1) lookup by operation ID and idempotency hash, and one account
 * claim mechanism for every family. The journals stay the only source of truth; this is a derived cache.
 */
export class OperationIndex {
  readonly root: string;
  private readonly store: OperationIndexStore;
  private readonly reconciler: OperationIndexReconciler;

  constructor(private readonly state: SecureStateStore, readonly registry: OperationRegistry = operationRegistry(),
    private readonly now: () => number = () => Date.now()) {
    this.root = state.root;
    this.store = new OperationIndexStore(state.root, { lockWaitMs: state.lockWaitMs });
    this.reconciler = new OperationIndexReconciler(state.root, this.store, registry);
  }

  /** Indexes every record whose name has no entry yet (names-only walk). */
  async reconcile(): Promise<void> { await this.repairing(async () => await this.reconciler.reconcile()); }

  /** The entry for this ID; the record stores are walked (names only) only when there is none yet. */
  async find(operationId: string): Promise<OperationIndexEntry | null> {
    return await this.repairing(async () => await this.store.entry(operationId) ?? await this.afterReconcile(() => this.store.entry(operationId)));
  }

  /** The entry bound to this idempotency hash; a hash bound to two operations is corrupt state. */
  async findByIdempotency(idempotencyHash: string): Promise<OperationIndexEntry | null> {
    return await this.repairing(async () => await this.byIdempotency(idempotencyHash));
  }

  /**
   * Null for a new identity; the existing entry for an exact replay; APN_IDEMPOTENCY_CONFLICT on any mismatch. An
   * identity without an idempotency hash (its operation ID is derived from profile and key) is resolved by its ID.
   */
  async resolvePrepare(identity: PrepareIdentity): Promise<OperationIndexEntry | null> {
    return await this.repairing(async () => {
      const entry = identity.idempotencyHash === null
        ? await this.store.entry(identity.operationId) ?? await this.afterReconcile(() => this.store.entry(identity.operationId))
        : await this.byIdempotency(identity.idempotencyHash);
      if (entry === null) {
        if (await this.store.entry(identity.operationId) !== null) throw idempotencyConflict("Operation ID is already bound to another money operation.");
        return null;
      }
      if (entry.state === "unreadable") {
        throw new ApnError("APN_STATE_CORRUPT", "The operation bound to this idempotency key cannot be read.", { operationId: entry.operationId });
      }
      if (entry.family !== identity.family || entry.profileHash !== identity.profileHash || entry.operationId !== identity.operationId ||
        entry.idempotencyHash !== identity.idempotencyHash || entry.requestHash !== identity.requestHash) {
        throw idempotencyConflict("Idempotency key is already bound to different operation inputs.");
      }
      return entry;
    });
  }

  /** APN_OPERATION_BLOCKED when an unresolved operation holds a colliding claim; the details name the blocker. */
  async assertAvailable(wanted: WantedClaims): Promise<void> {
    await this.repairing(async () => { await this.reconciler.reconcile(); await this.check(wanted); });
  }

  /**
   * Admits a new operation: replay and conflict checks, then the claim is written (as `admitted`) before `work` runs
   * the family's prepare body. On success the entry follows the record; when `work` throws and wrote no record, the
   * admission is removed. A crash leaves `admitted`, which blocks others for at most ADMISSION_LEASE_MS, and an
   * immediate retry of the same identity replaces it at once. The caller holds its family locks; `work` must not call
   * the index for this operation's own claims except through `except`.
   */
  async admit<T>(identity: PrepareIdentity, wanted: WantedClaims, work: () => Promise<T>): Promise<T> {
    const own = { ...wanted, except: identity.operationId };
    await this.repairing(async () => {
      await this.reconciler.reconcile();
      const existing = await this.resolvePrepare(identity);
      if (existing !== null && (existing.state !== "admitted" || await this.loadRecord(existing) !== null)) {
        throw idempotencyConflict("The operation already exists; replay it instead of admitting it again.");
      }
      const admitted = entryOf({ operationId: identity.operationId, family: identity.family, profileHash: identity.profileHash,
        idempotencyHash: identity.idempotencyHash, requestHash: identity.requestHash, recordPath: existing?.recordPath ?? this.recordPathFor(identity),
        // It holds what it wants, its profile and its other names; the quarantine keys it also waits for are never held.
        claims: normalizeClaims([profileClaim(identity.profileHash), ...wanted.claims, ...wanted.holds ?? []]), state: "admitted",
        admittedAt: new Date(this.now()).toISOString() });
      await this.claimUnderLock(own, async () => {
        const hash = identity.idempotencyHash;
        const current = await this.store.entry(identity.operationId);
        if (current !== null && current.state !== "admitted") throw idempotencyConflict("Operation ID is already bound to another money operation.");
        if (hash !== null && !await this.store.putPointer(hash, [identity.operationId], true) &&
          canonicalJson(await this.store.pointer(hash)) !== canonicalJson([identity.operationId])) {
          throw idempotencyConflict("Idempotency key is already bound to different operation inputs.");
        }
        await this.store.putOpen(admitted);
        await this.store.putEntry(admitted);
      });
    });
    let value: T;
    try { value = await work(); }
    catch (error) {
      await this.dropIfRecordless(identity.operationId);
      throw error;
    }
    // A body that returned without writing its record leaves nothing to hold; otherwise the entry follows the record.
    if (!await this.dropIfRecordless(identity.operationId)) await this.repairing(async () => await this.follow(identity.operationId));
    return value;
  }

  private async dropIfRecordless(operationId: string): Promise<boolean> {
    const entry = await this.store.entry(operationId).catch(() => null);
    if (entry?.state !== "admitted" || await this.loadRecord(entry).catch(() => undefined) !== null) return false;
    await this.forget(entry);
    return true;
  }

  /** A claim taken after creation (for example a gasless USDT execution). The adapter must derive it from the record too. */
  async addClaims(operationId: string, wanted: WantedClaims): Promise<void> {
    const own = { ...wanted, except: operationId };
    await this.repairing(async () => {
      await this.reconciler.reconcile();
      await this.claimUnderLock(own, async () => {
        const current = await this.store.entry(operationId);
        if (current === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
        if (current.state !== "active" && current.state !== "admitted") throw new ApnError("APN_OPERATION_BLOCKED", "Only an unresolved operation can take a claim.");
        const next = entryOf({ ...current, claims: normalizeClaims([...current.claims, ...wanted.claims]) });
        await this.store.putOpen(next);
        await this.store.putEntry(next);
      });
    });
  }

  /** Optional fast path after a terminal write: the claims go now instead of at the next check that meets them. */
  async settle(operationId: string): Promise<void> {
    await this.repairing(async () => {
      const entry = await this.store.entry(operationId);
      if (entry !== null) await this.inspect(entry, null);
    });
  }

  /**
   * The owner exit for an unreadable record or an orphaned admission: after TTY consent naming the record path and
   * reason, its claims are dropped. The record file and any ledger reservation stay untouched (the reservation stays
   * charged). A readable record must use its family's own exit.
   */
  async releaseByOwner(operationId: string, consent: OperationAbandonApprovalPort): Promise<OperationIndexEntry> {
    const entry = await this.find(operationId);
    if (entry === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
    const record = await this.loadRecord(entry).catch(error => { if (systemFailure(error)) throw error; return undefined; });
    const name = nameOf(entry), adapter = this.adapter(entry);
    const rederived = record === undefined || record === null || name === null || adapter === undefined ? null
      : await this.reconciler.fromRecord(adapter, name, record);
    const orphan = entry.state === "admitted" && record === null;
    const unreadable = entry.state === "unreadable" && (record === undefined || rederived?.state === "unreadable" ||
      entry.unreadableReason === "duplicate_operation_id");
    if (!orphan && !unreadable) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Only an unreadable record or an orphaned admission is released here; use the operation's own exit.",
        { operationId, state: entry.state });
    }
    const reason = orphan ? "admission without a record" : entry.unreadableReason ?? "record_invalid";
    await consent.approve({ operationId, fingerprint: sha256(canonicalJson(entry)), profile: entry.profileHash ?? "unknown",
      providerId: entry.family, walletAddress: entry.claims.map(claim => claim.key).join(", "), recipient: "unknown",
      amountAtomic: "unknown", amountDecimal: "unknown", chainLabel: "unknown", assetLabel: "unknown", unit: "",
      outcomeNote: `Release the account claims held by ${entry.recordPath} (${reason}). The record file and any ledger reservation stay as they are; the reservation stays charged.` });
    return await this.state.withLocks([OPERATION_INDEX_LOCK], async () => {
      const current = await this.store.entry(operationId);
      if (current === null || canonicalJson(current) !== canonicalJson(entry)) throw new ApnError("APN_STATE_BUSY", "The operation changed while the owner was asked; retry.");
      if (orphan) { await this.forgetLocked(current); return current; }
      // Released stays in open/ without claims, so a later check notices if a widened reader can read the record again.
      const released = entryOf({ ...current, claims: [], state: "released" });
      await this.store.putOpen(released);
      await this.store.putEntry(released);
      return released;
    });
  }

  /** The record behind an entry through its family's reader; null when absent; throws when it is invalid. */
  async loadRecord(entry: OperationIndexEntry): Promise<unknown | null> {
    const adapter = this.adapter(entry);
    return adapter === undefined ? null : await adapter.load(this.root, entry.recordPath);
  }

  adapter(entry: Pick<OperationIndexEntry, "family">): OperationFamilyAdapter | undefined { return this.registry.get(entry.family); }

  private async byIdempotency(idempotencyHash: string): Promise<OperationIndexEntry | null> {
    const ids = await this.store.pointer(idempotencyHash) ?? await this.afterReconcile(() => this.store.pointer(idempotencyHash));
    if (ids === null) return null;
    if (ids.length > 1) throw new ApnError("APN_STATE_CORRUPT", "Idempotency identity is duplicated across operation stores.");
    return await this.store.entry(ids[0]!) ?? await this.afterReconcile(() => this.store.entry(ids[0]!));
  }

  private async afterReconcile<T>(read: () => Promise<T>): Promise<T> { await this.reconciler.reconcile(); return await read(); }

  /**
   * Every claim this admission wants: its own, its profile's quarantine and its family's (every family's when unstated),
   * and the provider quarantine when it wants a provider account.
   */
  private wantedClaims(wanted: WantedClaims): readonly OperationClaim[] {
    const provider = wanted.claims.some(claim => claim.key.startsWith("provider:") || claim.key.startsWith("provider-payer:"));
    return normalizeClaims([...wanted.claims, ...wanted.waits ?? [], ...wanted.profileHash === null ? [] : [unreadableProfileClaim(wanted.profileHash)],
      ...(wanted.family === null ? OPERATION_FAMILIES : [wanted.family]).map(unreadableFamilyClaim), ...provider ? [UNREADABLE_PROVIDER_CLAIM] : []]);
  }

  /** Verifies every colliding open entry against its record; returns those that do not block. */
  private async check(wanted: WantedClaims): Promise<ReadonlySet<string>> {
    const all = { ...wanted, claims: this.wantedClaims(wanted) };
    const open = await this.openEntries();
    const order = [...this.registry.keys()];
    const colliding = open.filter(entry => entry.operationId !== wanted.except && collidingClaims(entry.claims, all.claims).length > 0)
      .sort((left, right) => order.indexOf(left.family) - order.indexOf(right.family) || (left.operationId < right.operationId ? -1 : 1));
    const clear = new Set<string>();
    for (const entry of colliding) {
      const blocked = await this.inspect(entry, all);
      if (blocked !== null) throw blocked;
      clear.add(entry.operationId);
    }
    // Amortized collection: a few other open entries are verified per check, so open/ stays small without settle().
    const others = open.filter(entry => !colliding.includes(entry));
    const start = others.length === 0 ? 0 : randomInt(others.length);
    for (let index = 0; index < Math.min(GC_PER_CHECK, others.length); index += 1) await this.inspect(others[(start + index) % others.length]!, null);
    return clear;
  }

  /** Writes under the leaf lock only when the colliding set did not grow since it was verified (one retry). */
  private async claimUnderLock(wanted: WantedClaims, write: () => Promise<void>): Promise<void> {
    const all = this.wantedClaims(wanted);
    await this.store.ensureLockDirectory();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const clear = await this.check(wanted);
      const done = await this.state.withLocks([OPERATION_INDEX_LOCK], async () => {
        const now = (await this.openEntries()).filter(entry => entry.operationId !== wanted.except && collidingClaims(entry.claims, all).length > 0);
        if (now.some(entry => !clear.has(entry.operationId))) return false;
        await write();
        return true;
      });
      if (done) return;
    }
    throw new ApnError("APN_STATE_BUSY", "Another operation claimed this account concurrently; retry the operation.");
  }

  private async openEntries(): Promise<readonly OperationIndexEntry[]> {
    const entries: OperationIndexEntry[] = [];
    for (const id of await this.store.openIds()) { const entry = await this.store.openEntry(id); if (entry !== null) entries.push(entry); }
    return entries;
  }

  /**
   * Verifies one open entry against its record and keeps the index in step with it. With `wanted`, returns the
   * APN_OPERATION_BLOCKED error when it still blocks that admission; without, it only collects.
   */
  private async inspect(entry: OperationIndexEntry, wanted: WantedClaims | null): Promise<ApnError | null> {
    // One ID in two stores is decided by the names walk alone; no single record can clear it.
    if (entry.unreadableReason === "duplicate_operation_id") return wanted === null ? null : blockedBy(entry, null, collidingClaims(entry.claims, wanted.claims));
    const adapter = this.adapter(entry), name = nameOf(entry);
    let record: unknown;
    try { record = adapter === undefined || name === null ? undefined : await adapter.load(this.root, entry.recordPath); }
    catch (error) {
      if (systemFailure(error)) throw error;
      if (entry.state === "active" || entry.state === "admitted") await this.reconciler.write(await this.reconciler.quarantine(adapter!, name!, "record_invalid"));
      record = undefined;
    }
    if (record === undefined) return wanted === null ? null : blockedBy(entry, null, collidingClaims(entry.claims, wanted.claims));
    if (record === null) {
      if (entry.state === "admitted" && Date.parse(entry.admittedAt!) + ADMISSION_LEASE_MS > this.now()) {
        return wanted === null ? null : blockedBy(entry, "admitted", collidingClaims(entry.claims, wanted.claims));
      }
      await this.forget(entry);
      return null;
    }
    const derived = await this.reconciler.fromRecord(adapter!, name!, record);
    if (derived === null) return null;
    const next = entry.state === "admitted" && derived.state === "active" ? entryOf({ ...derived, claims: [...derived.claims, ...entry.claims] }) : derived;
    if (entry.state !== "active" || derived.state !== "active") await this.reconciler.write(next, true);
    if (wanted === null || derived.state === "terminal") return null;
    if (derived.state === "unreadable") return blockedBy(entry, null, collidingClaims(derived.claims, wanted.claims));
    const blocking = collidingClaims(next.claims, wanted.claims).filter(claim => adapter!.admits?.(record, wanted, claim) !== true);
    return blocking.length === 0 ? null : blockedBy(entry, adapter!.state(record), blocking);
  }

  /** After `work`: the admitted entry becomes the entry its record yields, keeping the admitted claims while unresolved. */
  private async follow(operationId: string): Promise<void> {
    const entry = await this.store.entry(operationId);
    if (entry !== null) await this.inspect(entry, null);
  }

  /** Drops an entry whose record does not exist (a crashed or failed admission), unless it changed meanwhile. */
  private async forget(entry: OperationIndexEntry): Promise<void> {
    await this.state.withLocks([OPERATION_INDEX_LOCK], async () => {
      const current = await this.store.entry(entry.operationId);
      if (current !== null && canonicalJson(current) === canonicalJson(entry)) await this.forgetLocked(current);
    });
  }
  private async forgetLocked(entry: OperationIndexEntry): Promise<void> {
    await this.store.dropOpen(entry.operationId);
    await this.store.dropEntry(entry.operationId);
    if (entry.idempotencyHash !== null && canonicalJson(await this.store.pointer(entry.idempotencyHash)) === canonicalJson([entry.operationId])) {
      await this.store.dropPointer(entry.idempotencyHash);
    }
  }

  private recordPathFor(identity: PrepareIdentity): string {
    const store = this.registry.get(identity.family)?.stores[0];
    if (store === undefined) throw new ApnError("APN_STATE_CORRUPT", "The operation family has no index adapter.");
    return store.perProfile ? `${store.directory}/${identity.profileHash}/${identity.operationId}.json` : `${store.directory}/${identity.operationId}.json`;
  }

  /** A damaged index file is removed and every record re-derived; a second failure names the safe manual rebuild. */
  private async repairing<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (!(error instanceof OperationIndexDamage)) throw error;
      await this.store.removeDamaged();
      await this.reconciler.reconcile(true);
      try { return await action(); }
      catch (again) {
        if (!(again instanceof OperationIndexDamage)) throw again;
        throw new ApnError("APN_STATE_CORRUPT", `The operation index could not repair itself; remove ${this.root}/${OPERATION_INDEX_DIRECTORY} to rebuild it from the records.`);
      }
    }
  }
}

function nameOf(entry: OperationIndexEntry): StoredRecordName | null {
  const parsed = parseRecordPath(entry.recordPath);
  return parsed === null || parsed.operationId !== entry.operationId ? null : { recordPath: entry.recordPath, profileHash: parsed.profileHash, operationId: entry.operationId };
}

/** The same messages and details the store scan reported, plus `blockingReason` for a blocker that cannot be read. */
function blockedBy(entry: OperationIndexEntry, state: string | null, held: readonly OperationClaim[]): ApnError {
  const account = held.map(claim => ACCOUNT_KEY.exec(claim.key)).find(match => match !== null);
  const provider = account === undefined && held.some(claim => claim.key.startsWith("provider") || claim.key === "unreadable-provider");
  return new ApnError("APN_OPERATION_BLOCKED", account !== undefined ? "Another money operation for this network and account is not terminal."
    : provider ? "Another money operation for this provider account is not terminal." : "Another money operation for this profile is not terminal.", {
    blockingOperationId: entry.operationId,
    ...(state === null ? { blockingReason: "blocking_record_unreadable" } : { blockingState: state }),
    ...(account === undefined ? {} : { blockingNetwork: `${account[1]}:${account[2]}`, blockingAccount: account[3] }),
  });
}
