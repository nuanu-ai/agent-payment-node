import { link, lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { getAddress } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import type { Address } from "../model.js";
import { USDT_EXCHANGE_RATE_MAX, USDT_GASLESS, USDT_POST_OP_GAS_MAX } from "./model.js";
import { decodeUsdtPaymasterData, validateUsdtPaymasterData } from "./paymaster-data.js";
import { usdtApprovalTransferBatch, type UsdtPolicyPrepared, type UsdtPreparePort } from "./policy-prepare.js";
import { planUsdtTransfer } from "./quote.js";
import { usdtUserOperation } from "./userop.js";

export const USDT_BOUND_OPERATION_SCHEMA = "apn.gasless-usdt-bound-operation.v1" as const;
type Persisted<T> = T extends bigint ? string : T extends readonly (infer Item)[] ? readonly Persisted<Item>[] :
  T extends object ? { readonly [Key in keyof T]: Persisted<T[Key]> } : T;
export interface UsdtBoundOperation {
  readonly schemaVersion: typeof USDT_BOUND_OPERATION_SCHEMA;
  readonly operationId: string;
  readonly profileHash: string;
  readonly idempotencyKey: string;
  readonly binding: Persisted<UsdtPolicyPrepared>;
  readonly createdAt: string;
  readonly signerBoundary: "unavailable";
  readonly dispatch: "disabled";
  readonly usageReservation: "disabled";
  readonly integrityHash: string;
}
export type UsdtBoundRecovery =
  | { readonly state: "prepared"; readonly operation: UsdtBoundOperation }
  | { readonly state: "capability_unavailable" | "recovery_required"; readonly reason: string; readonly operation: UsdtBoundOperation };

const HASH = /^[a-f0-9]{64}$/u;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_BYTES = 1024 * 1024;
const ORPHAN_AGE_MS = 5 * 60 * 1000;
const ESTIMATE_SIGNATURE = `0x${"fffffffffffffffffffffffffffffff0"}${"0".repeat(32)}7${"a".repeat(63)}1c`;
const STUB_WORD = `0x${"11".repeat(32)}`;
const serializable = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, item: unknown) =>
  typeof item === "bigint" ? item.toString() : item));
function fail(reason: string, code: "APN_INVALID_INPUT" | "APN_STATE_CORRUPT" | "APN_STATE_SECURITY" | "APN_IDEMPOTENCY_CONFLICT" | "APN_OPERATION_NOT_FOUND" = "APN_STATE_CORRUPT"): never {
  throw new ApnError(code, `Gasless USDT binding refused: ${reason}.`, { reason, rail: "gasless_usdt" });
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function decimal(value: unknown): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value)) fail("binding_decimal");
  return BigInt(value);
}
function body(record: UsdtBoundOperation): Omit<UsdtBoundOperation, "integrityHash"> {
  const { integrityHash: _ignored, ...rest } = record;
  return rest;
}

/** Validate both hashes and the relationships that a rehashed but inconsistent record could violate. */
export function validateUsdtBoundOperation(value: unknown): UsdtBoundOperation {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profileHash", "idempotencyKey", "binding", "createdAt", "signerBoundary", "dispatch", "usageReservation", "integrityHash"])) fail("bound_shape");
  if (value.schemaVersion !== USDT_BOUND_OPERATION_SCHEMA || typeof value.operationId !== "string" || !HASH.test(value.operationId) ||
    typeof value.profileHash !== "string" || !HASH.test(value.profileHash) || typeof value.idempotencyKey !== "string" || !KEY.test(value.idempotencyKey) ||
    typeof value.integrityHash !== "string" || !HASH.test(value.integrityHash) || value.signerBoundary !== "unavailable" ||
    value.dispatch !== "disabled" || value.usageReservation !== "disabled") fail("bound_identity");
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt) fail("bound_timestamp");
  const b = value.binding;
  if (!isPlainRecord(b) || !exactKeys(b, ["schemaVersion", "profile", "policyDigest", "policyRevision", "activationDigest", "chain", "token", "mechanism", "sponsorUrl", "safeBlockNumber", "safeBlockHash", "account", "plan", "callData", "paymaster", "paymasterData", "unsignedOperation", "bindingHash"])) fail("binding_shape");
  if (b.schemaVersion !== "apn.gasless-usdt-policy-prepare.v1" || typeof b.profile !== "string" || !b.profile ||
    typeof b.policyDigest !== "string" || !HASH.test(b.policyDigest) || typeof b.activationDigest !== "string" || !HASH.test(b.activationDigest) ||
    !Number.isSafeInteger(b.policyRevision) || (b.policyRevision as number) < 1 || b.chain !== USDT_GASLESS.chain || b.token !== USDT_GASLESS.token ||
    canonicalJson(b.mechanism) !== canonicalJson(USDT_GASLESS.mechanism) || b.sponsorUrl !== USDT_GASLESS.bundlerUrl ||
    decimal(b.safeBlockNumber) < 1n || typeof b.safeBlockHash !== "string" || !HEX32.test(b.safeBlockHash)) fail("binding_policy_chain");
  if (!isPlainRecord(b.account) || !exactKeys(b.account, ["usdtBalanceAtomic", "entryPointNonce", "eoaNonce", "delegation"]) ||
    !["empty", "expected"].includes(b.account.delegation as string)) fail("binding_account");
  const account = { usdtBalanceAtomic: decimal(b.account.usdtBalanceAtomic), entryPointNonce: decimal(b.account.entryPointNonce),
    eoaNonce: decimal(b.account.eoaNonce), delegation: b.account.delegation as "empty" | "expected" };
  if (!isPlainRecord(b.plan) || !isPlainRecord(b.plan.request) || !isPlainRecord(b.plan.quote) || !isPlainRecord(b.plan.price) || !isPlainRecord(b.plan.gas)) fail("binding_plan");
  const p = b.plan, r = p.request as Record<string, unknown>, q = p.quote as Record<string, unknown>, gasPrice = p.price as Record<string, unknown>;
  const request = { sender: r.sender as Address, recipient: r.recipient as Address,
    grossAtomic: decimal(r.grossAtomic), maxFeeAtomic: decimal(r.maxFeeAtomic), minReceivedAtomic: decimal(r.minReceivedAtomic) };
  const quote = { paymaster: q.paymaster as Address, token: q.token as Address, postOpGas: decimal(q.postOpGas),
    exchangeRate: decimal(q.exchangeRate), exchangeRateNativeToUsd: decimal(q.exchangeRateNativeToUsd) };
  const price = { maxFeePerGas: decimal(gasPrice.maxFeePerGas), maxPriorityFeePerGas: decimal(gasPrice.maxPriorityFeePerGas) };
  try {
    if (getAddress(request.sender) !== request.sender || getAddress(request.recipient) !== request.recipient ||
      request.recipient === USDT_GASLESS.token || request.recipient === USDT_GASLESS.paymaster ||
      quote.paymaster !== USDT_GASLESS.paymaster || quote.token !== USDT_GASLESS.token ||
      quote.postOpGas === 0n || quote.postOpGas > USDT_POST_OP_GAS_MAX || quote.exchangeRate === 0n ||
      quote.exchangeRate > USDT_EXCHANGE_RATE_MAX || quote.exchangeRateNativeToUsd === 0n ||
      quote.exchangeRateNativeToUsd > USDT_EXCHANGE_RATE_MAX || price.maxFeePerGas === 0n ||
      price.maxPriorityFeePerGas > price.maxFeePerGas) fail("binding_route");
  } catch { fail("binding_route"); }
  let planned;
  try { planned = planUsdtTransfer(request, quote, price); } catch { fail("binding_plan"); }
  if (canonicalJson(serializable(planned)) !== canonicalJson(p) || account.usdtBalanceAtomic < request.grossAtomic ||
    typeof b.callData !== "string" || b.callData !== usdtApprovalTransferBatch(planned)) fail("binding_plan");
  if (typeof b.paymasterData !== "string") fail("binding_paymaster");
  let paymaster;
  try { paymaster = validateUsdtPaymasterData({ paymaster: USDT_GASLESS.paymaster, paymasterData: b.paymasterData }, planned,
    BigInt(Math.floor(Date.parse(value.createdAt) / 1000))); } catch { fail("binding_paymaster"); }
  if (paymaster.exchangeRate !== quote.exchangeRate || canonicalJson(serializable(paymaster)) !== canonicalJson(b.paymaster)) fail("binding_paymaster");
  const op = b.unsignedOperation;
  if (!isPlainRecord(op) || op.sender !== request.sender || op.callData !== b.callData || op.paymasterData !== b.paymasterData ||
    op.paymaster !== USDT_GASLESS.paymaster || op.nonce !== `0x${account.entryPointNonce.toString(16)}`) fail("binding_operation");
  if (op.signature !== ESTIMATE_SIGNATURE || (account.delegation === "empty" &&
    (!isPlainRecord(op.eip7702Auth) || canonicalJson(op.eip7702Auth) !== canonicalJson({ chainId: "0x1",
      address: USDT_GASLESS.delegate, nonce: `0x${account.eoaNonce.toString(16)}`, yParity: "0x0", r: STUB_WORD, s: STUB_WORD })))) fail("binding_stub");
  const expected = usdtUserOperation(planned, { entryPointNonce: account.entryPointNonce, callData: b.callData as `0x${string}`,
    paymasterData: b.paymasterData as `0x${string}`, signature: op.signature as `0x${string}`,
    authorization: account.delegation === "empty" ? op.eip7702Auth as never : null });
  if (canonicalJson(expected) !== canonicalJson(op) || (account.delegation === "empty" &&
    (!isPlainRecord(op.eip7702Auth) || op.eip7702Auth.address !== USDT_GASLESS.delegate ||
      op.eip7702Auth.nonce !== `0x${account.eoaNonce.toString(16)}`))) fail("binding_operation");
  const { bindingHash: _hash, ...bindingBody } = b;
  if (typeof b.bindingHash !== "string" || b.bindingHash !== hashObject(bindingBody) ||
    value.operationId !== hashObject({ schemaVersion: USDT_BOUND_OPERATION_SCHEMA, profileHash: value.profileHash,
      idempotencyKey: value.idempotencyKey, bindingHash: b.bindingHash }) ||
    value.integrityHash !== hashObject(body(value as unknown as UsdtBoundOperation))) fail("binding_integrity");
  return freeze(value as unknown as UsdtBoundOperation);
}

/** Separate bound journal: one key claims across its profiles, independently of every other payment family's claims. */
export class UsdtBoundOperationRepository {
  readonly directory: string;
  constructor(readonly root: string) {
    if (!isAbsolute(root) || normalize(root) !== root || resolve(root) !== root) fail("state_root", "APN_STATE_SECURITY");
    this.directory = join(root, "gasless-usdt-bound-operations");
  }
  private profilePath(profileHash: string): string {
    if (!HASH.test(profileHash)) fail("bound_path", "APN_STATE_SECURITY");
    return join(this.directory, profileHash);
  }
  private path(profileHash: string, operationId: string): string {
    if (!HASH.test(profileHash) || !HASH.test(operationId)) fail("bound_path", "APN_STATE_SECURITY");
    return join(this.profilePath(profileHash), `${operationId}.json`);
  }
  private claimsPath(): string {
    return join(this.directory, "claims");
  }
  private claimPath(idempotencyKey: string): string {
    if (!KEY.test(idempotencyKey)) fail("bound_key", "APN_INVALID_INPUT");
    return join(this.claimsPath(), `${hashObject({ schemaVersion: USDT_BOUND_OPERATION_SCHEMA, idempotencyKey })}.json`);
  }
  private async dir(path: string, create: boolean): Promise<boolean> {
    if (create) {
      // The state root's parent must already exist. Create one child at a time so each
      // new directory entry can be durably synced in its parent before publication.
      try { await mkdir(path, { mode: DIR_MODE }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("bound_directory_parent_missing", "APN_STATE_SECURITY");
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    let stat;
    try { stat = await lstat(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== DIR_MODE) fail("bound_directory", "APN_STATE_SECURITY");
    // Repeat on retries: a previous process may have stopped after mkdir but before fsync.
    if (create) await this.syncDirectory(dirname(path));
    return true;
  }
  private async syncDirectory(path: string): Promise<void> {
    try { await this.fsyncDirectory(path); }
    catch { fail("bound_directory_sync_unavailable", "APN_STATE_SECURITY"); }
  }
  protected async fsyncDirectory(path: string): Promise<void> {
    const handle = await open(path, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  private async readRecord(path: string): Promise<UsdtBoundOperation | null> {
    let stat;
    try { stat = await lstat(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    // A crash after atomic link but before unlinking the complete temp may leave exactly two links.
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink < 1 || stat.nlink > 2 ||
      (stat.mode & 0o777) !== FILE_MODE || stat.size > MAX_BYTES) fail("bound_file", "APN_STATE_SECURITY");
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(path, "utf8")); } catch { fail("bound_json"); }
    return validateUsdtBoundOperation(parsed);
  }
  private async readClaim(idempotencyKey: string): Promise<UsdtBoundOperation | null> {
    if (!await this.dir(this.claimsPath(), false)) return null;
    const record = await this.readRecord(this.claimPath(idempotencyKey));
    if (record !== null && record.idempotencyKey !== idempotencyKey) fail("bound_claim_binding");
    return record;
  }
  private async writeCompleteTemp(directory: string, record: UsdtBoundOperation): Promise<string> {
    const path = join(directory, `.pending-${randomUUID()}`);
    const content = `${canonicalJson(record)}\n`;
    if (Buffer.byteLength(content, "utf8") > MAX_BYTES) fail("bound_capacity");
    const handle = await open(path, "wx", FILE_MODE);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(path);
      throw error;
    }
    await handle.close();
    return path;
  }
  /** Publish a fully written file with link(2), which fails rather than replacing an existing record. */
  private async publish(directory: string, path: string, record: UsdtBoundOperation, acceptExisting = false): Promise<void> {
    const temp = await this.writeCompleteTemp(directory, record);
    try {
      try { await link(temp, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await this.syncDirectory(directory);
      const found = await this.readRecord(path);
      if (found === null || (!acceptExisting && canonicalJson(found) !== canonicalJson(record))) fail("bound_publish_conflict", "APN_IDEMPOTENCY_CONFLICT");
    } finally {
      await unlink(temp);
      await this.syncDirectory(directory);
    }
  }
  private async cleanupOldTemps(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!/^\.pending-[0-9a-f-]{36}$/u.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) fail("bound_pending_file", "APN_STATE_SECURITY");
      const path = join(directory, entry.name);
      let stat;
      try { stat = await lstat(path); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if ((stat.mode & 0o777) !== FILE_MODE || stat.nlink < 1 || stat.nlink > 2) fail("bound_pending_file", "APN_STATE_SECURITY");
      if (Date.now() - stat.mtimeMs > ORPHAN_AGE_MS) {
        try { await unlink(path); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  }
  async load(profileHash: string, operationId: string): Promise<UsdtBoundOperation | null> {
    const path = this.path(profileHash, operationId);
    if (!await this.dir(this.root, false) || !await this.dir(this.directory, false) || !await this.dir(this.profilePath(profileHash), false)) return null;
    const record = await this.readRecord(path);
    if (record !== null) {
      if (record.profileHash !== profileHash || record.operationId !== operationId) fail("bound_path_binding");
      return record;
    }
    // A process may have crashed after claiming the key and before publishing the final copy.
    if (!await this.dir(this.claimsPath(), false)) return null;
    for (const entry of await readdir(this.claimsPath(), { withFileTypes: true })) {
      if (/^\.pending-/u.test(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) fail("bound_claim_inventory");
      const claimed = await this.readRecord(join(this.claimsPath(), entry.name));
      if (claimed === null || entry.name !== `${hashObject({ schemaVersion: USDT_BOUND_OPERATION_SCHEMA,
        idempotencyKey: claimed.idempotencyKey })}.json`) fail("bound_claim_binding");
      if (claimed.profileHash === profileHash && claimed.operationId === operationId) return claimed;
    }
    return null;
  }
  async create(profileHash: string, binding: UsdtPolicyPrepared, idempotencyKey: string, now: Date): Promise<UsdtBoundOperation> {
    if (!HASH.test(profileHash) || !KEY.test(idempotencyKey) || !Number.isFinite(now.getTime())) fail("bound_input", "APN_INVALID_INPUT");
    const saved = serializable(binding) as Persisted<UsdtPolicyPrepared>;
    await this.dir(this.root, true); await this.dir(this.directory, true); await this.dir(this.profilePath(profileHash), true);
    await this.dir(this.claimsPath(), true);
    await this.cleanupOldTemps(this.profilePath(profileHash));
    await this.cleanupOldTemps(this.claimsPath());
    const claimPath = this.claimPath(idempotencyKey);
    let record = await this.readClaim(idempotencyKey);
    if (record === null) {
      const operationId = hashObject({ schemaVersion: USDT_BOUND_OPERATION_SCHEMA, profileHash, idempotencyKey, bindingHash: saved.bindingHash });
      const draft = { schemaVersion: USDT_BOUND_OPERATION_SCHEMA, operationId, profileHash, idempotencyKey, binding: saved,
        createdAt: now.toISOString(), signerBoundary: "unavailable" as const, dispatch: "disabled" as const, usageReservation: "disabled" as const };
      const candidate = validateUsdtBoundOperation({ ...draft, integrityHash: hashObject(draft) });
      await this.publish(this.claimsPath(), claimPath, candidate, true);
      record = await this.readClaim(idempotencyKey);
      if (record === null) fail("bound_claim_missing");
    }
    if (record.profileHash !== profileHash || canonicalJson(record.binding) !== canonicalJson(saved)) fail("bound_idempotency", "APN_IDEMPOTENCY_CONFLICT");
    await this.publish(this.profilePath(profileHash), this.path(profileHash, record.operationId), record);
    return record;
  }
}

/** Classification reads only. Drift or revocation never advances the operation or authorizes an effect. */
export async function classifyUsdtBoundRecovery(operation: UsdtBoundOperation, port: UsdtPreparePort): Promise<UsdtBoundRecovery> {
  const b = operation.binding;
  try {
    const now = port.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { state: "recovery_required", reason: "clock_unavailable", operation };
    if (BigInt(Math.floor(now.getTime() / 1000)) >= decodeUsdtPaymasterData(b.paymasterData).validUntil) {
      return { state: "capability_unavailable", reason: "paymaster_expired", operation };
    }
    const active = await port.activePolicy(b.profile);
    if (active === null || active.digest !== active.registry.policyDigest || active.digest !== b.policyDigest || active.revision !== b.policyRevision ||
      active.activationDigest !== b.activationDigest || active.accounts.evm !== b.plan.request.sender) {
      return { state: "capability_unavailable", reason: "policy_revoked_or_changed", operation };
    }
    const usage = await port.dailyUsage(b.plan.request.sender, now);
    const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token },
      rail: "gasless", amountAtomic: b.plan.request.grossAtomic.toString(), dailyUsageAtomic: usage,
      asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    if (admission.asset.mechanismPins?.gasless === undefined ||
      canonicalJson(admission.asset.mechanismPins.gasless) !== canonicalJson(USDT_GASLESS.mechanism)) {
      return { state: "capability_unavailable", reason: "policy_mechanism_changed", operation };
    }
    const snapshot = await port.safeSnapshot(b.plan.request.sender);
    if (snapshot.chainId !== 1n || snapshot.blockNumber < BigInt(b.safeBlockNumber) ||
      snapshot.account.entryPointNonce !== BigInt(b.account.entryPointNonce) ||
      snapshot.account.eoaNonce !== BigInt(b.account.eoaNonce) || snapshot.account.delegation !== b.account.delegation ||
      snapshot.account.usdtBalanceAtomic < BigInt(b.plan.request.grossAtomic)) {
      return { state: "capability_unavailable", reason: "chain_state_drift", operation };
    }
    if (snapshot.blockNumber !== BigInt(b.safeBlockNumber) || snapshot.blockHash !== b.safeBlockHash) {
      return { state: "recovery_required", reason: "safe_block_changed", operation };
    }
    return { state: "prepared", operation };
  } catch (error) {
    if (error instanceof ApnError && error.code === "APN_ALLOWLIST_REFUSED") return { state: "capability_unavailable", reason: "policy_revoked_or_changed", operation };
    return { state: "recovery_required", reason: "read_unavailable", operation };
  }
}
