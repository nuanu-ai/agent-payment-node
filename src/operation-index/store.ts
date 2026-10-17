import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicTemporaryPrefix } from "../atomic-write-temporaries.js";
import { canonicalJson, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { isCode, SecureStateStore, stateSecurity, validateDirectory } from "../secure-state-store.js";
import { RECORD_NAME, STATE_HASH, type OperationStore } from "./adapter.js";
import { OPERATION_FAMILIES, OPERATION_INDEX_ENTRY_SCHEMA, type OperationClaim, type OperationIndexEntry } from "./types.js";

export const OPERATION_INDEX_DIRECTORY = "operation-index";
/** The one leaf lock: held only around index file operations, always innermost, never around another acquisition. */
export const OPERATION_INDEX_LOCK = "operation-index";
const ENTRIES = `${OPERATION_INDEX_DIRECTORY}/entries`, OPEN = `${OPERATION_INDEX_DIRECTORY}/open`;
const IDEMPOTENCY = `${OPERATION_INDEX_DIRECTORY}/idempotency`, SHARDS = `${OPERATION_INDEX_DIRECTORY}/terminal-pointers`;
const POINTER_SCHEMA = "apn.operation-index-idempotency.v1", SHARD_SCHEMA = "apn.operation-index-terminal-pointers.v1";
const SHARD_NAME = /^[a-f0-9]$/u;
type Pointers = Readonly<Record<string, readonly string[]>>;
const STATES: readonly unknown[] = ["admitted", "active", "terminal", "unreadable", "released"];
const REASONS: readonly unknown[] = ["record_invalid", "record_not_json", "duplicate_operation_id"];
const ENTRY_KEYS = ["schemaVersion", "operationId", "family", "profileHash", "idempotencyHash", "requestHash", "recordPath",
  "claims", "state", "admittedAt"];

/** An index file APN did not write in this shape. The index repairs itself from the records; it never trusts it. */
export class OperationIndexDamage extends Error {}
const damaged = (): never => { throw new OperationIndexDamage("Operation index file is damaged."); };
const RACES = new Set(["State target appeared during an atomic write.", "State target changed during an atomic write.", "State target is already occupied."]);
const raced = (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_SECURITY" && RACES.has(error.message);

export interface StoredRecordName { readonly recordPath: string; readonly profileHash: string | null; readonly operationId: string }
export type RawRecord = { readonly value: unknown } | { readonly unreadable: "record_not_json" };

const nullableHash = (value: unknown) => value === null || typeof value === "string" && STATE_HASH.test(value);
function validClaim(value: unknown): value is OperationClaim {
  return isPlainRecord(value) && typeof value.key === "string" && value.key.length > 0 && value.key.length <= 256 &&
    Object.keys(value).every(key => key === "key" || key === "shared" && value.shared === true);
}
function operationIds(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(id => typeof id === "string" && STATE_HASH.test(id)) &&
    canonicalJson([...new Set(value)].sort()) === canonicalJson(value);
}
export function validateIndexEntry(value: unknown, operationId: string): OperationIndexEntry {
  if (!isPlainRecord(value)) return damaged();
  const keys = Object.keys(value);
  if (value.schemaVersion !== OPERATION_INDEX_ENTRY_SCHEMA || value.operationId !== operationId || !STATE_HASH.test(operationId) ||
    !(OPERATION_FAMILIES as readonly unknown[]).includes(value.family) || !nullableHash(value.profileHash) ||
    !nullableHash(value.idempotencyHash) || !nullableHash(value.requestHash) || typeof value.recordPath !== "string" ||
    !Array.isArray(value.claims) || !value.claims.every(validClaim) || !STATES.includes(value.state) ||
    !(value.admittedAt === null || typeof value.admittedAt === "string" && new Date(value.admittedAt).toISOString() === value.admittedAt) ||
    (value.state === "admitted") !== (value.admittedAt !== null) ||
    (value.state === "unreadable") !== (value.unreadableReason !== undefined) && value.state !== "released" ||
    value.unreadableReason !== undefined && !REASONS.includes(value.unreadableReason) ||
    !ENTRY_KEYS.every(key => keys.includes(key)) || keys.some(key => !ENTRY_KEYS.includes(key) && key !== "unreadableReason")) damaged();
  return value as unknown as OperationIndexEntry;
}

/** File I/O of `operation-index/` through the secure store (0600 files, atomic writes, strict reads). */
export class OperationIndexStore extends SecureStateStore {
  private ensured = false;
  private lockable = false;

  async entry(operationId: string): Promise<OperationIndexEntry | null> {
    const value = await this.readIndex(`${ENTRIES}/${operationId}.json`);
    return value === null ? null : validateIndexEntry(value, operationId);
  }
  async openEntry(operationId: string): Promise<OperationIndexEntry | null> {
    const value = await this.readIndex(`${OPEN}/${operationId}.json`);
    return value === null ? null : validateIndexEntry(value, operationId);
  }
  async entryIds(): Promise<ReadonlySet<string>> { return new Set(await this.indexNames(ENTRIES)); }
  async openIds(): Promise<readonly string[]> { return await this.indexNames(OPEN); }
  /**
   * The operations bound to one idempotency hash; more than one is a duplicated identity. A pointer file holds every
   * operation of its hash (it is written as the union with the shard); a hash without one is looked up in its shard.
   */
  async pointer(idempotencyHash: string): Promise<readonly string[] | null> {
    const value = await this.readIndex(`${IDEMPOTENCY}/${idempotencyHash}.json`);
    if (value === null) return (await this.shard(idempotencyHash[0]!))[idempotencyHash] ?? null;
    if (!isPlainRecord(value)) return damaged();
    if (value.schemaVersion !== POINTER_SCHEMA || value.idempotencyHash !== idempotencyHash || !operationIds(value.operationIds) ||
      Object.keys(value).length !== 3) damaged();
    return value.operationIds as readonly string[];
  }

  /**
   * The bulk backfill of terminal records, which hold no claims and need only their lookups. Their idempotency
   * pointers are merged into at most 16 shard files, written durably first: that is the commit point. Their entries
   * follow without a flush each. A lost entry is derived again by the next walk; an entry that survives always finds
   * its pointer. A hash that already has its own pointer file keeps using it.
   */
  async putTerminal(entries: readonly OperationIndexEntry[], bindPointer: (idempotencyHash: string, operationId: string) => Promise<void>): Promise<void> {
    const individual = new Set(await this.indexNames(IDEMPOTENCY)), byShard = new Map<string, Map<string, Set<string>>>();
    for (const entry of entries) {
      const hash = entry.idempotencyHash;
      if (hash === null) continue;
      if (individual.has(hash)) { await bindPointer(hash, entry.operationId); continue; }
      const shard = byShard.get(hash[0]!) ?? new Map<string, Set<string>>();
      shard.set(hash, (shard.get(hash) ?? new Set()).add(entry.operationId)); byShard.set(hash[0]!, shard);
    }
    if (byShard.size > 0) {
      await this.ensureLockDirectory();
      await this.withLocks([OPERATION_INDEX_LOCK], async () => {
        for (const [name, added] of [...byShard].sort(([a], [b]) => a < b ? -1 : 1)) {
          const current = await this.shard(name), merged: Record<string, readonly string[]> = { ...current };
          for (const [hash, ids] of added) merged[hash] = [...new Set([...current[hash] ?? [], ...ids])].sort();
          if (canonicalJson(merged) !== canonicalJson(current)) await this.put(`${SHARDS}/${name}.json`, { schemaVersion: SHARD_SCHEMA, shard: name, pointers: merged });
        }
      });
    }
    const open = new Set(await this.indexNames(OPEN));
    await this.ensureIndexDirectories();
    const directory = this.resolveRelative(ENTRIES);
    await this.assertNoSymlinkAncestors(directory);
    const before = await lstat(directory);
    validateDirectory(before, false);
    for (const entry of entries) {
      if (open.has(entry.operationId)) await this.dropOpen(entry.operationId);
      await this.putUnflushed(join(directory, `${entry.operationId}.json`), entry);
    }
    const after = await lstat(directory);
    if (after.dev !== before.dev || after.ino !== before.ino) stateSecurity("State parent changed during an atomic write.");
  }

  async putEntry(entry: OperationIndexEntry): Promise<void> { await this.put(`${ENTRIES}/${entry.operationId}.json`, entry); }
  async putOpen(entry: OperationIndexEntry): Promise<void> { await this.put(`${OPEN}/${entry.operationId}.json`, entry); }
  async dropEntry(operationId: string): Promise<void> { await this.drop(`${ENTRIES}/${operationId}.json`); }
  async dropOpen(operationId: string): Promise<void> { await this.drop(`${OPEN}/${operationId}.json`); }
  async dropPointer(idempotencyHash: string): Promise<void> { await this.drop(`${IDEMPOTENCY}/${idempotencyHash}.json`); }
  /** Create-only when absent; an occupied target reports false so the caller can merge with what is there. */
  async putPointer(idempotencyHash: string, operationIds: readonly string[], createOnly: boolean): Promise<boolean> {
    try {
      await this.put(`${IDEMPOTENCY}/${idempotencyHash}.json`,
        { schemaVersion: POINTER_SCHEMA, idempotencyHash, operationIds: [...new Set(operationIds)].sort() }, createOnly);
      return true;
    } catch (error) {
      if (createOnly && raced(error)) return false;
      throw error;
    }
  }

  /** Removes every index file that does not validate; the caller then re-derives all entries from the records. */
  async removeDamaged(): Promise<void> {
    const check = async (read: () => Promise<unknown>, drop: () => Promise<unknown>) => {
      try { await read(); } catch (error) { if (!(error instanceof OperationIndexDamage)) throw error; await drop(); }
    };
    for (const id of await this.indexNames(ENTRIES)) await check(() => this.entry(id), () => this.dropEntry(id));
    for (const id of await this.indexNames(OPEN)) await check(() => this.openEntry(id), () => this.dropOpen(id));
    for (const hash of await this.indexNames(IDEMPOTENCY)) await check(() => this.pointer(hash), () => this.dropPointer(hash));
    for (const name of (await this.readDirectory(SHARDS)).map(entry => entry.name).filter(name => /^[a-f0-9]\.json$/u.test(name))) {
      await check(() => this.shard(name[0]!), () => this.drop(`${SHARDS}/${name}`));
    }
  }

  /** Record names of one store, names only. Stage files, `.DS_Store` and other foreign names are not records. */
  async recordNames(store: OperationStore): Promise<readonly StoredRecordName[]> {
    const output: StoredRecordName[] = [];
    const files = async (directory: string, profileHash: string | null) => {
      for (const entry of await this.readDirectory(directory)) {
        if (!RECORD_NAME.test(entry.name)) continue;
        if (!entry.isFile()) stateSecurity("An operation record name is not a regular file.");
        output.push({ recordPath: `${directory}/${entry.name}`, profileHash, operationId: entry.name.slice(0, -".json".length) });
      }
    };
    if (!store.perProfile) { await files(store.directory, null); return output; }
    for (const entry of await this.readDirectory(store.directory)) {
      if (!STATE_HASH.test(entry.name)) continue;
      if (!entry.isDirectory()) stateSecurity("An operation profile name is not a real directory.");
      await files(`${store.directory}/${entry.name}`, entry.name);
    }
    return output;
  }
  /** The record's bytes as JSON for salvage, or why they cannot be read as such. */
  async rawRecord(recordPath: string): Promise<RawRecord | null> {
    try {
      const value = await this.readJson(recordPath);
      return value === null ? null : { value };
    } catch (error) {
      if (error instanceof ApnError && (error.code === "APN_STATE_CORRUPT" || error.code === "APN_STATE_SECURITY")) return { unreadable: "record_not_json" };
      throw error;
    }
  }

  private async readIndex(path: string): Promise<unknown | null> {
    try { return await this.readJson(path); }
    catch (error) { if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") damaged(); throw error; }
  }
  private async indexNames(directory: string): Promise<readonly string[]> {
    return (await this.readDirectory(directory)).filter(entry => RECORD_NAME.test(entry.name))
      .map(entry => entry.name.slice(0, -".json".length)).sort();
  }
  /** The leaf lock may be the first lock a state root sees (a walk over released records, a family's first admission). */
  async ensureLockDirectory(): Promise<void> {
    if (this.lockable) return;
    await this.initialize();
    this.lockable = true;
  }
  private async ensureIndexDirectories(): Promise<void> {
    if (this.ensured) return;
    for (const directory of [ENTRIES, OPEN, IDEMPOTENCY, SHARDS]) await this.ensureDirectory(directory);
    this.ensured = true;
  }
  /** One shard of the backfilled terminal pointers (by the first hex digit of the hash); empty when absent. */
  private async shard(name: string): Promise<Pointers> {
    if (!SHARD_NAME.test(name)) damaged();
    const value = await this.readIndex(`${SHARDS}/${name}.json`);
    if (value === null) return {};
    if (!isPlainRecord(value) || value.schemaVersion !== SHARD_SCHEMA || value.shard !== name || Object.keys(value).length !== 3 ||
      !isPlainRecord(value.pointers) || !Object.entries(value.pointers).every(([hash, ids]) =>
        STATE_HASH.test(hash) && hash.startsWith(name) && operationIds(ids))) return damaged();
    return value.pointers as Pointers;
  }
  /** An atomic rename without a flush (see putTerminal): stage name and mode as SecureStateStore.writeJson uses. */
  private async putUnflushed(target: string, value: unknown): Promise<void> {
    const temporary = join(dirname(target), `${atomicTemporaryPrefix(target)}${randomBytes(12).toString("hex")}.tmp`);
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(`${canonicalJson(value)}\n`, { encoding: "utf8" }); }
    catch (error) { await handle.close(); await unlink(temporary).catch(() => undefined); throw error; }
    await handle.close();
    try { await rename(temporary, target); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }
  /**
   * Writers race only with other index writers deriving the same entry from the same record (reconcile runs lock-free),
   * so a target that appeared or changed meanwhile is re-read and written again only if it still differs.
   */
  private async put(path: string, value: unknown, createOnly = false): Promise<void> {
    await this.ensureIndexDirectories();
    for (let attempt = 0; ; attempt += 1) {
      if (!createOnly) {
        // Same bytes are not rewritten, so a converged index keeps its files (and their times) as they are.
        let current: unknown = null;
        try { current = await this.readIndex(path); } catch (error) { if (!(error instanceof OperationIndexDamage)) throw error; }
        if (current !== null && canonicalJson(current) === canonicalJson(value)) return;
      }
      try { await this.writeJson(path, value, createOnly); return; }
      catch (error) { if (createOnly || !raced(error) || attempt >= 2) throw error; }
    }
  }
  private async drop(path: string): Promise<void> {
    try { await this.removeFile(path); } catch (error) { if (!isCode(error, "ENOENT")) throw error; }
  }
}
