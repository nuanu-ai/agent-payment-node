import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson, hashObject, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { AllowlistPolicyStore } from "../../allowlist-policy-store.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import { allowlistProfileHash } from "../../allowlist-policy-overlay.js";
import { sumUsage } from "../../asset-usage-ledger-record.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { SecureStateStore, isCode } from "../../secure-state-store.js";
import { StateStore } from "../../state.js";
import { SolanaRpc, SolanaRpcBudget } from "../../solana/rpc.js";
import { solanaHttpsFetch } from "../../solana/https.js";
import { SolanaRpcPacer } from "../../solana/pacing.js";
import { verifySignedJupiterV1Transaction } from "./v1-effects.js";
import { assertHistoricalOrdinaryRecentBlockhash } from "./historical-wire.js";
import { adaptJupiterFutureInvalidityReadPort, verifyJupiterCanonicalFutureInvalidity,
  type JupiterFutureInvalidityWitness } from "./canonical-future-invalidity.js";
import { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
import { HISTORICAL_RETIREMENT_NAMESPACE,
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
import { PROFILE, NATIVE_IDENTITY, USDC_IDENTITY, assertNoOrphanPostCommit, JOURNAL_NAMESPACE, RECEIPT_NAMESPACE, loadHistoricalUsageBucket, loadHistoricalUsageBuckets, lockKey, assertContext,
  canonicalWitness, journalFor, receiptFor, validateJournal, validateReceipt, publicResult,
  bucketRowsOriginal, lstatOptional, corrupt, refuse, scopeDeadline, loadRetirements, readRowsAndRetirements,
  retirementFileStatValid, projectionFileStatValid, fileStatFacts, decodeRetirementBytes,
  type RetirementPublicationFrame, type RetirementJournal, type RetirementReceipt,
  type RetirementProjectionNamespace, type ProjectionTempCleanup } from "./historical-retirement-validation.js";

const RPC_ORIGINS = Object.freeze(["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"] as const);
const MAX_RPC_PHYSICAL_POSTS = 64 as const;
/** Create-only, separately namespaced durability after the accounting record commits. */
class HistoricalRetirementStore extends SecureStateStore {
  constructor(root: string, private readonly guard: HistoricalDirectoryGuard,
    private readonly publication?: RetirementPublicationFrame) {
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

  protected override async beforeCreateOnlyPublication(relativePath: string, value: unknown): Promise<void> {
    if (!relativePath.startsWith(`${HISTORICAL_RETIREMENT_NAMESPACE}/`)) return;
    const frame = this.publication;
    if (frame === undefined || relativePath !== `${HISTORICAL_RETIREMENT_NAMESPACE}/${frame.record.operationId}.json`) refuse();
    const record = validateHistoricalRetirementRecord(value);
    if (canonicalJson(record) !== canonicalJson(frame.record)) corrupt();
    await assertAccountingPublication(frame.token, frame.context, record);
  }

  /** Reconcile only the exact staged inode that the create-only writer can leave at a crash boundary. */
  async recoverExactAccountingTemp(operationId: string, rows: readonly AssetUsageReservation[]): Promise<void> {
    if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId)) refuse();
    const entries = await this.entries(HISTORICAL_RETIREMENT_NAMESPACE);
    const targetRelative = `${HISTORICAL_RETIREMENT_NAMESPACE}/${operationId}.json`;
    const targetPath = resolve(this.root, targetRelative);
    const prefix = `.${sha256(targetPath).slice(0, 12)}.`;
    const candidates = entries.filter(entry => entry.name.startsWith(prefix));
    if (candidates.length === 0) return;
    if (candidates.length !== 1 || !/^\.[a-f0-9]{12}\.[a-f0-9]{24}\.tmp$/u.test(candidates[0]!.name)) corrupt();
    const temporaryPath = resolve(this.root, HISTORICAL_RETIREMENT_NAMESPACE, candidates[0]!.name);
    const parentPath = dirname(targetPath), parent = await lstat(parentPath, { bigint: true });
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== BigInt(process.geteuid?.() ?? -1) ||
        (parent.mode & 0o777n) !== 0o700n) corrupt();
    const targetStat = await lstatOptional(targetPath);
    const expectedLinks = targetStat === null ? 1n : 2n;
    const temporary = await this.readOwnedRetirementFile(temporaryPath, parent.dev, expectedLinks);
    let record = temporary.record;
    if (targetStat !== null) {
      const target = await this.readOwnedRetirementFile(targetPath, parent.dev, 2n);
      if (targetStat.dev !== target.dev || targetStat.ino !== target.ino || temporary.dev !== target.dev || temporary.ino !== target.ino ||
          !Buffer.from(temporary.bytes).equals(target.bytes) || sha256(temporary.bytes) !== sha256(target.bytes) ||
          canonicalJson(target.record) !== canonicalJson(temporary.record)) corrupt();
      record = target.record;
    }
    if (record.operationId !== operationId || record.authentication.rootBinding !== hashObject({ root: this.root })) corrupt();
    const rootSnapshot = await historicalRetirementRootSnapshot(this.root);
    const lease = record.originalOperation.usageLease;
    if (lease === null) corrupt();
    const row = bucketRowsOriginal(rows, lease.reservationId, lease);
    const operation = await new SwapOperationRepository(this.root).loadAny(operationId);
    const rawHash = await new JupiterHistoricalRetirementReader(this.root).originalReservationRawHash(NATIVE_IDENTITY, lease.reservationId);
    assertHistoricalRetirementBindings(record, rootSnapshot, operation, row, rawHash);
    const latest = await lstat(temporaryPath, { bigint: true });
    if (latest.dev !== temporary.dev || latest.ino !== temporary.ino || latest.nlink !== expectedLinks ||
        latest.uid !== BigInt(process.geteuid?.() ?? -1) || (latest.mode & 0o777n) !== 0o600n || BigInt(latest.size) !== BigInt(temporary.bytes.byteLength)) corrupt();
    await this.guard.check([HISTORICAL_RETIREMENT_NAMESPACE]);
    await unlink(temporaryPath);
    const directory = await open(parentPath, constants.O_RDONLY);
    try { await directory.sync(); }
    finally { await directory.close(); }
    await this.guard.check([HISTORICAL_RETIREMENT_NAMESPACE]);
  }

  /** Recover only the two deterministic projections for a book whose immutable bindings already passed. */
  async recoverExactProjectionTemps(operationId: string, record: HistoricalRetirementRecord): Promise<void> {
    if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId) || record.operationId !== operationId) corrupt();
    const cleanups: ProjectionTempCleanup[] = [];
    for (const [namespace, expected] of [[JOURNAL_NAMESPACE, journalFor(record)], [RECEIPT_NAMESPACE, receiptFor(record)]] as const) {
      const cleanup = await this.inspectProjectionTemp(operationId, namespace, expected);
      if (cleanup !== null) cleanups.push(cleanup);
    }
    for (const cleanup of cleanups) {
      await this.guard.check([cleanup.namespace]);
      const parent = await lstat(cleanup.parentPath, { bigint: true });
      if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== BigInt(process.geteuid?.() ?? -1) ||
          (parent.mode & 0o777n) !== 0o700n || parent.dev !== cleanup.parentDev) corrupt();
      const temp = await this.readOwnedProjectionFile(cleanup.temporaryPath, cleanup.parentDev,
        cleanup.targetIno === null ? 1n : 2n, cleanup.expectedBytes);
      if (temp.dev !== cleanup.tempDev || temp.ino !== cleanup.tempIno) corrupt();
      if (cleanup.targetIno !== null) {
        const target = await this.readOwnedProjectionFile(cleanup.targetPath, cleanup.parentDev, 2n, cleanup.expectedBytes);
        if (target.dev !== temp.dev || target.ino !== temp.ino || target.ino !== cleanup.targetIno ||
            !target.bytes.equals(temp.bytes)) corrupt();
      } else if (await lstatOptional(cleanup.targetPath) !== null) {
        corrupt();
      }
      await this.guard.check([cleanup.namespace]);
      const latestTemp = await lstat(cleanup.temporaryPath, { bigint: true });
      if (latestTemp.dev !== cleanup.tempDev || latestTemp.ino !== cleanup.tempIno ||
          latestTemp.nlink !== (cleanup.targetIno === null ? 1n : 2n)) corrupt();
      await unlink(cleanup.temporaryPath);
      const directory = await open(cleanup.parentPath, constants.O_RDONLY);
      try { await directory.sync(); }
      finally { await directory.close(); }
      await this.guard.check([cleanup.namespace]);
    }
  }

  private async readOwnedRetirementFile(path: string, parentDev: bigint, expectedLinks: bigint): Promise<{
    readonly record: HistoricalRetirementRecord; readonly dev: bigint; readonly ino: bigint;
    readonly bytes: Buffer;
  }> {
    await this.assertNoSymlinkAncestors(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat({ bigint: true });
      const leaf = await lstat(path, { bigint: true });
      const valid = (value: typeof before): boolean => retirementFileStatValid(value, parentDev, expectedLinks);
      if (!valid(before) || !valid(leaf) || fileStatFacts(before) !== fileStatFacts(leaf)) corrupt();
      const bytes = await handle.readFile();
      const after = await lstat(path, { bigint: true });
      await this.assertNoSymlinkAncestors(path);
      if (!valid(after) || fileStatFacts(before) !== fileStatFacts(after) || bytes.byteLength !== Number(before.size)) corrupt();
      const record = decodeRetirementBytes(bytes);
      return { record, dev: before.dev, ino: before.ino, bytes };
    } finally {
      await handle.close();
    }
  }

  private async inspectProjectionTemp(operationId: string, namespace: RetirementProjectionNamespace,
    expected: RetirementJournal | RetirementReceipt): Promise<ProjectionTempCleanup | null> {
    const entries = await this.entries(namespace);
    const parentPath = resolve(this.root, namespace), parent = await lstatOptional(parentPath);
    if (parent === null) {
      if (entries.length !== 0) corrupt();
      return null;
    }
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== BigInt(process.geteuid?.() ?? -1) ||
        (parent.mode & 0o777n) !== 0o700n) corrupt();
    const targetName = `${operationId}.json`, targetPath = resolve(this.root, namespace, targetName);
    const prefix = `.${sha256(targetPath).slice(0, 12)}.`;
    const candidates = entries.filter(entry => entry.name.startsWith(prefix));
    if (candidates.length > 1 || (candidates.length === 1 &&
        (!/^\.[a-f0-9]{12}\.[a-f0-9]{24}\.tmp$/u.test(candidates[0]!.name) ||
          !candidates[0]!.isFile() || candidates[0]!.isSymbolicLink()))) corrupt();
    const targetStat = await lstatOptional(targetPath);
    if ((targetStat === null) !== !entries.some(entry => entry.name === targetName)) corrupt();
    const temporaryEntry = candidates[0];
    for (const entry of entries) {
      if (HISTORICAL_JUPITER_IDS.some(id => `${id}.json` === entry.name)) {
        if (!entry.isFile() || entry.isSymbolicLink()) corrupt();
        const path = resolve(this.root, namespace, entry.name), stats = await lstat(path, { bigint: true });
        const expectedLinks = entry.name === targetName && temporaryEntry !== undefined ? 2n : 1n;
        if (!stats.isFile() || stats.isSymbolicLink() || stats.uid !== BigInt(process.geteuid?.() ?? -1) ||
            (stats.mode & 0o777n) !== 0o600n || stats.dev !== parent.dev || stats.nlink !== expectedLinks ||
            stats.size <= 0n || stats.size > 1_048_576n) corrupt();
      } else if (temporaryEntry === undefined || entry.name !== temporaryEntry.name) {
        // Only this exact operation's writer temp may be ignored. All other entries fail closed.
        corrupt();
      }
    }
    if (temporaryEntry === undefined) return null;
    const expectedBytes = Buffer.from(`${canonicalJson(expected)}\n`, "utf8");
    const temporaryPath = resolve(this.root, namespace, temporaryEntry.name);
    const expectedLinks = targetStat === null ? 1n : 2n;
    const temporary = await this.readOwnedProjectionFile(temporaryPath, parent.dev, expectedLinks, expectedBytes);
    if (targetStat !== null) {
      const target = await this.readOwnedProjectionFile(targetPath, parent.dev, 2n, expectedBytes);
      if (targetStat.dev !== target.dev || targetStat.ino !== target.ino || temporary.dev !== target.dev ||
          temporary.ino !== target.ino || !temporary.bytes.equals(target.bytes)) corrupt();
    }
    return { namespace, targetPath, temporaryPath, parentPath, parentDev: parent.dev,
      tempDev: temporary.dev, tempIno: temporary.ino, targetIno: targetStat?.ino ?? null, expectedBytes };
  }

  private async readOwnedProjectionFile(path: string, parentDev: bigint, expectedLinks: bigint,
    expectedBytes: Buffer): Promise<{ readonly dev: bigint; readonly ino: bigint; readonly bytes: Buffer }> {
    await this.assertNoSymlinkAncestors(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat({ bigint: true }), leaf = await lstat(path, { bigint: true });
      const valid = (value: typeof before): boolean => projectionFileStatValid(value, parentDev, expectedLinks, expectedBytes);
      if (!valid(before) || !valid(leaf) || fileStatFacts(before) !== fileStatFacts(leaf)) corrupt();
      const bytes = await handle.readFile(), after = await lstat(path, { bigint: true });
      await this.assertNoSymlinkAncestors(path);
      if (!valid(after) || fileStatFacts(before) !== fileStatFacts(after) || !bytes.equals(expectedBytes)) corrupt();
      return { dev: before.dev, ino: before.ino, bytes };
    } finally {
      await handle.close();
    }
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

async function assertScope(token: OwnedJupiterHistoricalRetirementAuthority,
  context: OwnedJupiterHistoricalRetirementContext): Promise<void> {
  scopeDeadline(context);
  await assertOwnedJupiterRetirementScope(token, context);
  scopeDeadline(context);
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

async function assertAccountingPublication(token: OwnedJupiterHistoricalRetirementAuthority,
  context: OwnedJupiterHistoricalRetirementContext, record: HistoricalRetirementRecord): Promise<void> {
  await assertScope(token, context);
  if (record.operationId !== context.operation.operationId || record.authentication.rootBinding !== hashObject({ root: context.state.root }) ||
      record.accountingAt.slice(0, 10) !== new Date().toISOString().slice(0, 10)) refuse();
  const root = context.state.root;
  const currentAt = new Date();
  const currentPolicy = await activePolicy(root, context, currentAt);
  await assertScope(token, context);
  if (canonicalJson(record.currentPolicy) !== canonicalJson({ registry: currentPolicy.registry,
      activationDigest: currentPolicy.activationDigest, revision: currentPolicy.revision, activatedAt: currentPolicy.activatedAt })) refuse();
  const rootSnapshot = await historicalRetirementRootSnapshot(root);
  const guard = context.state.directoryGuard();
  const { native, usdc } = await loadHistoricalUsageBuckets(root, guard);
  await guard.check([HISTORICAL_RETIREMENT_NAMESPACE]);
  const retirements = await new JupiterHistoricalRetirementReader(root)
    .forBucketDuringPublication(NATIVE_IDENTITY, native, record);
  await guard.check([HISTORICAL_RETIREMENT_NAMESPACE]);
  const operation = await new SwapOperationRepository(root).loadAny(record.operationId);
  const lease = record.originalOperation.usageLease;
  if (lease === null) corrupt();
  const row = bucketRowsOriginal(native, lease.reservationId, lease);
  if (retirements.some(value => value.operationId === record.operationId)) refuse();
  const accountingAt = new Date(record.accountingAt);
  if (accountingAt.toISOString().slice(0, 10) !== currentAt.toISOString().slice(0, 10)) refuse();
  const nativeUsage = historicalRetirementUsage(native, retirements, accountingAt);
  const usdcUsage = sumUsage(usdc, accountingAt);
  const admission = calculateHistoricalRetirementPolicy(currentPolicy, record.operationId, nativeUsage, usdcUsage,
    record.originalOperation.quote.minimumOutputAtomic, accountingAt);
  if (canonicalJson(admission) !== canonicalJson(record.policyAdmission)) refuse();
  if (rootSnapshot !== record.rootSnapshotHash || operation === null || canonicalJson(operation) !== canonicalJson(record.originalOperation)) corrupt();
  await guard.check([HISTORICAL_RETIREMENT_NAMESPACE, "asset-usage"]);
  await assertScope(token, context);
  const rawHash = await new JupiterHistoricalRetirementReader(root).originalReservationRawHash(NATIVE_IDENTITY, lease.reservationId);
  assertHistoricalRetirementBindings(record, rootSnapshot, operation, row, rawHash);
  // The raw lease hash is deliberately the final asynchronous read before link(2) publication.
  scopeDeadline(context);
  if (record.accountingAt.slice(0, 10) !== new Date().toISOString().slice(0, 10)) refuse();
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
    const accountingStore = new HistoricalRetirementStore(root, guard, { token, context, record });
    await accountingStore.createOnly(`${HISTORICAL_RETIREMENT_NAMESPACE}/${opId}.json`, record);
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
    const rows = await loadHistoricalUsageBucket(root, guard, NATIVE_IDENTITY);
    await store.recoverExactAccountingTemp(operationId, rows);
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
    await store.recoverExactProjectionTemps(operationId, record);
    await finishPostCommit(record, store);
    await guard.check();
    return publicResult(record, true);
  }, { waitMs: Math.max(0, Math.min(5_000, deadline - Date.now() - 1)) });
}
