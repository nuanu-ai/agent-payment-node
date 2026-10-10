import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { SecureStateStore, validateDirectory, validateFile, stateSecurity, stateCorrupt } from "../secure-state-store.js";
import { circleBlocked } from "./operation-model.js";
export interface Cleanup86FileIdentity {
  readonly sha256: string; readonly dev: number; readonly ino: number; readonly uid: number;
  readonly mode: number; readonly nlink: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number;
}
export interface Cleanup86Snapshot {
  readonly rootIdentity: string; readonly directoryIdentity: string;
  readonly entries: Readonly<Record<string, { readonly identity: Cleanup86FileIdentity; readonly value: unknown }>>;
}
function validateProtectedFile(s: Stats): void { validateFile(s); if (s.nlink !== 1) stateSecurity("Cleanup86 protected file has a hardlink alias."); }
function tuple(s: Stats) { return { dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode, nlink: s.nlink, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs }; }
/** Narrow protected negative-evidence read. Uses the same file/directory validators as every
 * state store, plus open-handle/path identity and two complete stable directory snapshots. */
export class Cleanup86SnapshotStore extends SecureStateStore {
  async capture(operationId: string): Promise<Cleanup86Snapshot> {
    const directory = join(this.root, "circle-cleanup85-recovery"), prefix = `${operationId}-cleanup86`;
    const read = async (): Promise<Cleanup86Snapshot> => {
      await this.assertNoSymlinkAncestors(directory);
      const rootBefore = await lstat(this.root), before = await lstat(directory);
      validateDirectory(rootBefore, true); validateDirectory(before, false);
      if (await realpath(this.root) !== this.root) stateSecurity("State root resolves through an alias or symbolic link.");
      const rootNames = (await readdir(this.root)).filter(n => n.startsWith(prefix)).sort();
      if (rootNames.length !== 0) circleBlocked("cleanup86_global_artifact_observe_only");
      const names = (await readdir(directory)).filter(n => n.startsWith(prefix)).sort();
      const entries: Record<string, { identity: Cleanup86FileIdentity; value: unknown }> = {};
      for (const name of names) {
        const path = join(directory, name), handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const opened = await handle.stat(); validateProtectedFile(opened);
          const current = await lstat(path); validateProtectedFile(current);
          if (hashObject(tuple(opened)) !== hashObject(tuple(current))) stateSecurity("Cleanup86 file changed during protected read.");
          if (opened.size > 1024 * 1024) stateCorrupt("State file exceeds the size limit.");
          const bytes = await handle.readFile();
          const after = await handle.stat(), pathAfter = await lstat(path); validateProtectedFile(after); validateProtectedFile(pathAfter);
          if (hashObject(tuple(opened)) !== hashObject(tuple(after)) || hashObject(tuple(opened)) !== hashObject(tuple(pathAfter))) stateSecurity("Cleanup86 file changed during protected read.");
          let text: string, value: unknown;
          try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); value = JSON.parse(text); }
          catch { stateCorrupt("State file is not strict UTF-8 canonical JSON."); }
          if (text !== canonicalJson(value) && text !== `${canonicalJson(value)}\n`) stateCorrupt("State file is not canonical JSON.");
          entries[name] = { identity: { sha256: sha256(bytes), ...tuple(opened) }, value };
        } finally { await handle.close(); }
      }
      const rootAfter = await lstat(this.root), after = await lstat(directory);
      validateDirectory(rootAfter, true); validateDirectory(after, false);
      if (hashObject(tuple(rootBefore)) !== hashObject(tuple(rootAfter)) || hashObject(tuple(before)) !== hashObject(tuple(after)) || await realpath(this.root) !== this.root) stateSecurity("Cleanup86 directory changed during protected read.");
      return { rootIdentity: hashObject({ dev: rootBefore.dev, ino: rootBefore.ino }), directoryIdentity: hashObject({ dev: before.dev, ino: before.ino }), entries };
    };
    const first = await read(), second = await read();
    if (hashObject(first) !== hashObject(second)) circleBlocked("cleanup86_snapshot_drift");
    return second;
  }
}
