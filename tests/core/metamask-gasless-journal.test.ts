import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { canonicalJson, hashObject, sha256 } from "../../src/canonical.js";
import { mmImmutable, type MetaMaskGaslessOperationRecord } from "../../src/metamask-gasless/operation-model.js";
import { mmFailure } from "../../src/metamask-gasless/reasons.js";
import { MetaMaskGaslessOperationRepository } from "../../src/metamask-gasless/journal/repository.js";
import { metaMaskGaslessReceipt, publicMetaMaskGaslessOperation,
  validateMetaMaskGaslessReceipt } from "../../src/metamask-gasless/journal/receipt.js";
import { advanceMetaMaskGaslessOperation, assertMetaMaskGaslessDispatchCapacity,
  assertMetaMaskGaslessObservationCapacity } from "../../src/metamask-gasless/journal/transitions.js";
import { validateMetaMaskGaslessContinuity,
  validateMetaMaskGaslessOperation } from "../../src/metamask-gasless/journal/validation.js";
import { validateDirectory } from "../../src/secure-state-store.js";
import { APPROVED, DISPATCHED, EXPIRES, TX_HASH, approve, complete, makeOperation, mark, unknown } from
  "./metamask-gasless-journal-fixtures/factory.js";

const OPS = "metamask-gasless-operations";
const RECEIPTS = "metamask-gasless-receipts";

async function temporaryRoot(t: { after(action: () => Promise<void>): void }): Promise<string> {
  const base = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-journal-"));
  t.after(async () => await rm(base, { recursive: true, force: true }));
  return join(base, "state");
}

async function writeCanonical(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${canonicalJson(value)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function reseal<T extends Record<string, unknown>>(value: T): T {
  const { integrityHash: _old, ...body } = value;
  return { ...body, integrityHash: hashObject(body) } as unknown as T;
}

function requestIdHash(operation: MetaMaskGaslessOperationRecord): string {
  return hashObject({ purpose: "apn.metamask-gasless.request-id.v1", value: operation.intent.requestId });
}

function failedEffects(operation: MetaMaskGaslessOperationRecord): MetaMaskGaslessOperationRecord {
  const transactionBlock = { numberAtomic: "120", hash: `0x${"cc".repeat(32)}` as const, timestampAtomic: "1788900000" };
  const finalityBlock = { numberAtomic: "150", hash: `0x${"dd".repeat(32)}` as const, timestampAtomic: "1788900000" };
  const at = "2026-09-09T00:02:00.000Z";
  return advanceMetaMaskGaslessOperation(operation, { state: "failed_effects_pending",
    providerObservation: { observedAt: at, requestIdHash: requestIdHash(operation), status: "failed", txHash: TX_HASH },
    cursor: { startBlock: operation.cursor.startBlock, nextBlockAtomic: "151", previousEndBlock: finalityBlock },
    observation: { observedAt: at, phase: "reverted", reason: "mm_gasless_transaction_reverted",
      candidateTxHash: TX_HASH, transactionBlock, finalityBlock, evidenceHash: hashObject({ fixture: "revert" }) },
    failure: mmFailure("mm_gasless_transaction_reverted") }, at);
}

test("strict replay retains the irreversible marker and accepts authenticated completion after expiry", () => {
  const initial = makeOperation();
  assert.deepEqual(validateMetaMaskGaslessOperation(initial), initial);
  assert.equal(validateMetaMaskGaslessOperation(makeOperation("pinned", "key-pinned", undefined, "pinned"))
    .intent.initialSnapshot.safeState.designation, "pinned");
  assertMetaMaskGaslessDispatchCapacity(approve(initial));
  const marked = mark(approve(initial));
  assert.equal(marked.submissionAttempts, 1);
  assert.equal(marked.dispatchStartedAt, DISPATCHED);
  assertMetaMaskGaslessObservationCapacity(marked);
  const guarded = unknown(marked), completed = complete(guarded, "2026-09-09T00:10:00.000Z");
  assert.ok(Date.parse(completed.updatedAt) > Date.parse(EXPIRES));
  assert.equal(completed.state, "completed");
  assert.equal(publicMetaMaskGaslessOperation(completed).transaction_hash, TX_HASH);
  assert.equal(publicMetaMaskGaslessOperation(completed).proof_class, "rpc_safe_correlated");
  assert.throws(() => advanceMetaMaskGaslessOperation(marked,
    { submissionAttempts: 0, dispatchStartedAt: null }, "2026-09-09T00:01:01.000Z"), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => advanceMetaMaskGaslessOperation(guarded, { state: "failed_before_effect",
    failure: mmFailure("mm_gasless_expired") }, "2026-09-09T00:06:00.000Z"), { code: "APN_STATE_CORRUPT" });
});

test("failed-effects precedence remains guarded until a later full success", () => {
  const failed = failedEffects(mark(approve(makeOperation())));
  assert.equal(failed.state, "failed_effects_pending");
  assert.throws(() => advanceMetaMaskGaslessOperation(failed, { state: "submitted_pending",
    providerObservation: { observedAt: "2026-09-09T00:03:00.000Z", requestIdHash: requestIdHash(failed),
      status: "confirmed", txHash: TX_HASH }, observation: { observedAt: "2026-09-09T00:03:00.000Z",
      phase: "pending", reason: "mm_gasless_pending", candidateTxHash: TX_HASH, transactionBlock: null,
      finalityBlock: null, evidenceHash: null }, failure: mmFailure("mm_gasless_pending") },
  "2026-09-09T00:03:00.000Z"), { code: "APN_STATE_CORRUPT" });
  const providerConfirmed = advanceMetaMaskGaslessOperation(failed, { providerObservation: {
    observedAt: "2026-09-09T00:03:00.000Z", requestIdHash: requestIdHash(failed), status: "confirmed", txHash: TX_HASH },
    observation: { observedAt: "2026-09-09T00:03:00.000Z", phase: "unavailable",
      reason: "mm_gasless_rpc_unavailable", candidateTxHash: TX_HASH, transactionBlock: null,
      finalityBlock: null, evidenceHash: null } }, "2026-09-09T00:03:00.000Z");
  assert.equal(providerConfirmed.state, "failed_effects_pending");
  const retainedUnavailable = advanceMetaMaskGaslessOperation(providerConfirmed, { providerObservation: {
    observedAt: "2026-09-09T00:04:00.000Z", requestIdHash: requestIdHash(failed), status: "unavailable", txHash: TX_HASH },
    observation: { observedAt: "2026-09-09T00:04:00.000Z", phase: "reorg",
      reason: "mm_gasless_scan_reorg", candidateTxHash: TX_HASH, transactionBlock: null,
      finalityBlock: null, evidenceHash: null } }, "2026-09-09T00:04:00.000Z");
  assert.equal(retainedUnavailable.state, "failed_effects_pending");
  assert.throws(() => advanceMetaMaskGaslessOperation(mark(approve(makeOperation("new"))), {
    state: "unknown_finality", providerObservation: { observedAt: "2026-09-09T00:02:00.000Z",
      requestIdHash: requestIdHash(makeOperation("new")), status: "unavailable", txHash: TX_HASH },
    failure: mmFailure("mm_gasless_provider_unavailable") }, "2026-09-09T00:02:00.000Z"),
  { code: "APN_STATE_CORRUPT" });
  assert.equal(complete(retainedUnavailable).state, "completed");
});

test("exact nested schemas, registry identity, hashes, and transition reconstruction fail closed", () => {
  const initial = makeOperation(), later = unknown(mark(approve(initial)));
  const nested = structuredClone(initial) as unknown as Record<string, unknown>;
  (nested.intent as Record<string, unknown>).privateKey = "synthetic-secret";
  assert.throws(() => validateMetaMaskGaslessOperation(reseal(nested)), { code: "APN_STATE_CORRUPT" });

  const foreignRegistry = structuredClone(initial) as unknown as Record<string, unknown>;
  (foreignRegistry.intent as Record<string, unknown>).deploymentEvidenceHash = "f".repeat(64);
  foreignRegistry.fingerprint = hashObject(mmImmutable(foreignRegistry as unknown as MetaMaskGaslessOperationRecord));
  assert.throws(() => validateMetaMaskGaslessOperation(reseal(foreignRegistry)), { code: "APN_STATE_CORRUPT" });

  const truncated = structuredClone(later) as unknown as Record<string, unknown>;
  truncated.transitions = (truncated.transitions as unknown[]).slice(0, -1);
  assert.throws(() => validateMetaMaskGaslessOperation(reseal(truncated)), { code: "APN_STATE_CORRUPT" });
  const reordered = structuredClone(later) as unknown as Record<string, unknown>;
  reordered.transitions = [...(reordered.transitions as unknown[])].reverse();
  assert.throws(() => validateMetaMaskGaslessOperation(reseal(reordered)), { code: "APN_STATE_CORRUPT" });
  const extra = structuredClone(initial) as unknown as Record<string, unknown>;
  extra.unknown = null;
  assert.throws(() => validateMetaMaskGaslessOperation(reseal(extra)), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateMetaMaskGaslessContinuity(initial, makeOperation("fixture", "key-2")),
    { code: "APN_STATE_CORRUPT" });
});

test("operation-first persistence survives a fresh repository and repairs only valid historical receipts", async t => {
  const root = await temporaryRoot(t), repository = new MetaMaskGaslessOperationRepository(root);
  const initial = makeOperation(), approved = approve(initial), marked = mark(approved);
  await repository.persist(initial);
  await repository.persist(approved);
  const historical = await repository.loadReceipt(initial.profileHash, initial.operationId);
  assert.equal(historical.operation_binding_hash, approved.integrityHash);
  await repository.writeOperation(marked); // injected crash boundary: authoritative operation only

  const fresh = new MetaMaskGaslessOperationRepository(root);
  assert.equal((await fresh.loadOperation(marked.profileHash, marked.operationId))?.submissionAttempts, 1);
  await assert.rejects(() => fresh.loadReceipt(marked.profileHash, marked.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(validateMetaMaskGaslessReceipt(historical, marked), historical);
  await fresh.repairReceipt(marked);
  assert.deepEqual(await fresh.loadReceipt(marked.profileHash, marked.operationId), metaMaskGaslessReceipt(marked));

  const receiptPath = join(root, RECEIPTS, marked.profileHash, `${marked.operationId}.json`);
  const corrupt = { ...metaMaskGaslessReceipt(marked), profile: "other" };
  const { receipt_hash: _old, ...body } = corrupt;
  await writeCanonical(receiptPath, { ...body, receipt_hash: hashObject(body) });
  const bytes = await readFile(receiptPath, "utf8");
  await assert.rejects(() => fresh.repairReceipt(marked), { code: "APN_STATE_CORRUPT" });
  assert.equal(await readFile(receiptPath, "utf8"), bytes);
});

test("repository namespaces reject malformed, symbolic-link, foreign-owner, oversized, and duplicate identities", async t => {
  const root = await temporaryRoot(t), repository = new MetaMaskGaslessOperationRepository(root), first = makeOperation();
  await repository.persist(first);
  const operationsRoot = join(root, OPS);
  await mkdir(join(operationsRoot, "malformed"), { mode: 0o700 });
  await assert.rejects(() => repository.listAllOperations(), { code: "APN_STATE_CORRUPT" });
  await rm(join(operationsRoot, "malformed"), { recursive: true });

  await symlink(await realpath(tmpdir()), join(operationsRoot, "f".repeat(64)));
  await assert.rejects(() => repository.listAllOperations(), { code: "APN_STATE_CORRUPT" });
  await rm(join(operationsRoot, "f".repeat(64)));

  const malformedId = "e".repeat(64), malformedPath = join(operationsRoot, first.profileHash, `${malformedId}.json`);
  await writeFile(malformedPath, "{not-json}\n", { mode: 0o600 });
  await assert.rejects(() => repository.loadOperation(first.profileHash, malformedId), { code: "APN_STATE_CORRUPT" });
  await rm(malformedPath);
  await writeFile(malformedPath, JSON.stringify({ payload: "x".repeat(1024 * 1024) }), { mode: 0o600 });
  await assert.rejects(() => repository.loadOperation(first.profileHash, malformedId), { code: "APN_STATE_CORRUPT" });
  await rm(malformedPath);

  const fakeForeign = { isDirectory: () => true, isSymbolicLink: () => false,
    uid: (process.geteuid?.() ?? 0) + 1, mode: 0o40700 } as unknown as Stats;
  assert.throws(() => validateDirectory(fakeForeign, true), { code: "APN_STATE_SECURITY" });

  const duplicateOperation = makeOperation("other-profile", "other-key", first.operationId);
  await assert.rejects(() => repository.writeOperation(duplicateOperation), { code: "APN_STATE_CORRUPT" });
  const duplicateKey = makeOperation("other-profile", "key-1");
  await assert.rejects(() => repository.writeOperation(duplicateKey), { code: "APN_STATE_CORRUPT" });
});

test("history exhaustion preserves the last durable guarded operation and rejects unpersisted completion", async t => {
  const root = await temporaryRoot(t), repository = new MetaMaskGaslessOperationRepository(root);
  let operation = unknown(mark(approve(makeOperation())));
  let millis = Date.parse(operation.updatedAt);
  while (operation.transitions.length < 96) {
    millis += 1_000;
    operation = unknown(operation, new Date(millis).toISOString());
  }
  assert.equal(operation.transitions.length, 96);
  await repository.listAllOperations();
  await writeCanonical(join(root, OPS, operation.profileHash, `${operation.operationId}.json`), operation);
  await repository.repairReceipt(operation);
  assert.throws(() => assertMetaMaskGaslessObservationCapacity(operation),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "mm_gasless_record_capacity" } });
  assert.throws(() => complete(operation, new Date(millis + 1_000).toISOString()),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "mm_gasless_record_capacity" } });
  const fresh = new MetaMaskGaslessOperationRepository(root), loaded = await fresh.loadOperation(operation.profileHash, operation.operationId);
  assert.equal(loaded?.state, "unknown_finality");
  assert.equal(loaded?.submissionAttempts, 1);
  assert.equal(loaded?.transitions.length, 96);
});
