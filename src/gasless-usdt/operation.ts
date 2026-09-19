import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import { USDT_GASLESS } from "./model.js";

export const USDT_OPERATION_SCHEMA = "apn.gasless-usdt-operation.v1" as const;
export type UsdtOperationState = "prepared" | "recovery_required" | "capability_unavailable";
export interface UsdtOperationInput {
  readonly profileHash: string;
  readonly policyDigest: string;
  readonly sender: Address;
  readonly recipient: Address;
  readonly grossAtomic: bigint;
  readonly maxFeeAtomic: bigint;
  readonly minReceivedAtomic: bigint;
  readonly nonce: bigint;
  readonly expiresAt: number;
  readonly now?: number;
}
export interface UsdtOperationRecord {
  readonly schemaVersion: typeof USDT_OPERATION_SCHEMA;
  readonly kind: "gasless_usdt_transfer";
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyHash: string;
  readonly profileHash: string;
  readonly policyDigest: string;
  readonly chainId: 1;
  readonly token: Address;
  readonly sender: Address;
  readonly recipient: Address;
  readonly grossAtomic: string;
  readonly maxFeeAtomic: string;
  readonly minReceivedAtomic: string;
  readonly nonce: string;
  readonly expiresAt: number;
  readonly signerBoundary: "unavailable";
  readonly dispatch: "disabled";
  readonly recovery: "read_only";
  readonly state: UsdtOperationState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly integrityHash: string;
}

const HASH = /^[a-f0-9]{64}$/u;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RECORD_KEYS = ["schemaVersion", "kind", "operationId", "idempotencyKey", "idempotencyHash", "profileHash", "policyDigest", "chainId", "token", "sender", "recipient", "grossAtomic", "maxFeeAtomic", "minReceivedAtomic", "nonce", "expiresAt", "signerBoundary", "dispatch", "recovery", "state", "createdAt", "updatedAt", "integrityHash"] as const;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_RECORD_BYTES = 1024 * 1024;

type FailureCode = "APN_INVALID_INPUT" | "APN_STATE_CORRUPT" | "APN_IDEMPOTENCY_CONFLICT" |
  "APN_PROVIDER_CAPABILITY_UNAVAILABLE" | "APN_OPERATION_NOT_FOUND" | "APN_STATE_SECURITY";

function fail(reason: string, code: FailureCode = "APN_INVALID_INPUT"): never {
  throw new ApnError(code, `Gasless USDT operation refused: ${reason}.`, { reason, rail: "gasless_usdt" });
}

function hash(value: unknown, reason: string, code: FailureCode): string {
  if (typeof value !== "string" || !HASH.test(value)) fail(reason, code);
  return value;
}

function key(value: unknown, reason: string, code: FailureCode): string {
  if (typeof value !== "string" || !KEY.test(value)) fail(reason, code);
  return value;
}

function address(value: unknown, reason: string, code: FailureCode = "APN_INVALID_INPUT"): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) fail(reason, code);
  try {
    const normalized = getAddress(value);
    if (normalized !== value) fail(reason, code);
    return normalized;
  } catch {
    fail(reason, code);
  }
}

function atomic(value: unknown, reason: string, code: FailureCode = "APN_INVALID_INPUT"): bigint {
  if (typeof value !== "bigint" && typeof value !== "string") fail(reason, code);
  const decimal = typeof value === "bigint" ? value.toString() : value;
  if (!/^(0|[1-9][0-9]*)$/u.test(decimal)) fail(reason, code);
  return BigInt(decimal);
}

function persistedAtomic(value: unknown, reason: string): bigint {
  if (typeof value !== "string") fail(reason, "APN_STATE_CORRUPT");
  return atomic(value, reason, "APN_STATE_CORRUPT");
}

function iso(value: unknown, reason: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(reason, "APN_STATE_CORRUPT");
  try {
    if (new Date(value).toISOString() !== value) fail(reason, "APN_STATE_CORRUPT");
  } catch {
    fail(reason, "APN_STATE_CORRUPT");
  }
  return value;
}

function bodyOf(record: UsdtOperationRecord): Omit<UsdtOperationRecord, "integrityHash"> {
  const { integrityHash: _ignored, ...body } = record;
  return body;
}

function operationIntent(record: UsdtOperationRecord): Record<string, unknown> {
  const { operationId: _operationId, integrityHash: _integrityHash, ...intent } = record;
  return intent;
}

function replayBinding(record: Pick<UsdtOperationRecord, "profileHash" | "policyDigest" | "chainId" | "token" | "sender" | "recipient" | "grossAtomic" | "maxFeeAtomic" | "minReceivedAtomic" | "nonce" | "expiresAt">): Record<string, unknown> {
  return {
    profileHash: record.profileHash, policyDigest: record.policyDigest, chainId: record.chainId, token: record.token,
    sender: record.sender, recipient: record.recipient, grossAtomic: record.grossAtomic, maxFeeAtomic: record.maxFeeAtomic,
    minReceivedAtomic: record.minReceivedAtomic, nonce: record.nonce, expiresAt: record.expiresAt,
  };
}

function seal(record: Omit<UsdtOperationRecord, "integrityHash">): UsdtOperationRecord {
  return { ...record, integrityHash: hashObject(record) };
}

export function validateUsdtOperation(value: unknown): UsdtOperationRecord {
  if (!isPlainRecord(value) || !exactKeys(value, RECORD_KEYS)) fail("journal_shape", "APN_STATE_CORRUPT");
  if (value.schemaVersion !== USDT_OPERATION_SCHEMA || value.kind !== "gasless_usdt_transfer") fail("journal_schema", "APN_STATE_CORRUPT");
  const operationId = hash(value.operationId, "journal_hash", "APN_STATE_CORRUPT");
  const idempotencyKey = key(value.idempotencyKey, "idempotency_key", "APN_STATE_CORRUPT");
  const idempotencyHash = hash(value.idempotencyHash, "journal_hash", "APN_STATE_CORRUPT");
  const profileHash = hash(value.profileHash, "journal_hash", "APN_STATE_CORRUPT");
  const policyDigest = hash(value.policyDigest, "journal_hash", "APN_STATE_CORRUPT");
  const integrityHash = hash(value.integrityHash, "journal_hash", "APN_STATE_CORRUPT");
  if (idempotencyHash !== hashObject({ schemaVersion: USDT_OPERATION_SCHEMA, idempotencyKey })) fail("idempotency_binding", "APN_STATE_CORRUPT");
  if (value.chainId !== 1 || value.token !== USDT_GASLESS.token) fail("chain_token_binding", "APN_STATE_CORRUPT");
  const sender = address(value.sender, "account_binding", "APN_STATE_CORRUPT");
  const recipient = address(value.recipient, "account_binding", "APN_STATE_CORRUPT");
  if (sender.toLowerCase() === recipient.toLowerCase()) fail("account_binding", "APN_STATE_CORRUPT");
  const gross = persistedAtomic(value.grossAtomic, "amount_nonce_binding");
  const maxFee = persistedAtomic(value.maxFeeAtomic, "amount_nonce_binding");
  const minimum = persistedAtomic(value.minReceivedAtomic, "amount_nonce_binding");
  const nonce = persistedAtomic(value.nonce, "amount_nonce_binding");
  if (gross <= 0n || minimum <= 0n || minimum > gross || maxFee < 0n || nonce < 0n) fail("amount_nonce_binding", "APN_STATE_CORRUPT");
  if (typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) fail("expiry_nonce_binding", "APN_STATE_CORRUPT");
  if (value.signerBoundary !== "unavailable" || value.dispatch !== "disabled" || value.recovery !== "read_only") fail("effect_marker", "APN_STATE_CORRUPT");
  if (!["prepared", "recovery_required", "capability_unavailable"].includes(value.state as string)) fail("state", "APN_STATE_CORRUPT");
  const createdAt = iso(value.createdAt, "created_timestamp");
  const updatedAt = iso(value.updatedAt, "updated_timestamp");
  if (Date.parse(updatedAt) < Date.parse(createdAt) || value.expiresAt * 1000 <= Date.parse(createdAt)) fail("timestamp_expiry_binding", "APN_STATE_CORRUPT");
  const record = value as unknown as UsdtOperationRecord;
  if (hashObject(operationIntent(record)) !== operationId) fail("operation_identity", "APN_STATE_CORRUPT");
  if (hashObject(bodyOf(record)) !== integrityHash) fail("journal_integrity", "APN_STATE_CORRUPT");
  void profileHash; void policyDigest; void sender; void recipient; void gross; void maxFee; void minimum; void nonce; void createdAt; void updatedAt;
  return record;
}

export class UsdtOperationRepository {
  readonly directory: string;
  private idempotencyTail: Promise<void> = Promise.resolve();

  constructor(readonly root: string) {
    if (!isAbsolute(root) || normalize(root) !== root || resolve(root) !== root) fail("state_root", "APN_STATE_SECURITY");
    this.directory = join(root, "gasless-usdt-operations");
  }

  private identifier(value: unknown, reason: string): string {
    return hash(value, reason, "APN_STATE_SECURITY");
  }

  private path(profileHash: string, operationId: string): string {
    return join(this.directory, this.identifier(profileHash, "profile_path"), `${this.identifier(operationId, "operation_path")}.json`);
  }

  private async secureDirectory(path: string, missingIsEmpty: boolean): Promise<boolean> {
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== DIRECTORY_MODE) fail("journal_directory", "APN_STATE_SECURITY");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && missingIsEmpty) return false;
      throw error;
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
    await this.secureDirectory(path, false);
  }

  private async secureFile(path: string): Promise<string | null> {
    let info;
    try { info = await lstat(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== FILE_MODE || info.nlink !== 1) fail("journal_file", "APN_STATE_SECURITY");
    const content = await readFile(path);
    if (content.byteLength > MAX_RECORD_BYTES) fail("journal_capacity", "APN_STATE_CORRUPT");
    return content.toString("utf8");
  }

  async load(profileHash: string, operationId: string): Promise<UsdtOperationRecord | null> {
    const profile = this.identifier(profileHash, "profile_path");
    const operation = this.identifier(operationId, "operation_path");
    if (!await this.secureDirectory(this.root, true)) return null;
    if (!await this.secureDirectory(this.directory, true)) return null;
    if (!await this.secureDirectory(join(this.directory, profile), true)) return null;
    const content = await this.secureFile(this.path(profile, operation));
    if (content === null) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { fail("journal_json", "APN_STATE_CORRUPT"); }
    const record = validateUsdtOperation(parsed);
    if (record.profileHash !== profile || record.operationId !== operation) fail("journal_path_binding", "APN_STATE_CORRUPT");
    return record;
  }

  private async listEntries(path: string): Promise<readonly { readonly name: string; readonly isDirectory: boolean; readonly isFile: boolean; readonly isSymbolicLink: boolean }[]> {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    return entries.map(entry => ({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile(), isSymbolicLink: entry.isSymbolicLink() }));
  }

  async findIdempotency(idempotencyHash: string): Promise<UsdtOperationRecord | null> {
    const wanted = hash(idempotencyHash, "idempotency_hash", "APN_INVALID_INPUT");
    if (!await this.secureDirectory(this.root, true) || !await this.secureDirectory(this.directory, true)) return null;
    let found: UsdtOperationRecord | null = null;
    for (const profile of await this.listEntries(this.directory)) {
      if (!profile.isDirectory || profile.isSymbolicLink || !HASH.test(profile.name)) fail("journal_profile_entry", "APN_STATE_CORRUPT");
      const profilePath = join(this.directory, profile.name);
      if (!await this.secureDirectory(profilePath, false)) fail("journal_profile_directory", "APN_STATE_CORRUPT");
      for (const entry of await this.listEntries(profilePath)) {
        if (!entry.isFile || entry.isSymbolicLink || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) fail("journal_operation_entry", "APN_STATE_CORRUPT");
        const operation = entry.name.slice(0, -5);
        const op = await this.load(profile.name, operation);
        if (op?.idempotencyHash !== wanted) continue;
        if (found !== null) fail("duplicate_idempotency", "APN_STATE_CORRUPT");
        found = op;
      }
    }
    return found;
  }

  async create(record: UsdtOperationRecord): Promise<UsdtOperationRecord> {
    validateUsdtOperation(record);
    const profile = this.identifier(record.profileHash, "profile_path");
    const operation = this.identifier(record.operationId, "operation_path");
    await this.ensureDirectory(this.root);
    await this.ensureDirectory(this.directory);
    await this.ensureDirectory(join(this.directory, profile));
    try {
      await writeFile(this.path(profile, operation), `${canonicalJson(record)}\n`, { encoding: "utf8", flag: "wx", mode: FILE_MODE });
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await this.load(profile, operation);
      if (existing === null) throw error;
      return existing;
    }
  }

  async withIdempotencyLock<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.idempotencyTail;
    let release!: () => void;
    this.idempotencyTail = new Promise<void>(resolveRelease => { release = resolveRelease; });
    await previous;
    try { return await action(); } finally { release(); }
  }
}

export async function prepareUsdtOperation(repository: UsdtOperationRepository, input: UsdtOperationInput, idempotencyKey: string): Promise<UsdtOperationRecord> {
  const keyValue = key(idempotencyKey, "idempotency_key", "APN_INVALID_INPUT");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) fail("expiry_binding");
  const profileHash = hash(input.profileHash, "owner_policy_binding", "APN_INVALID_INPUT");
  const policyDigest = hash(input.policyDigest, "owner_policy_binding", "APN_INVALID_INPUT");
  const sender = address(input.sender, "account_binding");
  const recipient = address(input.recipient, "account_binding");
  const gross = atomic(input.grossAtomic, "amount_binding");
  const maxFee = atomic(input.maxFeeAtomic, "amount_binding");
  const minimum = atomic(input.minReceivedAtomic, "amount_binding");
  const nonce = atomic(input.nonce, "nonce_binding");
  if (gross <= 0n || maxFee < 0n || minimum <= 0n || minimum > gross || sender.toLowerCase() === recipient.toLowerCase()) fail("amount_account_binding");
  const idempotencyHash = hashObject({ schemaVersion: USDT_OPERATION_SCHEMA, idempotencyKey: keyValue });
  return repository.withIdempotencyLock(async () => {
    const previous = await repository.findIdempotency(idempotencyHash);
    const inputBinding = {
      profileHash, policyDigest, chainId: 1 as const, token: USDT_GASLESS.token, sender, recipient,
      grossAtomic: gross.toString(), maxFeeAtomic: maxFee.toString(), minReceivedAtomic: minimum.toString(), nonce: nonce.toString(), expiresAt: input.expiresAt,
    };
    if (previous !== null) {
      if (canonicalJson(replayBinding(previous)) !== canonicalJson(inputBinding)) fail("idempotency_conflict", "APN_IDEMPOTENCY_CONFLICT");
      return previous;
    }
    const intent = {
      schemaVersion: USDT_OPERATION_SCHEMA, kind: "gasless_usdt_transfer" as const, idempotencyKey: keyValue, idempotencyHash,
      ...inputBinding, signerBoundary: "unavailable" as const, dispatch: "disabled" as const, recovery: "read_only" as const,
      state: "prepared" as const, createdAt: new Date(now * 1000).toISOString(), updatedAt: new Date(now * 1000).toISOString(),
    };
    return repository.create(seal({ ...intent, operationId: hashObject(intent) }));
  });
}

export async function statusUsdtOperation(repository: UsdtOperationRepository, profileHash: string, operationId: string): Promise<UsdtOperationRecord> {
  const op = await repository.load(profileHash, operationId);
  if (op === null) fail("operation_not_found", "APN_OPERATION_NOT_FOUND");
  return op;
}

/** Resume is a read-only classification. It never rewrites the saved journal or advances state. */
export async function resumeUsdtOperation(repository: UsdtOperationRepository, profileHash: string, operationId: string): Promise<UsdtOperationRecord> {
  return statusUsdtOperation(repository, profileHash, operationId);
}

export function refuseUsdtApproval(action: "approve" | "execute"): never {
  fail(`${action}_capability_unavailable`, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
}

export function refuseUsdtSigner(): never { fail("signer_capability_unavailable", "APN_PROVIDER_CAPABILITY_UNAVAILABLE"); }
export function refuseUsdtDispatch(): never { fail("dispatch_capability_unavailable", "APN_PROVIDER_CAPABILITY_UNAVAILABLE"); }
export function refuseUsdtRecovery(): never { fail("recovery_capability_unavailable", "APN_PROVIDER_CAPABILITY_UNAVAILABLE"); }
