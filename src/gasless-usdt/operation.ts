import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
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

function fail(reason: string, code: "APN_INVALID_INPUT" | "APN_STATE_CORRUPT" | "APN_IDEMPOTENCY_CONFLICT" | "APN_PROVIDER_CAPABILITY_UNAVAILABLE" | "APN_OPERATION_NOT_FOUND" = "APN_INVALID_INPUT"): never {
  throw new ApnError(code, `Gasless USDT operation refused: ${reason}.`, { reason, rail: "gasless_usdt" });
}
function address(value: unknown, reason: string): Address {
  try { return getAddress(String(value)); } catch { fail(reason); }
}
function atomic(value: unknown, reason: string): bigint {
  if (typeof value !== "bigint" && typeof value !== "string") fail(reason);
  if (!/^(0|[1-9][0-9]*)$/u.test(String(value))) fail(reason);
  return BigInt(String(value));
}
function bodyOf(record: UsdtOperationRecord): Omit<UsdtOperationRecord, "integrityHash"> {
  const { integrityHash: _ignored, ...body } = record;
  return body;
}
function operationIntent(record: UsdtOperationRecord): Record<string, unknown> {
  const { operationId: _operationId, integrityHash: _integrityHash, ...intent } = record;
  return intent;
}
function seal(record: Omit<UsdtOperationRecord, "integrityHash">): UsdtOperationRecord {
  return { ...record, integrityHash: hashObject(record) };
}

export function validateUsdtOperation(value: unknown): UsdtOperationRecord {
  if (!isPlainRecord(value) || !exactKeys(value, RECORD_KEYS)) fail("journal_shape", "APN_STATE_CORRUPT");
  if (value.schemaVersion !== USDT_OPERATION_SCHEMA || value.kind !== "gasless_usdt_transfer") fail("journal_schema", "APN_STATE_CORRUPT");
  for (const key of ["operationId", "idempotencyHash", "profileHash", "policyDigest", "integrityHash"]) if (typeof value[key] !== "string" || !HASH.test(value[key] as string)) fail("journal_hash", "APN_STATE_CORRUPT");
  if (typeof value.idempotencyKey !== "string" || !KEY.test(value.idempotencyKey)) fail("idempotency_key");
  if (value.chainId !== 1 || value.token !== USDT_GASLESS.token) fail("chain_token_binding", "APN_STATE_CORRUPT");
  address(value.sender, "account_binding"); address(value.recipient, "account_binding");
  if (String(value.sender).toLowerCase() === String(value.recipient).toLowerCase()) fail("account_binding", "APN_STATE_CORRUPT");
  for (const key of ["grossAtomic", "maxFeeAtomic", "minReceivedAtomic", "nonce"]) atomic(value[key], "amount_nonce_binding");
  if (BigInt(value.grossAtomic as string) <= 0n || BigInt(value.maxFeeAtomic as string) < 0n || BigInt(value.minReceivedAtomic as string) <= 0n || BigInt(value.minReceivedAtomic as string) > BigInt(value.grossAtomic as string)) fail("amount_binding", "APN_STATE_CORRUPT");
  if (BigInt(value.nonce as string) < 0n || typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) fail("expiry_nonce_binding", "APN_STATE_CORRUPT");
  if (value.signerBoundary !== "unavailable" || value.dispatch !== "disabled" || value.recovery !== "read_only") fail("effect_marker", "APN_STATE_CORRUPT");
  if (!["prepared", "recovery_required", "capability_unavailable"].includes(value.state as string)) fail("state", "APN_STATE_CORRUPT");
  if (hashObject(operationIntent(value as unknown as UsdtOperationRecord)) !== value.operationId) fail("operation_identity", "APN_STATE_CORRUPT");
  if (hashObject(bodyOf(value as unknown as UsdtOperationRecord)) !== value.integrityHash) fail("journal_integrity", "APN_STATE_CORRUPT");
  return value as unknown as UsdtOperationRecord;
}

export class UsdtOperationRepository {
  readonly directory: string;
  constructor(readonly root: string) { this.directory = join(root, "gasless-usdt-operations"); }
  private path(profileHash: string, operationId: string): string { return join(this.directory, profileHash, `${operationId}.json`); }
  async load(profileHash: string, operationId: string): Promise<UsdtOperationRecord | null> {
    try { return validateUsdtOperation(JSON.parse(await readFile(this.path(profileHash, operationId), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async findIdempotency(idempotencyHash: string): Promise<UsdtOperationRecord | null> {
    let profiles: string[]; try { profiles = await readdir(this.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    for (const profile of profiles) { let entries: string[]; try { entries = await readdir(join(this.directory, profile)); } catch { continue; } for (const entry of entries) if (entry.endsWith(".json")) { const op = await this.load(profile, entry.slice(0, -5)); if (op?.idempotencyHash === idempotencyHash) return op; } }
    return null;
  }
  async create(record: UsdtOperationRecord): Promise<UsdtOperationRecord> {
    validateUsdtOperation(record); const path = this.path(record.profileHash, record.operationId); await mkdir(join(this.directory, record.profileHash), { recursive: true });
    try { await writeFile(path, `${canonicalJson(record)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); return record; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; const existing = await this.load(record.profileHash, record.operationId); if (existing === null) throw error; return existing; }
  }
}

export async function prepareUsdtOperation(repository: UsdtOperationRepository, input: UsdtOperationInput, idempotencyKey: string): Promise<UsdtOperationRecord> {
  if (!KEY.test(idempotencyKey)) fail("idempotency_key");
  const now = input.now ?? Math.floor(Date.now() / 1000); if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) fail("expiry_binding");
  if (!HASH.test(input.profileHash) || !HASH.test(input.policyDigest)) fail("owner_policy_binding");
  const sender = address(input.sender, "account_binding"), recipient = address(input.recipient, "account_binding");
  const gross = atomic(input.grossAtomic, "amount_binding"), maxFee = atomic(input.maxFeeAtomic, "amount_binding"), minimum = atomic(input.minReceivedAtomic, "amount_binding"), nonce = atomic(input.nonce, "nonce_binding");
  if (gross <= 0n || maxFee < 0n || minimum <= 0n || minimum > gross || sender.toLowerCase() === recipient.toLowerCase()) fail("amount_account_binding");
  const idempotencyHash = hashObject({ schemaVersion: USDT_OPERATION_SCHEMA, idempotencyKey });
  const previous = await repository.findIdempotency(idempotencyHash); if (previous !== null) { if (previous.sender !== sender || previous.recipient !== recipient || previous.grossAtomic !== gross.toString()) fail("idempotency_conflict", "APN_IDEMPOTENCY_CONFLICT"); return previous; }
  const intent = { schemaVersion: USDT_OPERATION_SCHEMA, kind: "gasless_usdt_transfer" as const, idempotencyKey, idempotencyHash, profileHash: input.profileHash, policyDigest: input.policyDigest, chainId: 1 as const, token: USDT_GASLESS.token, sender, recipient, grossAtomic: gross.toString(), maxFeeAtomic: maxFee.toString(), minReceivedAtomic: minimum.toString(), nonce: nonce.toString(), expiresAt: input.expiresAt, signerBoundary: "unavailable" as const, dispatch: "disabled" as const, recovery: "read_only" as const, state: "prepared" as const, createdAt: new Date(now * 1000).toISOString(), updatedAt: new Date(now * 1000).toISOString() };
  return repository.create(seal({ ...intent, operationId: hashObject(intent) }));
}
export async function statusUsdtOperation(repository: UsdtOperationRepository, profileHash: string, operationId: string): Promise<UsdtOperationRecord> { const op = await repository.load(profileHash, operationId); if (op === null) fail("operation_not_found", "APN_OPERATION_NOT_FOUND"); return op; }
/** Resume is a read-only classification. It never rewrites the saved journal or advances state. */
export async function resumeUsdtOperation(repository: UsdtOperationRepository, profileHash: string, operationId: string): Promise<UsdtOperationRecord> { return statusUsdtOperation(repository, profileHash, operationId); }
export function refuseUsdtApproval(action: "approve" | "execute"): never { fail(`${action}_capability_unavailable`, "APN_PROVIDER_CAPABILITY_UNAVAILABLE"); }
