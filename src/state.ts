import { randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { canonicalJson, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type {
  OperationRecord,
  ReceiptRecord,
  WalletRecord,
} from "./model.js";
import { validateOperation, validateReceipt, validateWallet } from "./state-integrity.js";

export { appendTransition, sealOperation, sealReceipt, sealWallet } from "./state-integrity.js";

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_STATE_BYTES = 1024 * 1024;

function uid(): number {
  const value = process.geteuid?.();
  if (value === undefined) throw new ApnError("APN_STATE_SECURITY", "Effective user identity is unavailable.");
  return value;
}

function permissions(stats: Stats): number {
  return stats.mode & 0o777;
}

function stateSecurity(message: string): never {
  throw new ApnError("APN_STATE_SECURITY", message);
}

function stateCorrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}

function validateDirectory(stats: Stats, root: boolean): void {
  if (!stats.isDirectory() || stats.isSymbolicLink()) stateSecurity("State directory is not a real directory.");
  if (stats.uid !== uid()) stateSecurity("State directory has the wrong owner.");
  if (root && permissions(stats) !== DIRECTORY_MODE) stateSecurity("State root must have mode 0700.");
  if (!root && (permissions(stats) & 0o077) !== 0) stateSecurity("State directory is accessible by another user.");
}

function validateFile(stats: Stats): void {
  if (!stats.isFile() || stats.isSymbolicLink()) stateSecurity("State entry is not a regular file.");
  if (stats.uid !== uid()) stateSecurity("State file has the wrong owner.");
  if (permissions(stats) !== FILE_MODE) stateSecurity("State file must have mode 0600.");
  if (stats.nlink !== 1) stateSecurity("State file must have exactly one link.");
}

interface HeldLock {
  readonly path: string;
  readonly token: string;
}

export class StateStore {
  readonly root: string;
  readonly lockWaitMs: number;
  readonly lockLeaseMs: number;
  readonly hostSerialized: boolean;

  constructor(root: string, options: { lockWaitMs?: number; lockLeaseMs?: number; hostSerialized?: boolean } = {}) {
    if (!isAbsolute(root) || normalize(root) !== root || resolve(root) !== root) {
      throw new ApnError("APN_STATE_SECURITY", "State root must be a canonical absolute path.");
    }
    this.root = root;
    this.lockWaitMs = options.lockWaitMs ?? 5_000;
    this.lockLeaseMs = options.lockLeaseMs ?? 30_000;
    this.hostSerialized = options.hostSerialized ?? false;
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
    for (const name of ["wallets", "operations", "receipts", "locks"]) await this.ensureDirectory(name);
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

  async loadWallet(profileHash: string): Promise<WalletRecord | null> {
    const value = await this.readJson(join("wallets", profileHash, "wallet.json"));
    return value === null ? null : validateWallet(value);
  }

  async writeWallet(wallet: WalletRecord): Promise<void> {
    await this.ensureDirectory(join("wallets", wallet.profileHash));
    await this.writeJson(join("wallets", wallet.profileHash, "wallet.json"), wallet);
  }

  async loadOperation(profileHash: string, operationId: string): Promise<OperationRecord | null> {
    const value = await this.readJson(join("operations", profileHash, `${operationId}.json`));
    return value === null ? null : validateOperation(value);
  }

  async findOperation(operationId: string): Promise<OperationRecord | null> {
    const operationsRoot = this.resolveRelative("operations");
    const entries = await readdir(operationsRoot, { withFileTypes: true });
    let found: OperationRecord | null = null;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) {
        stateSecurity("Operations root contains an unsafe profile entry.");
      }
      const candidate = await this.loadOperation(entry.name, operationId);
      if (candidate !== null) {
        if (found !== null) stateCorrupt("Operation ID is duplicated across profiles.");
        found = candidate;
      }
    }
    return found;
  }

  async writeOperation(operation: OperationRecord): Promise<void> {
    await this.ensureDirectory(join("operations", operation.profileHash));
    await this.writeJson(join("operations", operation.profileHash, `${operation.operationId}.json`), operation);
  }

  async listOperations(profileHash: string): Promise<readonly OperationRecord[]> {
    const directory = join("operations", profileHash);
    await this.ensureDirectory(directory);
    const entries = await readdir(this.resolveRelative(directory), { withFileTypes: true });
    const operations: OperationRecord[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        stateSecurity("Operations directory contains an unsafe entry.");
      }
      const value = await this.readJson(join(directory, entry.name));
      if (value === null) stateCorrupt("Operation disappeared during validation.");
      operations.push(validateOperation(value));
    }
    return operations;
  }

  async loadReceipt(profileHash: string, operationId: string): Promise<ReceiptRecord | null> {
    const value = await this.readJson(join("receipts", profileHash, `${operationId}.json`));
    return value === null ? null : validateReceipt(value);
  }

  async writeReceipt(profileHash: string, receipt: ReceiptRecord): Promise<void> {
    await this.ensureDirectory(join("receipts", profileHash));
    await this.writeJson(join("receipts", profileHash, `${receipt.operationId}.json`), receipt);
  }

  async withLocks<T>(keys: readonly string[], action: () => Promise<T>): Promise<T> {
    const held: HeldLock[] = [];
    try {
      for (const key of [...new Set(keys)].sort()) held.push(await this.acquireLock(key));
      return await action();
    } finally {
      for (const lock of held.reverse()) await this.releaseLock(lock);
    }
  }

  private async ensureDirectory(relativePath: string): Promise<void> {
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

  private resolveRelative(relativePath: string): string {
    if (relativePath === "" || isAbsolute(relativePath)) stateSecurity("State path must be relative.");
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(`${this.root}${sep}`)) stateSecurity("State path escapes the state root.");
    return target;
  }

  private async assertNoSymlinkAncestors(target: string): Promise<void> {
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

  private async readJson(relativePath: string): Promise<unknown | null> {
    const target = this.resolveRelative(relativePath);
    const parent = dirname(target);
    await this.assertNoSymlinkAncestors(target);
    let parentBefore: Stats;
    try {
      parentBefore = await stat(parent);
    } catch (error) {
      if (isCode(error, "ENOENT")) return null;
      throw error;
    }
    validateDirectory(parentBefore, parent === this.root);
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isCode(error, "ENOENT")) return null;
      if (isCode(error, "ELOOP")) stateSecurity("State file is a symbolic link.");
      throw error;
    }
    try {
      const info = await handle.stat();
      validateFile(info);
      const parentAfter = await stat(parent);
      if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) {
        stateSecurity("State parent changed during a protected read.");
      }
      if (info.size > MAX_STATE_BYTES) stateCorrupt("State file exceeds the size limit.");
      const text = await handle.readFile({ encoding: "utf8" });
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        stateCorrupt("State file is not valid JSON.");
      }
      return value;
    } finally {
      await handle.close();
    }
  }

  private async writeJson(relativePath: string, value: unknown): Promise<void> {
    const target = this.resolveRelative(relativePath);
    const parent = dirname(target);
    await this.assertNoSymlinkAncestors(target);
    validateDirectory(await lstat(parent), parent === this.root);
    const parentBefore = await stat(parent);
    let targetBefore: Stats | null = null;
    try {
      targetBefore = await lstat(target);
      validateFile(targetBefore);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }
    const temporary = join(parent, `.${sha256(target).slice(0, 12)}.${randomBytes(12).toString("hex")}.tmp`);
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      FILE_MODE,
    );
    let writeFailure: unknown;
    try {
      await handle.writeFile(`${canonicalJson(value)}\n`, { encoding: "utf8" });
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
      await rename(temporary, target);
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

  private async acquireLock(key: string): Promise<HeldLock> {
    const lockName = `${sha256(`lock\0${key}`)}.lock`;
    const relativePath = join("locks", lockName);
    const path = this.resolveRelative(relativePath);
    const started = Date.now();
    const token = randomBytes(16).toString("hex");
    while (Date.now() - started <= this.lockWaitMs) {
      const handle = await open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        FILE_MODE,
      ).catch((error: unknown) => {
        if (isCode(error, "EEXIST")) return null;
        throw error;
      });
      if (handle !== null) {
        try {
          await handle.writeFile(canonicalJson({ pid: process.pid.toString(), createdAtMs: Date.now().toString(), token }));
          await handle.sync();
        } finally {
          await handle.close();
        }
        return { path, token };
      }
      await this.clearStaleLock(relativePath);
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10));
    }
    throw new ApnError("APN_STATE_BUSY", "State is busy; retry the operation.");
  }

  private async clearStaleLock(relativePath: string): Promise<void> {
    const target = this.resolveRelative(relativePath);
    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isCode(error, "ENOENT")) return;
      throw error;
    }
    const opened = await handle.stat();
    validateFile(opened);
    let value: unknown;
    try {
      value = JSON.parse(await handle.readFile({ encoding: "utf8" })) as unknown;
    } catch {
      await handle.close();
      stateSecurity("Lock file has invalid JSON.");
    }
    if (!isPlainRecord(value) || typeof value.pid !== "string" || typeof value.createdAtMs !== "string") {
      await handle.close();
      stateSecurity("Lock file has an invalid schema.");
    }
    const pid = Number(value.pid);
    const createdAtMs = Number(value.createdAtMs);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(createdAtMs)) {
      await handle.close();
      stateSecurity("Lock file has invalid ownership metadata.");
    }
    if (Date.now() - createdAtMs <= this.lockLeaseMs || pidAlive(pid)) {
      await handle.close();
      return;
    }
    if (!this.hostSerialized) {
      await handle.close();
      throw new ApnError("APN_STATE_BUSY", "Stale-lock recovery requires the native host advisory lock.");
    }
    await this.beforeStaleLockTakeover(target);
    const current = await lstat(target).catch((error: unknown) => {
      if (isCode(error, "ENOENT")) return null;
      throw error;
    });
    if (current === null) {
      await handle.close();
      return;
    }
    if (current.dev !== opened.dev || current.ino !== opened.ino) {
      await handle.close();
      stateSecurity("Lock changed during stale takeover; replacement was preserved.");
    }
    await unlink(target);
    await handle.close();
  }

  protected async beforeStaleLockTakeover(_path: string): Promise<void> {}

  private async releaseLock(lock: HeldLock): Promise<void> {
    const relativePath = relative(this.root, lock.path);
    const value = await this.readJson(relativePath).catch(() => null);
    if (isPlainRecord(value) && value.token === lock.token) await unlink(lock.path).catch(() => undefined);
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM");
  }
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}
