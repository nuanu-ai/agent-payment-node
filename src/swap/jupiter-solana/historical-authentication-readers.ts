import { lstat, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { ChainAccountStore } from "../../chain-account-store.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import { ApnError } from "../../errors.js";
import { StateStore } from "../../state.js";
import { validateDirectory } from "../../secure-state-store.js";
import { JupiterV1ExecutionBindingStore } from "./v1-effects.js";
import { SavedJupiterV1MaterialStore } from "./v1-material.js";

export function historicalAuthenticationRefused(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "Historical Jupiter material authentication is unavailable.");
}
export async function existingHistoricalRoot(root: string): Promise<void> {
  try { validateDirectory(await lstat(root), true); if (await realpath(root) !== root) historicalAuthenticationRefused(); }
  catch { historicalAuthenticationRefused(); }
}
const BASE_DIRECTORIES = Object.freeze(["profiles", "wallets", "policies", "provider-authorizations", "operations", "receipts", "x402-operations", "x402-results", "x402-receipts", "rpc-provider-pacing", "locks"]);
const MATERIAL_DIRECTORIES = Object.freeze([...BASE_DIRECTORIES, "jupiter-v1-quotes", "jupiter-v1-quotes/chunks"]);
const BINDING_DIRECTORIES = Object.freeze([...BASE_DIRECTORIES, "jupiter-v1-bindings", "jupiter-v1-claims", "jupiter-v1-prepared", "jupiter-v1-fresh", "jupiter-v1-signatures"]);
const CUSTODY_DIRECTORIES = Object.freeze([...BASE_DIRECTORIES, "chain-accounts", "chain-wallets"]);
/** Pure existing-directory checks. A shared guard pins identities across all finite readers and locks. */
export class HistoricalDirectoryGuard {
  readonly #identities = new Map<string, { readonly dev: number; readonly ino: number }>();
  constructor(readonly root: string) {}
  async #directory(path: string): Promise<void> {
    const before = await lstat(path); validateDirectory(before, path === this.root);
    if (await realpath(path) !== path) historicalAuthenticationRefused();
    const after = await lstat(path); validateDirectory(after, path === this.root);
    if (before.dev !== after.dev || before.ino !== after.ino) historicalAuthenticationRefused();
    const original = this.#identities.get(path);
    if (original !== undefined && (original.dev !== after.dev || original.ino !== after.ino)) historicalAuthenticationRefused();
    this.#identities.set(path, {dev:after.dev, ino:after.ino});
  }
  async check(directories: readonly string[] = []): Promise<void> {
    try {
      await this.#directory(this.root);
      for (const relative of directories) {
        const target = resolve(this.root, relative);
        if (!target.startsWith(`${this.root}${sep}`)) historicalAuthenticationRefused();
        let current = this.root;
        for (const part of target.slice(this.root.length + 1).split(sep)) { current = resolve(current, part); await this.#directory(current); }
      }
      await this.#directory(this.root);
    } catch { historicalAuthenticationRefused(); }
  }
}
export class HistoricalReadState extends StateStore {
  readonly #guard: HistoricalDirectoryGuard;
  constructor(root: string, guard = new HistoricalDirectoryGuard(root)) { super(root); if (guard.root !== root) historicalAuthenticationRefused(); this.#guard = guard; }
  directoryGuard(): HistoricalDirectoryGuard { return this.#guard; }
  override async initialize(): Promise<void> { await this.#guard.check(BASE_DIRECTORIES); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.#guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.#guard.check(dirs); const value = await super.readJson(path); await this.#guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.#guard.check([path]); const value = await super.readDirectory(path); await this.#guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
  protected override async beforeLockAcquire(): Promise<void> { await this.#guard.check(["locks"]); }
  override async withLocks<T>(keys: readonly string[], action: () => Promise<T>, options: {readonly waitMs?:number} = {}): Promise<T> {
    await this.#guard.check(["locks"]);
    return await super.withLocks(keys, async () => { await this.#guard.check(["locks"]); try { return await action(); } finally { await this.#guard.check(["locks"]); } }, options);
  }
}
export class HistoricalMaterialReader extends SavedJupiterV1MaterialStore {
  readonly #guard: HistoricalDirectoryGuard;
  constructor(root: string, guard = new HistoricalDirectoryGuard(root)) { super(root); if (guard.root !== root) historicalAuthenticationRefused(); this.#guard=guard; }
  override async initialize(): Promise<void> { await this.#guard.check(MATERIAL_DIRECTORIES); }
  protected override async initializeStorage(): Promise<void> { await this.#guard.check(MATERIAL_DIRECTORIES); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.#guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.#guard.check(dirs); const value = await super.readJson(path); await this.#guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.#guard.check([path]); const value = await super.readDirectory(path); await this.#guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
  protected override async beforeLockAcquire(): Promise<void> { await this.#guard.check(["locks"]); }
}
export class HistoricalBindingReader extends JupiterV1ExecutionBindingStore {
  readonly #guard: HistoricalDirectoryGuard;
  constructor(root: string, guard = new HistoricalDirectoryGuard(root)) { super(root); if (guard.root !== root) historicalAuthenticationRefused(); this.#guard=guard; }
  override async initialize(): Promise<void> { await this.#guard.check(BINDING_DIRECTORIES); }
  protected override async initializeStorage(): Promise<void> { await this.#guard.check(BINDING_DIRECTORIES); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.#guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.#guard.check(dirs); const value = await super.readJson(path); await this.#guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.#guard.check([path]); const value = await super.readDirectory(path); await this.#guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
  protected override async beforeLockAcquire(): Promise<void> { await this.#guard.check(["locks"]); }
}
export class HistoricalCustodyReader extends ChainAccountStore {
  readonly #guard: HistoricalDirectoryGuard;
  constructor(root: string, wrapping: WrappingSecretPort, guard = new HistoricalDirectoryGuard(root)) { super(root, wrapping); if (guard.root !== root) historicalAuthenticationRefused(); this.#guard=guard; }
  override async initialize(): Promise<void> { await this.#guard.check(CUSTODY_DIRECTORIES); }
  protected override async initializeStorage(): Promise<void> { await this.#guard.check(CUSTODY_DIRECTORIES); }
  protected override async ensureDirectory(path: string): Promise<void> { await this.#guard.check([path]); }
  protected override async readJson(path: string): Promise<unknown | null> {
    const parent = dirname(path), dirs = parent === "." ? [] : [parent];
    await this.#guard.check(dirs); const value = await super.readJson(path); await this.#guard.check(dirs); return value;
  }
  protected override async readDirectory(path: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.#guard.check([path]); const value = await super.readDirectory(path); await this.#guard.check([path]); return value;
  }
  protected override async writeJson(): Promise<void> { historicalAuthenticationRefused(); }
  protected override async beforeLockAcquire(): Promise<void> { await this.#guard.check(["locks"]); }
}
