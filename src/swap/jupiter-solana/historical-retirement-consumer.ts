import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson, domainHash, hashObject } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { AllowlistPolicyStore } from "../../allowlist-policy-store.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import { allowlistProfileHash } from "../../allowlist-policy-overlay.js";
import { sumUsage, validateAssetUsageReservation } from "../../asset-usage-ledger-record.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { SecureStateStore, isCode } from "../../secure-state-store.js";
import { StateStore } from "../../state.js";
import { SolanaRpc, SolanaRpcBudget } from "../../solana/rpc.js";
import { solanaHttpsFetch } from "../../solana/https.js";
import { SolanaRpcPacer } from "../../solana/pacing.js";
import { verifySignedJupiterV1Transaction, validateJupiterV1ExecutionBinding } from "./v1-effects.js";
import { validateJupiterV1Material, validateJupiterV1PreparedMaterial } from "./v1-material.js";
import { assertHistoricalOrdinaryRecentBlockhash } from "./historical-wire.js";
import { adaptJupiterFutureInvalidityReadPort, verifyJupiterCanonicalFutureInvalidity,
  type JupiterFutureInvalidityWitness } from "./canonical-future-invalidity.js";
import { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
import { SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT } from "./catalog.js";
import { HISTORICAL_RETIREMENT_IDENTITY, HISTORICAL_RETIREMENT_NAMESPACE,
  assertHistoricalRetirementBindings, hashBucket, historicalRetirementUsage,
  sealHistoricalRetirementRecord, validateHistoricalRetirementRecord,
  type HistoricalRetirementCanonicalWitness, type HistoricalRetirementRecord } from "./historical-retirement-record.js";
import { calculateHistoricalRetirementPolicy } from "./historical-retirement-policy.js";
import { historicalRetirementRootSnapshot, JupiterHistoricalRetirementReader } from "./historical-retirement-reader.js";
import type { HistoricalDirectoryGuard } from "./historical-authentication-readers.js";
import { assertOwnedJupiterRetirementScope, claimOwnedJupiterRetirementScope,
  type OwnedJupiterHistoricalRetirementAuthority, type OwnedJupiterHistoricalRetirementContext,
  type JupiterHistoricalRetirementPublicResult } from "./historical-retirement-owner.js";
import { SwapOperationRepository } from "../repository.js";
import { validateSwapOperation } from "../model.js";

const PROFILE = "solana-local";
const JOURNAL_NAMESPACE = "jupiter-historical-retirement-journals";
const RECEIPT_NAMESPACE = "jupiter-historical-retirement-receipts";
const JOURNAL_SCHEMA = "apn.jupiter-historical-retirement-journal.v1" as const;
const RECEIPT_SCHEMA = "apn.jupiter-historical-retirement-receipt.v1" as const;
const RPC_ORIGINS = Object.freeze(["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"] as const);
const MAX_RPC_PHYSICAL_POSTS = 64 as const;
const NATIVE_IDENTITY = HISTORICAL_RETIREMENT_IDENTITY;
const USDC_IDENTITY: AssetUsageIdentity = Object.freeze({
  account: HISTORICAL_RETIREMENT_IDENTITY.account,
  chain: `solana:${SOLANA_MAINNET_GENESIS}`,
  asset: Object.freeze({ kind: "token", identifier: SOLANA_USDC_MINT }),
});

interface RetirementJournal {
  readonly schemaVersion: typeof JOURNAL_SCHEMA;
  readonly operationId: string;
  readonly recordHash: string;
  readonly accountingAt: string;
  readonly journalHash: string;
}
interface RetirementReceipt {
  readonly schemaVersion: typeof RECEIPT_SCHEMA;
  readonly operationId: string;
  readonly profile: "solana-local";
  readonly status: "retired_unknown";
  readonly retirementRecordHash: string;
  readonly accountingAt: string;
  readonly conservativeNativeAmount: "6000000";
  readonly additionalAdmissionNativeAmount: "5000000";
  readonly effectAt: null;
  readonly actualNativeFee: null;
  readonly transactionOutcome: "unknown";
  readonly transactionMayHaveBeenSubmitted: true;
  readonly receiptHash: string;
}

/** Create-only, separately namespaced durability after the accounting record commits. */
class HistoricalRetirementStore extends SecureStateStore {
  constructor(root: string, private readonly guard: HistoricalDirectoryGuard) {
    super(root);
  }

  async read(relativePath: string): Promise<unknown | null> {
    await this.guard.check();
    const value = await this.readJson(relativePath);
    await this.pinIfPresent(dirname(relativePath));
    await this.guard.check();
    return value;
  }

  async entries(relativePath: string): Promise<readonly import("node:fs").Dirent[]> {
    await this.guard.check();
    const value = await this.readDirectory(relativePath);
    await this.pinIfPresent(relativePath);
    await this.guard.check();
    return value;
  }

  async createOnly(relativePath: string, value: unknown): Promise<void> {
    const parent = dirname(relativePath);
    await this.guard.check();
    await this.ensureDirectory(parent);
    await this.guard.check([parent]);
    await this.writeJson(relativePath, value, true);
    await this.guard.check([parent]);
  }

  private async pinIfPresent(relativePath: string): Promise<void> {
    if (relativePath === ".") return;
    try {
      await lstat(resolve(this.root, relativePath));
      await this.guard.check([relativePath]);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }
  }
}

/** Read both daily buckets through SecureStateStore while their shared ledger locks are held. */
class HistoricalUsageBucketReader extends SecureStateStore {
  constructor(root: string, private readonly guard: HistoricalDirectoryGuard) {
    super(root);
  }

  async load(identity: AssetUsageIdentity): Promise<readonly AssetUsageReservation[]> {
    const directory = `asset-usage/${hashBucket(identity)}`;
    await this.guard.check(["asset-usage"]);
    const entries = await this.readDirectory(directory);
    await this.pinIfPresent(directory);
    const rows: AssetUsageReservation[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt();
      const value = await this.readJson(`${directory}/${entry.name}`);
      if (value === null) corrupt();
      const row = validateAssetUsageReservation(value);
      if (`${row.reservationId}.json` !== entry.name || row.account !== identity.account || row.chain !== identity.chain ||
          canonicalJson(row.asset) !== canonicalJson(identity.asset)) corrupt();
      rows.push(row);
    }
    await this.guard.check(["asset-usage"]);
    await this.pinIfPresent(directory);
    return Object.freeze(rows);
  }

  private async pinIfPresent(relativePath: string): Promise<void> {
    try {
      await lstat(resolve(this.root, relativePath));
      await this.guard.check([relativePath]);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }
  }
}

function lockKey(identity: AssetUsageIdentity): string {
  return `asset-usage:${domainHash("apn.asset-usage-lock.v1", canonicalJson(identity))}`;
}

function scopeDeadline(context: OwnedJupiterHistoricalRetirementContext): number {
  const deadline = Date.parse(context.deadline);
  if (!Number.isFinite(deadline) || new Date(deadline).toISOString() !== context.deadline || deadline <= Date.now()) refuse();
  return deadline;
}

async function assertScope(token: OwnedJupiterHistoricalRetirementAuthority,
  context: OwnedJupiterHistoricalRetirementContext): Promise<void> {
  scopeDeadline(context);
  await assertOwnedJupiterRetirementScope(token, context);
  scopeDeadline(context);
}

function assertContext(context: OwnedJupiterHistoricalRetirementContext): void {
  const operation = validateSwapOperation(context.operation);
  if (!HISTORICAL_JUPITER_IDS.some(id => id === operation.operationId) || operation.quote.profile !== PROFILE ||
      operation.ownerProfileHash !== context.projection.ownerProfileHash || operation.integrityHash !== context.projection.operationIntegrityHash ||
      context.projection.rootBinding !== hashObject({ root: context.state.root }) ||
      operation.usageLease === null || context.projection.operationId !== operation.operationId ||
      context.projection.authenticationExpiresAt !== context.deadline || context.binding.operationId !== operation.operationId ||
      context.binding.markerHash !== operation.submissionMarker?.markerHash || context.effect.operationId !== operation.operationId ||
      context.effect.transactionId !== context.projection.signature || context.effect.rawPayloadHash !== context.projection.rawPayloadHash ||
      context.binding.messageHash !== context.projection.messageHash || context.binding.freshMaterialDigest !== context.fresh.materialDigest ||
      context.material.execution.quoteRpcLifetime === undefined || context.material.execution.quoteRpcLifetime.blockhash !== context.projection.blockhash ||
      context.fresh.lifetime.blockhash !== context.projection.freshBlockhash) refuse();
  validateJupiterV1PreparedMaterial(context.material);
  validateJupiterV1Material(context.fresh);
  validateJupiterV1ExecutionBinding(context.binding, operation, context.material);
  assertHistoricalOrdinaryRecentBlockhash(context.effect.rawPayload, context.fresh.rawInstructions);
}

async function activePolicy(root: string, context: OwnedJupiterHistoricalRetirementContext,
  at: Date): Promise<ActiveAssetPolicy> {
  const guard = context.state.directoryGuard(), profileHash = allowlistProfileHash(PROFILE);
  const directories = ["allowlist-policies", "allowlist-activations", `allowlist-policies/${profileHash}`, `allowlist-activations/${profileHash}`];
  await guard.check(directories);
  const state = await new AllowlistPolicyStore(root).readUnderProfileLock(PROFILE);
  await guard.check(directories);
  const policy = activeAssetPolicyFromState(state, at);
  if (policy === null || policy.accounts.solana !== NATIVE_IDENTITY.account || policy.registry.expiresAt === undefined ||
      canonicalJson(policy) !== canonicalJson(context.activePolicy) || Date.parse(context.deadline) > Date.parse(policy.registry.expiresAt)) refuse();
  return policy;
}

function canonicalWitness(value: unknown): HistoricalRetirementCanonicalWitness {
  if (value === null || typeof value !== "object" || (value as { outcome?: unknown }).outcome !== "future_invalidity_witness") refuse();
  return value as HistoricalRetirementCanonicalWitness;
}

function journalFor(record: HistoricalRetirementRecord): RetirementJournal {
  const body = { schemaVersion: JOURNAL_SCHEMA, operationId: record.operationId, recordHash: record.recordHash,
    accountingAt: record.accountingAt };
  return Object.freeze({ ...body, journalHash: hashObject(body) });
}

function receiptFor(record: HistoricalRetirementRecord): RetirementReceipt {
  const body = { schemaVersion: RECEIPT_SCHEMA, operationId: record.operationId, profile: PROFILE as "solana-local",
    status: "retired_unknown" as const, retirementRecordHash: record.recordHash, accountingAt: record.accountingAt,
    conservativeNativeAmount: "6000000" as const, additionalAdmissionNativeAmount: "5000000" as const,
    effectAt: null, actualNativeFee: null, transactionOutcome: "unknown" as const,
    transactionMayHaveBeenSubmitted: true as const };
  return Object.freeze({ ...body, receiptHash: hashObject(body) });
}

function validateJournal(value: unknown, expected: RetirementJournal): RetirementJournal {
  if (value === null || typeof value !== "object" || Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected)) corrupt();
  return expected;
}

function validateReceipt(value: unknown, expected: RetirementReceipt): RetirementReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected)) corrupt();
  return expected;
}

async function createOrVerify(store: HistoricalRetirementStore, path: string, expected: RetirementJournal | RetirementReceipt): Promise<void> {
  const existing = await store.read(path);
  if (existing !== null) {
    if ("journalHash" in expected) validateJournal(existing, expected);
    else validateReceipt(existing, expected);
    return;
  }
  await store.createOnly(path, expected);
}

async function finishPostCommit(record: HistoricalRetirementRecord, store: HistoricalRetirementStore,
  checkpoint: () => Promise<void> = async () => {}): Promise<void> {
  await checkpoint();
  await createOrVerify(store, `${JOURNAL_NAMESPACE}/${record.operationId}.json`, journalFor(record));
  await checkpoint();
  await createOrVerify(store, `${RECEIPT_NAMESPACE}/${record.operationId}.json`, receiptFor(record));
  await checkpoint();
}

function publicResult(record: HistoricalRetirementRecord, idempotentRecovered: boolean): JupiterHistoricalRetirementPublicResult {
  return Object.freeze({ operationId: record.operationId, profile: PROFILE, status: "retired_unknown",
    retirementRecordHash: record.recordHash, accountingAt: record.accountingAt,
    conservativeNativeAmount: "6000000", additionalAdmissionNativeAmount: "5000000",
    effectAt: null, actualNativeFee: null, transactionOutcome: "unknown", transactionMayHaveBeenSubmitted: true,
    idempotentRecovered });
}

function bucketRowsOriginal(rows: readonly AssetUsageReservation[], reservationId: string,
  expected: AssetUsageReservation): AssetUsageReservation {
  const row = rows.find(value => value.reservationId === reservationId);
  if (row === undefined || canonicalJson(row) !== canonicalJson(expected)) corrupt();
  return row;
}

async function loadRetirements(root: string, rows: readonly AssetUsageReservation[]): Promise<readonly HistoricalRetirementRecord[]> {
  return await new JupiterHistoricalRetirementReader(root).forBucket(NATIVE_IDENTITY, rows);
}

async function assertNoOrphanPostCommit(store: HistoricalRetirementStore, operationId: string): Promise<void> {
  const journal = await store.read(`${JOURNAL_NAMESPACE}/${operationId}.json`);
  const receipt = await store.read(`${RECEIPT_NAMESPACE}/${operationId}.json`);
  if (journal !== null || receipt !== null) corrupt();
}

async function readRowsAndRetirements(root: string, context: OwnedJupiterHistoricalRetirementContext): Promise<{
  native: readonly AssetUsageReservation[]; usdc: readonly AssetUsageReservation[];
  retirements: readonly HistoricalRetirementRecord[];
}> {
  const guard = context.state.directoryGuard(), buckets = new HistoricalUsageBucketReader(root, guard);
  const native = await buckets.load(NATIVE_IDENTITY), usdc = await buckets.load(USDC_IDENTITY);
  const retirements = await loadRetirements(root, native);
  return { native, usdc, retirements };
}

async function canonicalProof(token: OwnedJupiterHistoricalRetirementAuthority,
  context: OwnedJupiterHistoricalRetirementContext): Promise<HistoricalRetirementCanonicalWitness> {
  await assertScope(token, context);
  const remainingMs = Math.min(60_000, scopeDeadline(context) - Date.now());
  if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) refuse();
  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), remainingMs);
  const wait = async (milliseconds: number): Promise<void> => {
    await assertScope(token, context);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || Date.now() + milliseconds >= scopeDeadline(context)) refuse();
    await new Promise<void>((resolveWait, rejectWait) => {
      const finish = () => { controller.signal.removeEventListener("abort", aborted); resolveWait(); };
      const aborted = () => { clearTimeout(timer); rejectWait(new ApnError("APN_OPERATION_BLOCKED", "Historical Jupiter read deadline expired.")); };
      const timer = setTimeout(finish, milliseconds);
      controller.signal.addEventListener("abort", aborted, { once: true });
    });
    await assertScope(token, context);
  };
  const budget = new SolanaRpcBudget({ maxPhysicalRequests: MAX_RPC_PHYSICAL_POSTS, minimumIntervalMs: 500, wait });
  const pacer = new SolanaRpcPacer(new StateStore(context.state.root), Date.now, wait);
  const deadlineFetch: typeof fetch = (input, init) => {
    const transportSignal = init?.signal === undefined || init.signal === null
      ? controller.signal : AbortSignal.any([init.signal, controller.signal]);
    return solanaHttpsFetch(input, { ...init, signal: transportSignal });
  };
  const providers = RPC_ORIGINS.map(origin => adaptJupiterFutureInvalidityReadPort(new SolanaRpc(origin, deadlineFetch, budget, pacer)));
  try {
    const lifetime = context.material.execution.quoteRpcLifetime;
    if (lifetime === undefined) refuse();
    const compiled = context.fresh.compiledAccounts.filter(value => value.source === "lookup");
    const witness = await verifyJupiterCanonicalFutureInvalidity({
      signedTransactionBase64: context.effect.rawPayload,
      originalQuoteRpcLifetime: lifetime,
      resolvedLookupAddresses: {
        loadedWritable: compiled.filter(value => value.writable).map(value => value.address),
        loadedReadonly: compiled.filter(value => !value.writable).map(value => value.address),
      },
    }, providers, { signal: controller.signal, deadlineMs: remainingMs });
    await assertScope(token, context);
    if (budget.physicalRequests > MAX_RPC_PHYSICAL_POSTS || witness.outcome !== "future_invalidity_witness") refuse();
    return canonicalWitness(witness);
  } finally {
    clearTimeout(stop);
  }
}

/** The accounting record is the sole linearization point; no old operation/lease/receipt is rewritten. */
export async function consumeJupiterHistoricalRetirement(
  token: OwnedJupiterHistoricalRetirementAuthority,
  context: OwnedJupiterHistoricalRetirementContext,
): Promise<JupiterHistoricalRetirementPublicResult> {
  // C1's private phase changes synchronously before this first await yields.
  await claimOwnedJupiterRetirementScope(token, context);
  await assertScope(token, context);
  assertContext(context);
  await verifySignedJupiterV1Transaction(context.effect, context.binding);
  await assertScope(token, context);
  const proof = await canonicalProof(token, context);
  await assertScope(token, context);
  const state = context.state, root = state.root, guard = state.directoryGuard();
  const store = new HistoricalRetirementStore(root, guard);
  const opId = context.operation.operationId;
  const deadline = scopeDeadline(context);
  const lockWaitMs = Math.max(0, Math.min(5_000, deadline - Date.now() - 1));
  const result = await state.withLocks([lockKey(NATIVE_IDENTITY), lockKey(USDC_IDENTITY)], async () => {
    await assertScope(token, context);
    const rootSnapshot = await historicalRetirementRootSnapshot(root);
    await assertScope(token, context);
    const first = await readRowsAndRetirements(root, context);
    await assertScope(token, context);
    if (first.retirements.some(record => record.operationId === opId)) refuse();
    await assertNoOrphanPostCommit(store, opId);
    const currentOperation = await new SwapOperationRepository(root).loadAny(opId);
    if (currentOperation === null || canonicalJson(currentOperation) !== canonicalJson(context.operation)) corrupt();
    const lease = context.operation.usageLease;
    if (lease === null) refuse();
    const originalRow = bucketRowsOriginal(first.native, lease.reservationId, lease);
    const originalHash = await new JupiterHistoricalRetirementReader(root).originalReservationRawHash(NATIVE_IDENTITY, lease.reservationId);
    await assertScope(token, context);
    const finalRows = await readRowsAndRetirements(root, context);
    await assertScope(token, context);
    if (finalRows.retirements.some(record => record.operationId === opId)) refuse();
    const finalOperation = await new SwapOperationRepository(root).loadAny(opId);
    if (finalOperation === null || canonicalJson(finalOperation) !== canonicalJson(context.operation)) corrupt();
    const finalLease = context.operation.usageLease;
    if (finalLease === null) refuse();
    const finalRow = bucketRowsOriginal(finalRows.native, finalLease.reservationId, finalLease);
    const finalRawHash = await new JupiterHistoricalRetirementReader(root).originalReservationRawHash(NATIVE_IDENTITY, finalLease.reservationId);
    await assertScope(token, context);
    const finalAt = new Date();
    const finalPolicy = await activePolicy(root, context, finalAt);
    await assertScope(token, context);
    const finalNativeUsage = historicalRetirementUsage(finalRows.native, finalRows.retirements, finalAt);
    const finalUsdcUsage = sumUsage(finalRows.usdc, finalAt);
    const finalAdmission = calculateHistoricalRetirementPolicy(finalPolicy, opId, finalNativeUsage, finalUsdcUsage,
      context.operation.quote.minimumOutputAtomic, finalAt);
    await assertScope(token, context);
    if (canonicalJson(originalRow) !== canonicalJson(finalRow) || originalHash !== finalRawHash ||
        rootSnapshot !== await historicalRetirementRootSnapshot(root)) corrupt();
    await assertScope(token, context);
    await verifySignedJupiterV1Transaction(context.effect, context.binding);
    assertHistoricalOrdinaryRecentBlockhash(context.effect.rawPayload, context.fresh.rawInstructions);
    const record = sealHistoricalRetirementRecord({
      schemaVersion: "apn.jupiter-historical-retirement.v1", kind: "retired_unknown", operationId: opId,
      ownerProfileHash: context.operation.ownerProfileHash, rootSnapshotHash: rootSnapshot,
      bucketHash: hashBucket(NATIVE_IDENTITY), originalOperation: context.operation,
      originalReservationRawHash: finalRawHash, authentication: context.projection, canonicalProof: proof,
      currentPolicy: { registry: finalPolicy.registry, activationDigest: finalPolicy.activationDigest,
        revision: finalPolicy.revision, activatedAt: finalPolicy.activatedAt },
      policyAdmission: finalAdmission, accountingAt: finalAdmission.accountingAt,
      conservativeTotalAtomic: "6000000", additionalAdmissionAtomic: "5000000",
      historicalOutcome: "unknown", transactionMayHaveBeenSubmitted: true,
      actualNativeFeeAtomic: null, effectAt: null,
    });
    assertHistoricalRetirementBindings(record, rootSnapshot, finalOperation, finalRow, finalRawHash);
    await assertScope(token, context);
    await store.createOnly(`${HISTORICAL_RETIREMENT_NAMESPACE}/${opId}.json`, record);
    await assertScope(token, context);
    await finishPostCommit(record, store, () => assertScope(token, context));
    await assertScope(token, context);
    return publicResult(record, false);
  }, { waitMs: lockWaitMs });
  await assertScope(token, context);
  return result;
}

/** Record-first restart repair. Reads no current policy, private material, RPC or owner key. */
export async function recoverCommittedJupiterHistoricalRetirement(
  operationId: string,
  state: OwnedJupiterHistoricalRetirementContext["state"],
): Promise<JupiterHistoricalRetirementPublicResult | null> {
  if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId)) refuse();
  await state.directoryGuard().check();
  const root = state.root, guard = state.directoryGuard(), store = new HistoricalRetirementStore(root, guard);
  const deadline = Date.now() + 5_000;
  return await state.withLocks([lockKey(NATIVE_IDENTITY)], async () => {
    await guard.check();
    const buckets = new HistoricalUsageBucketReader(root, guard), rows = await buckets.load(NATIVE_IDENTITY);
    const records = await loadRetirements(root, rows);
    const record = records.find(value => value.operationId === operationId);
    if (record === undefined) {
      await assertNoOrphanPostCommit(store, operationId);
      await guard.check();
      return null;
    }
    const rootSnapshot = await historicalRetirementRootSnapshot(root);
    const lease = record.originalOperation.usageLease;
    if (lease === null) corrupt();
    const row = bucketRowsOriginal(rows, lease.reservationId, lease);
    const rawHash = await new JupiterHistoricalRetirementReader(root).originalReservationRawHash(NATIVE_IDENTITY, lease.reservationId);
    const currentOperation = await new SwapOperationRepository(root).loadAny(operationId);
    assertHistoricalRetirementBindings(record, rootSnapshot, currentOperation, row, rawHash);
    await finishPostCommit(record, store);
    await guard.check();
    return publicResult(record, true);
  }, { waitMs: Math.max(0, Math.min(5_000, deadline - Date.now() - 1)) });
}

function corrupt(): never {
  throw new ApnError("APN_STATE_CORRUPT", "Historical Jupiter retirement state is inconsistent or not create-only.");
}
function refuse(): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "The fixed Jupiter historical retirement could not be safely committed.");
}
