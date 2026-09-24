import { open } from "node:fs/promises";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { validateUsdtBoundOperation, type UsdtBoundOperation } from "./bound-operation.js";
import { USDT_GASLESS } from "./model.js";
import { decodeUsdtPaymasterData, validateUsdtPaymasterData } from "./paymaster-data.js";
import type { UsdtPreparePort } from "./policy-prepare.js";

export const USDT_EXECUTION_SCHEMA = "apn.gasless-usdt-execution.v1" as const;
export type UsdtExecutionState = "planned" | "reserved" | "submitting" | "unknown_finality";
export interface UsdtExecutionIntent {
  readonly operationId: string;
  readonly profileHash: string;
  readonly bindingHash: string;
  readonly policyDigest: string;
  readonly policyRevision: number;
  readonly activationDigest: string;
  readonly sender: string;
  readonly smartAccount: string;
  readonly recipient: string;
  readonly entryPointNonce: string;
  readonly eoaNonce: string;
  readonly safeBlockNumber: string;
  readonly safeBlockHash: string;
  readonly quoteHash: string;
  readonly paymasterValidUntil: string;
  readonly maxFeeAtomic: string;
}
export interface UsdtExecutionRecord extends UsdtExecutionIntent {
  readonly schemaVersion: typeof USDT_EXECUTION_SCHEMA;
  readonly reservationId: string;
  readonly state: UsdtExecutionState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly integrityHash: string;
}
const HASH = /^[a-f0-9]{64}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const STATES: readonly UsdtExecutionState[] = ["planned", "reserved", "submitting", "unknown_finality"];
function fail(reason: string, code: "APN_OPERATION_BLOCKED" | "APN_STATE_CORRUPT" | "APN_IDEMPOTENCY_CONFLICT" = "APN_OPERATION_BLOCKED"): never {
  throw new ApnError(code, `Gasless USDT execution refused: ${reason}.`, { rail: "gasless_usdt", reason });
}
function identity(sender: string): AssetUsageIdentity {
  return { account: sender, chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token } };
}
function usageKey(operationId: string): string { return `gasless-usdt-execution:${operationId}`; }
function recordBody(record: UsdtExecutionRecord): Omit<UsdtExecutionRecord, "integrityHash"> {
  const { integrityHash: _ignored, ...body } = record; return body;
}
function seal(body: Omit<UsdtExecutionRecord, "integrityHash">): UsdtExecutionRecord {
  return { ...body, integrityHash: hashObject(body) };
}
function instant(now: Date): string {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("clock_invalid");
  return now.toISOString();
}
function expected(bound: UsdtBoundOperation): UsdtExecutionIntent {
  const b = bound.binding, request = b.plan.request;
  return { operationId: bound.operationId, profileHash: bound.profileHash, bindingHash: b.bindingHash,
    policyDigest: b.policyDigest, policyRevision: b.policyRevision, activationDigest: b.activationDigest,
    sender: request.sender, smartAccount: b.unsignedOperation.sender, recipient: request.recipient,
    entryPointNonce: b.account.entryPointNonce, eoaNonce: b.account.eoaNonce,
    safeBlockNumber: b.safeBlockNumber, safeBlockHash: b.safeBlockHash,
    quoteHash: hashObject({ quote: b.plan.quote, price: b.plan.price, paymasterData: b.paymasterData,
      unsignedOperation: b.unsignedOperation }),
    paymasterValidUntil: decodeUsdtPaymasterData(b.paymasterData).validUntil.toString(),
    maxFeeAtomic: request.maxFeeAtomic };
}
function exactIntent(record: UsdtExecutionRecord): UsdtExecutionIntent {
  const { schemaVersion: _schema, reservationId: _reservation, state: _state, createdAt: _created,
    updatedAt: _updated, integrityHash: _integrity, ...intent } = record;
  return intent;
}
export function validateUsdtExecutionRecord(value: unknown): UsdtExecutionRecord {
  const keys = ["schemaVersion", "reservationId", "state", "createdAt", "updatedAt", "integrityHash",
    "operationId", "profileHash", "bindingHash", "policyDigest", "policyRevision", "activationDigest", "sender",
    "smartAccount", "recipient", "entryPointNonce", "eoaNonce", "safeBlockNumber", "safeBlockHash", "quoteHash",
    "paymasterValidUntil", "maxFeeAtomic"];
  if (!isPlainRecord(value) || !exactKeys(value, keys) || value.schemaVersion !== USDT_EXECUTION_SCHEMA ||
    !STATES.includes(value.state as UsdtExecutionState) ||
    [value.operationId, value.profileHash, value.bindingHash, value.policyDigest, value.activationDigest,
      value.quoteHash, value.integrityHash].some(v => typeof v !== "string" || !HASH.test(v)) ||
    typeof value.reservationId !== "string" || !HASH.test(value.reservationId) ||
    !Number.isSafeInteger(value.policyRevision) || (value.policyRevision as number) < 1 ||
    [value.entryPointNonce, value.eoaNonce, value.safeBlockNumber, value.paymasterValidUntil, value.maxFeeAtomic]
      .some(v => typeof v !== "string" || !DECIMAL.test(v)) ||
    typeof value.sender !== "string" || typeof value.smartAccount !== "string" || value.sender !== value.smartAccount ||
    typeof value.recipient !== "string" || typeof value.safeBlockHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(value.safeBlockHash) ||
    typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt || new Date(value.updatedAt).toISOString() !== value.updatedAt ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt)) fail("execution_record_shape", "APN_STATE_CORRUPT");
  const record = value as unknown as UsdtExecutionRecord;
  if (record.reservationId !== assetUsageReservationId(identity(record.sender), usageKey(record.operationId)) ||
    record.integrityHash !== hashObject(recordBody(record))) fail("execution_record_integrity", "APN_STATE_CORRUPT");
  return record;
}

/** Separate v1 effect journal. It cannot sign or send; each phase is fsynced before returning. */
export class UsdtExecutionJournal extends SecureStateStore {
  private readonly usage: AssetUsageLedger;
  constructor(root: string) { super(root); this.usage = new AssetUsageLedger(root); }
  private path(operationId: string): string {
    if (!HASH.test(operationId)) fail("operation_id_invalid");
    return `gasless-usdt-executions/${operationId}.json`;
  }
  private lock(operationId: string): string { return `gasless-usdt-execution:${operationId}`; }
  async load(operationId: string): Promise<UsdtExecutionRecord | null> {
    if (!HASH.test(operationId)) fail("operation_id_invalid");
    const value = await this.readJson(this.path(operationId));
    if (value === null) return null;
    const record = validateUsdtExecutionRecord(value);
    if (record.operationId !== operationId) fail("execution_path_binding", "APN_STATE_CORRUPT");
    return record;
  }
  private async ready(): Promise<void> {
    await this.initialize();
    await this.ensureDirectory("gasless-usdt-executions");
    // ensureDirectory checks the new child but does not persist its name in the root.
    // Never reserve usage until that parent directory entry is durable. Repeat this
    // sync on retries after a crash between mkdir and fsync.
    try { await this.syncExecutionDirectoryParent(); }
    catch { fail("execution_directory_sync_unavailable"); }
  }
  protected async syncExecutionDirectoryParent(): Promise<void> {
    const handle = await open(this.root, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  private async write(record: UsdtExecutionRecord, createOnly = false): Promise<void> {
    await this.writeJson(this.path(record.operationId), record, createOnly);
  }
  private async guard(bound: UsdtBoundOperation, port: UsdtPreparePort): Promise<{ now: Date; registry: unknown }> {
    validateUsdtBoundOperation(bound);
    const b = bound.binding, at = port.now(); instant(at);
    const payload = decodeUsdtPaymasterData(b.paymasterData);
    if (BigInt(Math.floor(at.getTime() / 1000)) + 60n > payload.validUntil || payload.validAfter > BigInt(Math.floor(at.getTime() / 1000))) fail("paymaster_expired");
    // Reconstruct the quoted maximum from the signed payload; the fee cap remains the owner's exact bound.
    const plan = { ...b.plan, request: { ...b.plan.request, grossAtomic: BigInt(b.plan.request.grossAtomic),
      maxFeeAtomic: BigInt(b.plan.request.maxFeeAtomic), minReceivedAtomic: BigInt(b.plan.request.minReceivedAtomic) },
      quote: { ...b.plan.quote, postOpGas: BigInt(b.plan.quote.postOpGas), exchangeRate: BigInt(b.plan.quote.exchangeRate),
        exchangeRateNativeToUsd: BigInt(b.plan.quote.exchangeRateNativeToUsd) },
      price: { ...b.plan.price, maxFeePerGas: BigInt(b.plan.price.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(b.plan.price.maxPriorityFeePerGas) },
      gas: Object.fromEntries(Object.entries(b.plan.gas).map(([key, value]) => [key, BigInt(value)])),
      feeCapAtomic: BigInt(b.plan.feeCapAtomic), netAtomic: BigInt(b.plan.netAtomic), quotedFeeAtomic: BigInt(b.plan.quotedFeeAtomic) };
    validateUsdtPaymasterData({ paymaster: USDT_GASLESS.paymaster, paymasterData: b.paymasterData }, plan as never,
      BigInt(Math.floor(at.getTime() / 1000)));
    if (BigInt(b.plan.feeCapAtomic) !== BigInt(b.plan.request.maxFeeAtomic) ||
      BigInt(b.plan.quotedFeeAtomic) > BigInt(b.plan.request.maxFeeAtomic)) fail("fee_bound_changed");
    const active = await port.activePolicy(b.profile);
    if (active === null || active.profile !== b.profile || active.digest !== active.registry.policyDigest ||
      active.digest !== b.policyDigest || active.revision !== b.policyRevision || active.activationDigest !== b.activationDigest ||
      active.accounts.evm !== b.plan.request.sender) fail("policy_changed");
    const snapshot = await port.safeSnapshot(b.plan.request.sender);
    if (snapshot.chainId !== 1n || snapshot.blockNumber.toString() !== b.safeBlockNumber ||
      snapshot.blockHash !== b.safeBlockHash || snapshot.account.entryPointNonce.toString() !== b.account.entryPointNonce ||
      snapshot.account.eoaNonce.toString() !== b.account.eoaNonce || snapshot.account.delegation !== b.account.delegation ||
      snapshot.account.usdtBalanceAtomic.toString() !== b.account.usdtBalanceAtomic) fail("safe_snapshot_changed");
    const usage = await this.usage.usage(identity(b.plan.request.sender), at);
    const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: identity(b.plan.request.sender).asset,
      rail: "gasless", amountAtomic: b.plan.request.grossAtomic, dailyUsageAtomic: usage.amountAtomic,
      asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
    if (admission.asset.mechanismPins?.gasless === undefined ||
      canonicalJson(admission.asset.mechanismPins.gasless) !== canonicalJson(USDT_GASLESS.mechanism)) fail("policy_mechanism_changed");
    return { now: at, registry: active.registry };
  }
  /** Last read fence immediately before the submitting marker. Dispatch must perform its own fresh guard. */
  private async submissionFence(bound: UsdtBoundOperation, port: UsdtPreparePort): Promise<Date> {
    const b = bound.binding;
    const usage = await this.usage.usage(identity(b.plan.request.sender), port.now());
    const active = await port.activePolicy(b.profile);
    // No awaited provider read follows this clock sample before journal publication.
    const at = port.now(); instant(at);
    const nowSeconds = BigInt(Math.floor(at.getTime() / 1000));
    const payload = decodeUsdtPaymasterData(b.paymasterData);
    if (nowSeconds + 60n > payload.validUntil || payload.validAfter > nowSeconds) fail("paymaster_expired");
    if (usage.windowStart.slice(0, 10) !== at.toISOString().slice(0, 10)) fail("usage_window_changed");
    if (active === null || active.profile !== b.profile || active.digest !== active.registry.policyDigest ||
      active.digest !== b.policyDigest || active.revision !== b.policyRevision || active.activationDigest !== b.activationDigest ||
      active.accounts.evm !== b.plan.request.sender) fail("policy_changed");
    const admission = evaluateAssetPolicy(active.registry, { chain: USDT_GASLESS.chain, asset: identity(b.plan.request.sender).asset,
      rail: "gasless", amountAtomic: b.plan.request.grossAtomic, dailyUsageAtomic: usage.amountAtomic,
      asOfDate: at.toISOString().slice(0, 10), asOf: at.toISOString() });
    if (admission.asset.mechanismPins?.gasless === undefined ||
      canonicalJson(admission.asset.mechanismPins.gasless) !== canonicalJson(USDT_GASLESS.mechanism)) fail("policy_mechanism_changed");
    return at;
  }
  /** Create a durable intent, then atomically reserve common usage. Retry repairs only the exact planned intent. */
  async reserve(boundValue: UsdtBoundOperation, intent: UsdtExecutionIntent, port: UsdtPreparePort): Promise<UsdtExecutionRecord> {
    const bound = validateUsdtBoundOperation(boundValue), wanted = expected(bound);
    if (canonicalJson(intent) !== canonicalJson(wanted)) fail("execution_intent_mismatch", "APN_IDEMPOTENCY_CONFLICT");
    await this.ready();
    let current = await this.withLocks([this.lock(bound.operationId)], async () => {
      const found = await this.load(bound.operationId);
      if (found !== null) {
        if (canonicalJson(exactIntent(found)) !== canonicalJson(wanted)) fail("execution_replay_conflict", "APN_IDEMPOTENCY_CONFLICT");
        return found;
      }
      const checked = await this.guard(bound, port);
      const body = { schemaVersion: USDT_EXECUTION_SCHEMA, ...wanted,
        reservationId: assetUsageReservationId(identity(wanted.sender), usageKey(wanted.operationId)),
        state: "planned" as const, createdAt: instant(checked.now), updatedAt: instant(checked.now) };
      const next = seal(body); await this.write(next, true); return next;
    });
    if (current.state !== "planned") return current;
    // The ledger is separately locked. A crash here leaves a planned record and a deterministic reservation to reconcile.
    const checked = await this.guard(bound, port);
    const lease = await this.usage.reserve({ ...identity(wanted.sender), registry: checked.registry, rail: "gasless",
      amountAtomic: bound.binding.plan.request.grossAtomic, idempotencyKey: usageKey(wanted.operationId), now: checked.now });
    if (lease.reservationId !== current.reservationId || lease.policyDigest !== wanted.policyDigest || lease.state !== "reserved") fail("usage_reservation_mismatch", "APN_STATE_CORRUPT");
    current = await this.withLocks([this.lock(bound.operationId)], async () => {
      const found = await this.load(bound.operationId);
      if (found === null || canonicalJson(exactIntent(found)) !== canonicalJson(wanted)) fail("execution_lost", "APN_STATE_CORRUPT");
      if (found.state !== "planned") return found;
      const next = seal({ ...recordBody(found), state: "reserved", updatedAt: instant(checked.now) });
      await this.write(next); return next;
    });
    return current;
  }
  /** Persist the may-have-sent boundary. A retry cannot issue another send from this state. */
  async markSubmitting(boundValue: UsdtBoundOperation, port: UsdtPreparePort): Promise<UsdtExecutionRecord> {
    const bound = validateUsdtBoundOperation(boundValue); await this.ready();
    return this.withLocks([this.lock(bound.operationId)], async () => {
      const current = await this.load(bound.operationId);
      if (current === null || canonicalJson(exactIntent(current)) !== canonicalJson(expected(bound))) fail("execution_binding_changed");
      if (current.state !== "reserved") fail("execution_already_attempted");
      await this.guard(bound, port);
      const lease = await this.usage.load(identity(current.sender), current.reservationId);
      if (lease === null || lease.state !== "reserved" || lease.policyDigest !== current.policyDigest ||
        lease.amountAtomic !== bound.binding.plan.request.grossAtomic) fail("usage_reservation_mismatch");
      const fenced = await this.submissionFence(bound, port);
      const next = seal({ ...recordBody(current), state: "submitting", updatedAt: instant(fenced) });
      await this.write(next); return next;
    });
  }
  /** Explicit uncertainty classification only; there is no send or automatic retry path. */
  async markUnknownFinality(boundValue: UsdtBoundOperation, now: Date): Promise<UsdtExecutionRecord> {
    const bound = validateUsdtBoundOperation(boundValue); await this.ready();
    return this.withLocks([this.lock(bound.operationId)], async () => {
      const current = await this.load(bound.operationId);
      if (current === null || canonicalJson(exactIntent(current)) !== canonicalJson(expected(bound)) || current.state !== "submitting") fail("unknown_finality_source");
      await this.usage.transition({ ...identity(current.sender), reservationId: current.reservationId,
        policyDigest: current.policyDigest, state: "unknown_finality", expectedCurrentStates: ["reserved", "unknown_finality"], now });
      const next = seal({ ...recordBody(current), state: "unknown_finality", updatedAt: instant(now) });
      await this.write(next); return next;
    });
  }
}

/** Build the caller's exact execution intent from an authenticated bound operation. */
export function usdtExecutionIntent(bound: UsdtBoundOperation): UsdtExecutionIntent { return expected(validateUsdtBoundOperation(bound)); }
