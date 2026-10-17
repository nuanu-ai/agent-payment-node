import { randomBytes } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
  type FileHandle,
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { atomicTemporaryPrefix, releasePublishedTemporary, withoutAtomicTemporaries } from "./atomic-write-temporaries.js";
import { MacosAdvisoryLock, type AdvisoryLockPort } from "./macos-advisory-lock.js";

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_STATE_BYTES = 1024 * 1024;
const STATE_IDENTIFIER = /^[a-f0-9]{64}$/u;

function uid(): number {
  const value = process.geteuid?.();
  if (value === undefined) throw new ApnError("APN_STATE_SECURITY", "Effective user identity is unavailable.");
  return value;
}

function permissions(stats: Stats): number {
  return stats.mode & 0o777;
}

export function stateSecurity(message: string): never {
  throw new ApnError("APN_STATE_SECURITY", message);
}

export function stateCorrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}

export function stateIdentifier(value: string, label: string): void {
  if (!STATE_IDENTIFIER.test(value)) stateSecurity(`${label} is not a canonical state identifier.`);
}

export function validateDirectory(stats: Stats, root: boolean): void {
  if (!stats.isDirectory() || stats.isSymbolicLink()) stateSecurity("State directory is not a real directory.");
  if (stats.uid !== uid()) stateSecurity("State directory has the wrong owner.");
  if (root && permissions(stats) !== DIRECTORY_MODE) stateSecurity("State root must have mode 0700.");
  if (!root && (permissions(stats) & 0o077) !== 0) stateSecurity("State directory is accessible by another user.");
}

export function validateFile(stats: Stats): void {
  if (!stats.isFile() || stats.isSymbolicLink()) stateSecurity("State entry is not a regular file.");
  if (stats.uid !== uid()) stateSecurity("State file has the wrong owner.");
  if (permissions(stats) !== FILE_MODE) stateSecurity("State file must have mode 0600.");
  if (stats.nlink !== 1) stateSecurity("State file must have exactly one link.");
}

interface HeldLock {
  readonly handle: FileHandle;
}
export function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

/**
 * Roots whose ancestors were proven free of symbolic links and aliases in this process, with the identity they had.
 * Each read still re-checks the root's own identity, owner and mode; only the walk above it and `realpath` are skipped.
 */
const provenRoots = new Map<string, { readonly dev: number; readonly ino: number }>();

function compareLockKeys(left: string, right: string): number {
  const rank = (key: string): number => key.startsWith("profile:") ? 0 : key.startsWith("operation:") ? 1 : 2;
  return rank(left) - rank(right) || left.localeCompare(right);
}

export class SecureStateStore {
  readonly root: string;
  readonly lockWaitMs: number;
  private readonly lockPort: AdvisoryLockPort;

  constructor(root: string, options: { lockWaitMs?: number; lockPort?: AdvisoryLockPort } = {}) {
    if (!isAbsolute(root) || normalize(root) !== root || resolve(root) !== root) {
      throw new ApnError("APN_STATE_SECURITY", "State root must be a canonical absolute path.");
    }
    this.root = root;
    this.lockWaitMs = options.lockWaitMs ?? 5_000;
    if (!Number.isSafeInteger(this.lockWaitMs) || this.lockWaitMs < 0 || this.lockWaitMs > 60_000) {
      throw new ApnError("APN_STATE_SECURITY", "State lock wait must be between 0 and 60000 milliseconds.");
    }
    this.lockPort = options.lockPort ?? new MacosAdvisoryLock();
  }

  async initialize(): Promise<void> {
    await this.assertNoSymlinkAncestors(this.root);
    try {
      await mkdir(this.root, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
    }
    validateDirectory(await lstat(this.root), true);
    const canonical = await realpath(this.root);
    if (canonical !== this.root) stateSecurity("State root resolves through an alias or symbolic link.");
    for (const name of [
      "profiles", "wallets", "policies", "provider-authorizations", "operations", "receipts",
      "x402-operations", "x402-results", "x402-receipts", "rpc-provider-pacing", "locks",
    ]) {
      await this.ensureDirectory(name);
    }
  }

  profileHash(profile: string): string {
    return sha256(`profile\0${profile}`);
  }

  operationId(profile: string, idempotencyKey: string): string {
    return sha256(`operation\0${profile}\0${idempotencyKey}`);
  }

  idempotencyHash(idempotencyKey: string): string {
    return sha256(`idempotency\0${idempotencyKey}`);
  }

  async withLocks<T>(
    keys: readonly string[],
    action: () => Promise<T>,
    options: { readonly waitMs?: number } = {},
  ): Promise<T> {
    const waitMs = options.waitMs ?? this.lockWaitMs;
    if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 300_000) {
      throw new ApnError("APN_STATE_SECURITY", "State lock wait override must be between 0 and 300000 milliseconds.");
    }
    const strictDeadline = options.waitMs !== undefined;
    const started = Date.now();
    const held: HeldLock[] = [];
    try {
      for (const key of [...new Set(keys)].sort(compareLockKeys)) {
        await this.beforeLockAcquire(key);
        const elapsed = Date.now() - started;
        if (strictDeadline && elapsed >= waitMs) throw busy(waitMs);
        held.push(await this.acquireLock(key, Math.max(0, waitMs - elapsed), strictDeadline, waitMs));
      }
      return await action();
    } finally {
      for (const lock of held.reverse()) await this.releaseLock(lock);
    }
  }

  protected async beforeLockAcquire(_key: string): Promise<void> {}
  protected async ensureDirectory(relativePath: string): Promise<void> {
    const target = this.resolveRelative(relativePath);
    const parent = dirname(target);
    if (target !== this.root && parent !== this.root) {
      const parentRelative = relative(this.root, parent);
      if (parentRelative.length > 0) await this.ensureDirectory(parentRelative);
    }
    await this.assertNoSymlinkAncestors(target);
    try {
      await mkdir(target, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
    }
    validateDirectory(await lstat(target), target === this.root);
  }

  /** Records only: atomic-write stages are never records, and an abandoned stage cannot wedge a listing. */
  protected async readDirectory(relativePath: string): Promise<readonly Dirent[]> {
    const entries = await this.readDirectoryWithStagedWrites(relativePath);
    return await withoutAtomicTemporaries(this.resolveRelative(relativePath), entries, Date.now());
  }

  /**
   * The one record named for this ID across the per-profile directories of `store`, through the family's own `load`.
   * Only that name is read under each profile, so another saved record can never break the lookup.
   */
  protected async findInProfiles<T>(store: string, load: (profileHash: string) => Promise<T | null>, corrupt: () => never): Promise<T | null> {
    let found: T | null = null;
    for (const entry of await this.readDirectory(store)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) corrupt();
      const record = await load(entry.name);
      if (record !== null && found !== null) corrupt();
      found = record ?? found;
    }
    return found;
  }

  /** Raw listing that still shows atomic-write stages; only for code that inspects its own in-flight stage. */
  protected async readDirectoryWithStagedWrites(relativePath: string): Promise<readonly Dirent[]> {
    const target = this.resolveRelative(relativePath);
    if (!await this.readableDirectories(target)) return [];
    try { return await readdir(target, { withFileTypes: true }); }
    catch (error) { if (isCode(error, "ENOENT")) return []; throw error; }
  }

  /**
   * The read-side boundary: the root (its ancestors proven once per process) and every directory below it down to
   * `target` is a real, owner-only directory. False when one is absent. Writes keep their full atomic-write checks.
   */
  private async readableDirectories(target: string): Promise<boolean> {
    let root: Stats;
    try { root = await lstat(this.root); }
    catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
      // An absent root holds no state, but a root configured through an alias is still refused.
      await this.assertNoSymlinkAncestors(this.root);
      return false;
    }
    validateDirectory(root, true);
    const proven = provenRoots.get(this.root);
    if (proven === undefined || proven.dev !== root.dev || proven.ino !== root.ino) {
      await this.assertNoSymlinkAncestors(this.root);
      if (await realpath(this.root) !== this.root) stateSecurity("State root resolves through an alias or symbolic link.");
      provenRoots.set(this.root, { dev: root.dev, ino: root.ino });
    }
    let current = this.root;
    const below = relative(this.root, target);
    for (const component of below === "" ? [] : below.split(sep)) {
      current = join(current, component);
      try { validateDirectory(await lstat(current), false); }
      catch (error) { if (isCode(error, "ENOENT")) return false; throw error; }
    }
    return true;
  }

  protected resolveRelative(relativePath: string): string {
    if (relativePath === "" || isAbsolute(relativePath)) stateSecurity("State path must be relative.");
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(`${this.root}${sep}`)) stateSecurity("State path escapes the state root.");
    return target;
  }

  protected async assertNoSymlinkAncestors(target: string): Promise<void> {
    const rootPath = parse(target).root;
    const components = target.slice(rootPath.length).split(sep).filter(Boolean);
    let current = rootPath;
    for (const component of components) {
      current = join(current, component);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) stateSecurity("State path traverses a symbolic link.");
      } catch (error) {
        if (isCode(error, "ENOENT")) return;
        throw error;
      }
    }
  }

  /**
   * One protected read: the directory boundary above, then `O_NOFOLLOW`, `fstat` owner/mode/single-link and the size cap
   * on the opened file itself, then strict UTF-8, JSON and canonical-bytes checks of the content.
   */
  protected async readJson(relativePath: string): Promise<unknown | null> {
    const target = this.resolveRelative(relativePath);
    if (!await this.readableDirectories(dirname(target))) return null;
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isCode(error, "ENOENT")) return null;
      if (isCode(error, "ELOOP")) stateSecurity("State file is a symbolic link.");
      throw error;
    }
    try {
      let info = await handle.stat();
      if (await releasePublishedTemporary(target, info)) info = await handle.stat();
      validateFile(info);
      if (info.size > MAX_STATE_BYTES) stateCorrupt("State file exceeds the size limit.");
      const bytes = await handle.readFile();
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        stateCorrupt("State file is not strict UTF-8.");
      }
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        stateCorrupt("State file is not valid JSON.");
      }
      // APN writes canonical bytes; anything else (pretty-printing, duplicate keys) is not a record APN wrote. CPU only.
      const canonical = canonicalJson(value);
      if (text !== canonical && text !== `${canonical}\n`) stateCorrupt("State file is not canonical JSON.");
      return value;
    } finally {
      await handle.close();
    }
  }

  /** Optional internal assertion seam for specialized create-only stores. */
  protected async beforeCreateOnlyPublication(_relativePath: string, _value: unknown): Promise<void> {}

  protected async writeJson(relativePath: string, value: unknown, createOnly = false): Promise<void> {
    const target = this.resolveRelative(relativePath);
    const parent = dirname(target);
    const serialized = `${canonicalJson(value)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) stateCorrupt("State file exceeds the size limit.");
    await this.assertNoSymlinkAncestors(target);
    validateDirectory(await lstat(parent), parent === this.root);
    const parentBefore = await stat(parent);
    let targetBefore: Stats | null = null;
    try {
      targetBefore = await lstat(target);
      if (await releasePublishedTemporary(target, targetBefore)) targetBefore = await lstat(target);
      validateFile(targetBefore);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }
    if (createOnly && targetBefore !== null) stateSecurity("State target is already occupied.");
    const temporary = join(parent, `${atomicTemporaryPrefix(target)}${randomBytes(12).toString("hex")}.tmp`);
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      FILE_MODE,
    );
    let writeFailure: unknown;
    try {
      await handle.writeFile(serialized, { encoding: "utf8" });
      await handle.sync();
    } catch (error) {
      writeFailure = error;
    } finally {
      await handle.close();
    }
    if (writeFailure !== undefined) {
      await unlink(temporary).catch(() => undefined);
      throw writeFailure;
    }
    try {
      const parentAfter = await stat(parent);
      if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) {
        stateSecurity("State parent changed during an atomic write.");
      }
      if (targetBefore !== null) {
        const current = await lstat(target);
        if (current.dev !== targetBefore.dev || current.ino !== targetBefore.ino) {
          stateSecurity("State target changed during an atomic write.");
        }
      } else {
        try {
          await lstat(target);
          stateSecurity("State target appeared during an atomic write.");
        } catch (error) {
          if (!isCode(error, "ENOENT")) throw error;
        }
      }
      if (createOnly) {
        // Keep ordinary stores on the original path; only a subclass that
        // supplies a publication assertion adds work at this atomic seam.
        if (this.beforeCreateOnlyPublication !== SecureStateStore.prototype.beforeCreateOnlyPublication) {
          await this.beforeCreateOnlyPublication(relativePath, value);
        }
        try {
          await link(temporary, target);
        } catch (error) {
          if (isCode(error, "EEXIST")) stateSecurity("State target is already occupied.");
          throw error;
        }
        // The target is published. A concurrent reader may already have released this stage's second link.
        await unlink(temporary).catch((error: unknown) => { if (!isCode(error, "ENOENT")) throw error; });
      } else {
        await rename(temporary, target);
      }
      const directory = await open(parent, constants.O_RDONLY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      validateFile(await lstat(target));
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  protected async removeFile(relativePath: string): Promise<boolean> {
    const target = this.resolveRelative(relativePath);
    const parent = dirname(target);
    await this.assertNoSymlinkAncestors(target);
    let parentBefore: Stats;
    try {
      parentBefore = await stat(parent);
    } catch (error) {
      if (isCode(error, "ENOENT")) return false;
      throw error;
    }
    validateDirectory(parentBefore, parent === this.root);
    let handle: FileHandle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isCode(error, "ENOENT")) return false;
      if (isCode(error, "ELOOP")) stateSecurity("State file is a symbolic link.");
      throw error;
    }
    try {
      validateFile(await handle.stat());
      const parentAfter = await stat(parent);
      if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) {
        stateSecurity("State parent changed during a protected delete.");
      }
      await unlink(target);
      const directory = await open(parent, constants.O_RDONLY);
      try { await directory.sync(); }
      finally { await directory.close(); }
      return true;
    } finally {
      await handle.close();
    }
  }

  private async acquireLock(key: string, waitMs: number, strictDeadline: boolean, reportedWaitMs: number): Promise<HeldLock> {
    const lockName = `${sha256(`lock\0${key}`)}.lock`;
    const path = this.resolveRelative(join("locks", lockName));
    const started = Date.now();
    do {
      let handle: FileHandle;
      try {
        handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, FILE_MODE);
      } catch (error) {
        if (isCode(error, "ELOOP")) stateSecurity("State lock file is a symbolic link.");
        throw error;
      }
      try {
        await this.validateOpenedLock(path, handle);
        const elapsed = Date.now() - started;
        if (strictDeadline && elapsed >= waitMs) {
          await handle.close();
          break;
        }
        const attemptTimeoutMs = Math.max(1, Math.min(1_000, waitMs - elapsed || 1));
        if (await this.lockPort.tryAcquire(
          handle.fd,
          strictDeadline ? attemptTimeoutMs : undefined,
          strictDeadline,
        )) {
          await this.validateOpenedLock(path, handle);
          return { handle };
        }
      } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
      }
      await handle.close();
      const elapsed = Date.now() - started;
      if (elapsed >= waitMs) break;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, Math.min(10, waitMs - elapsed)));
    } while (true);
    throw busy(reportedWaitMs);
  }

  private async validateOpenedLock(path: string, handle: FileHandle): Promise<void> {
    const opened = await handle.stat();
    let current: Stats;
    try {
      current = await lstat(path);
    } catch (error) {
      if (isCode(error, "ENOENT")) stateSecurity("State lock file changed while it was open.");
      throw error;
    }
    if (current.dev !== opened.dev || current.ino !== opened.ino) {
      stateSecurity("State lock file changed while it was open.");
    }
    validateFile(opened);
    validateFile(current);
  }

  private async releaseLock(lock: HeldLock): Promise<void> {
    await lock.handle.close();
  }
}

function busy(waitMs: number): ApnError {
  return new ApnError("APN_STATE_BUSY", `State remained busy for ${waitMs} milliseconds; retry the operation.`);
}
