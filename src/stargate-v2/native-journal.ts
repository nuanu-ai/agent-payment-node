import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { canonicalJson } from "../canonical.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import { admitOperation } from "../operation-index/admission.js";
import { evmClaim, namedProfileHash } from "../operation-index/adapters/family-claims.js";
import type { StargateNativeJournal, StargateNativeOperation } from "./native-execution.js";
import type { StargateAdmission } from "./token-model.js";
import { address, fail, validateRecord, validateAdvance } from "./native-record.js";

export class FileStargateNativeJournal implements StargateNativeJournal {
  private readonly locks: Pick<StateStore, "initialize" | "withLocks">;
  constructor(private readonly root: string, locks?: Pick<StateStore, "initialize" | "withLocks">) {
    this.locks = locks ?? new StateStore(root, { lockWaitMs: 0 });
  }
  private path(id: string): string {
    if (!/^[a-f0-9]{64}$/u.test(id)) fail("APN_STATE_CORRUPT", "operation_id");
    return join(this.root, "stargate-v2-native", `${id}.json`);
  }
  async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    await this.locks.initialize();
    return await this.locks.withLocks([`stargate-native:${id}`], work, { waitMs: 30_000 });
  }
  /** The same per-account lock every other EVM writer holds, so no other family can race this nonce. */
  async withOwnerLock<T>(owner: Address, work: () => Promise<T>): Promise<T> {
    await this.locks.initialize(); return await this.locks.withLocks([evmAddressLock(address(owner))], work, { waitMs: 30_000 });
  }
  async admit<T>(operation: StargateAdmission, work: () => Promise<T>): Promise<T> {
    const state = new StateStore(this.root); await state.initialize();
    return await admitOperation(state, { family: "stargate_native", profileHash: namedProfileHash(operation.profile), operationId: operation.operationId,
      idempotencyHash: null, requestHash: null }, [evmClaim(1, address(operation.owner))], work);
  }
  async load(id: string): Promise<StargateNativeOperation | null> {
    try {
      const path = this.path(id); await secureDirectory(dirname(path), false); const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("APN_STATE_CORRUPT", "journal_file_mode");
      return validateRecord(JSON.parse(await readFile(path, "utf8")));
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async save(nextInput: StargateNativeOperation): Promise<void> {
    const next = validateRecord(nextInput), path = this.path(next.operationId), previous = await this.load(next.operationId);
    validateAdvance(previous, next); const directory = dirname(path); await secureDirectory(directory);
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`, handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(`${canonicalJson(next)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, path); const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
  }
}

async function secureDirectory(directory: string, create = true): Promise<void> {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 }); const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("APN_STATE_CORRUPT", "journal_directory_mode");
  const resolved = await realpath(directory), parent = await realpath(dirname(directory));
  if (relative(parent, resolved).startsWith("..")) fail("APN_STATE_CORRUPT", "journal_path");
}
