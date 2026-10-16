import type { Dirent, Stats } from "node:fs";
import { lstat, open, readdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { sha256 } from "./canonical.js";

/**
 * SecureStateStore.writeJson stages every record as `.<12 hex of sha256(target)>.<24 hex nonce>.tmp` in the
 * record's own directory, then renames it over the target (or, create-only, links it and unlinks the stage).
 * A staged name is never a record. A process killed between open and rename/unlink leaves it behind.
 */
const ATOMIC_TEMPORARY_NAME = /^\.[a-f0-9]{12}\.[a-f0-9]{24}\.tmp$/u;

/**
 * A live writer holds its unpublished stage only for one local write, fsync and rename (milliseconds, with no
 * network I/O in between). An unpublished stage older than this belongs to an interrupted writer.
 */
export const ORPHAN_TEMPORARY_AGE_MS = 10 * 60_000;

export function atomicTemporaryPrefix(target: string): string { return `.${sha256(target).slice(0, 12)}.`; }

export function isAtomicTemporaryName(name: string): boolean { return ATOMIC_TEMPORARY_NAME.test(name); }

/**
 * Directory listings return records only. An abandoned unpublished stage (one link, older than
 * ORPHAN_TEMPORARY_AGE_MS, owned by this user) is unlinked; any other staged name is skipped untouched.
 * Unlinking a stage never changes a record: the target still holds its previous committed bytes.
 */
export async function withoutAtomicTemporaries(directory: string, entries: readonly Dirent[], nowMs: number): Promise<readonly Dirent[]> {
  const records: Dirent[] = [];
  for (const entry of entries) {
    if (!isAtomicTemporaryName(entry.name)) { records.push(entry); continue; }
    const path = join(directory, entry.name);
    let info: Stats;
    try { info = await lstat(path); } catch { continue; }
    if (info.isFile() && info.nlink === 1 && info.uid === process.geteuid?.() && nowMs - info.mtimeMs >= ORPHAN_TEMPORARY_AGE_MS) {
      await unlink(path).catch(() => undefined);
    }
  }
  return records;
}

/**
 * A create-only publication links the stage to the target before unlinking the stage. An exit in between leaves
 * the committed target with two links: itself and its own stage in the same directory. Only that exact pair
 * (same device and inode, stage name derived from this target path) is repaired by unlinking the stage.
 * Returns whether the target now has its single link back.
 */
export async function releasePublishedTemporary(target: string, targetInfo: Stats): Promise<boolean> {
  if (!targetInfo.isFile() || targetInfo.nlink !== 2) return false;
  const parent = dirname(target), prefix = atomicTemporaryPrefix(target);
  let released = false;
  for (const name of await readdir(parent)) {
    if (!name.startsWith(prefix) || !isAtomicTemporaryName(name) || name === basename(target)) continue;
    const stage = join(parent, name);
    let info: Stats;
    try { info = await lstat(stage); } catch { continue; }
    if (!info.isFile() || info.dev !== targetInfo.dev || info.ino !== targetInfo.ino) continue;
    try { await unlink(stage); released = true; }
    catch (error) {
      // A concurrent create-only writer finished the same unlink.
      if ((error as { code?: unknown } | null)?.code !== "ENOENT") throw error;
      released = true;
    }
  }
  if (!released) return false;
  const directory = await open(parent, "r");
  try { await directory.sync(); } finally { await directory.close(); }
  return true;
}
