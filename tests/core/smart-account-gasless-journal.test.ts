import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { canonicalJson, hashObject, sha256 } from "../../src/canonical.js";
import type { Hex } from "../../src/model.js";
import type { SmartAccountGaslessMaterialDescriptor, SmartAccountGaslessMutable } from "../../src/smart-account-gasless/model.js";
import { SA_FILE_LIMIT, saImmutable, saRequestHash, type SmartAccountGaslessOperationRecord } from "../../src/smart-account-gasless/operation-model.js";
import { saMaterialHash, saPolicyHash, saRequirementsHash } from "../../src/smart-account-gasless/integrity.js";
import { saFailure } from "../../src/smart-account-gasless/reasons.js";
import { SmartAccountGaslessOperationRepository } from "../../src/smart-account-gasless/operation-repository.js";
import { publicSmartAccountGaslessOperation, smartAccountGaslessReceipt,
  validateSmartAccountGaslessReceipt } from "../../src/smart-account-gasless/receipt.js";
import { advanceSmartAccountGaslessOperation as advance, assertSmartAccountGaslessCapacity,
  newSmartAccountGaslessOperation, smartAccountGaslessAtTransition, validateSmartAccountGaslessContinuity,
  validateSmartAccountGaslessOperation } from "../../src/smart-account-gasless/transitions.js";
import { SA_TEST_AT, saTestIntent } from "./smart-account-gasless-fixtures.js";

const OPS = "smart-account-gasless-operations", RECEIPTS = "smart-account-gasless-receipts";
const at = (seconds: number) => new Date(Date.parse(SA_TEST_AT) + seconds * 1000).toISOString();
const hx = (n: string): Hex => `0x${n.repeat(64)}`;
const TX = hx("6");
function make(profile = "sa-synthetic", key = "first", operationId?: string): SmartAccountGaslessOperationRecord {
  const original = saTestIntent(), profileHash = sha256(`profile\0${profile}`);
  const binding = { ...original.binding, profileHash };
  const intent = { ...original, profile, binding, policyHash: saPolicyHash(binding, original.request) };
  return newSmartAccountGaslessOperation({ profileHash, operationId: operationId ?? sha256(`operation\0${profile}\0${key}`),
    idempotencyHash: sha256(`idempotency\0${key}`), requestHash: saRequestHash(profileHash, intent) }, intent);
}
/** Structural journal fixtures only; these hashes are not cryptographic SDK or chain acceptance evidence. */
function material(op: SmartAccountGaslessOperationRecord, sealedAt = at(3)): SmartAccountGaslessMaterialDescriptor {
  const hashes = { encodedRootHash: op.intent.binding.encodedRootHash, encodedChildHash: "1".repeat(64),
    permissionContextHash: "2".repeat(64), payloadHash: "3".repeat(64), requirementsHash: saRequirementsHash(op.intent.requirements),
    rootDelegationHash: op.intent.binding.rootDelegationHash, childDelegationHash: hx("4") };
  return { ...hashes, materialHash: saMaterialHash(op.operationId, op.fingerprint, hashes), sealedAt };
}
function stages(initial = make()): SmartAccountGaslessOperationRecord[] {
  const approved = advance(initial, { state: "execution_pending", approval: { fingerprint: initial.fingerprint,
    approvedAt: at(1), expiresAt: initial.intent.expiresAt } }, at(1));
  const signing = advance(approved, { state: "material_pending", signingAttempts: 1 }, at(2));
  const sealed = advance(signing, { state: "material_sealed", material: material(signing) }, at(3));
  const exposed = advance(sealed, { state: "exposure_pending", exposureAttempts: 1, exposureStartedAt: at(4) }, at(4));
  const verified = advance(exposed, { state: "verified_pending", verification: { isValid: true, observedAt: at(5),
    payer: exposed.intent.binding.ownerAddress, responseHash: "5".repeat(64) } }, at(5));
  const dispatch = advance(verified, { state: "dispatch_pending", submissionAttempts: 1, dispatchStartedAt: at(6) }, at(6));
  const submitted = advance(dispatch, { state: "submitted_pending", providerSettlement: { observedAt: at(7),
    transactionHash: TX, responseHash: "6".repeat(64) } }, at(7));
  return [initial, approved, signing, sealed, exposed, verified, dispatch, submitted];
}
function uncertain(op: SmartAccountGaslessOperationRecord, seconds = 8): SmartAccountGaslessOperationRecord {
  return advance(op, { state: "unknown_finality", failure: saFailure("sa_gasless_unknown"),
    observation: { observedAt: at(seconds), phase: "pending", reason: "sa_gasless_unknown",
      candidateTxHash: null, evidenceHash: null } }, at(seconds));
}
function complete(op: SmartAccountGaslessOperationRecord): SmartAccountGaslessOperationRecord {
  const timestamp = op.intent.afterUnix, g = op.intent.request.grossAtomic;
  return advance(op, { state: "completed", failure: null,
    observation: { observedAt: at(600), phase: "success", reason: null, candidateTxHash: TX, evidenceHash: "7".repeat(64) },
    settlement: { observedAt: at(600), source: "rpc_discovered", txHash: TX,
      transactionBlock: { numberAtomic: "50000010", hash: hx("8"), timestampAtomic: String(timestamp + 20) },
      finalityBlock: { numberAtomic: "50000020", hash: hx("9"), timestampAtomic: String(timestamp + 40) },
      finality: "safe", outerSender: op.intent.provider.facilitatorAddresses[0]!, transactionProofHash: "a".repeat(64),
      receiptHash: "b".repeat(64), contextHash: op.material!.permissionContextHash, protocolHash: "c".repeat(64),
      rootDelegationHash: op.material!.rootDelegationHash, childDelegationHash: op.material!.childDelegationHash,
      childSpentAtomic: g, debitAtomic: g, deliveredAtomic: g, feeAtomic: "0", refundAtomic: "0", unusedGrossAtomic: "0",
      ownerNativeDebitWei: "0", sessionNativeDebitWei: "0" } }, at(600));
}
function unused(op: SmartAccountGaslessOperationRecord): SmartAccountGaslessOperationRecord {
  const expiry = { numberAtomic: "50000150", hash: hx("a"), timestampAtomic: String(op.intent.beforeUnix) };
  const cursor = { ...op.cursor, nextBlockAtomic: "50000151", previousEndBlock: expiry, expiryBlock: expiry,
    childScanComplete: true, transferScanComplete: true };
  return advance(op, { state: "expired_unused", failure: null, cursor,
    observation: { observedAt: at(600), phase: "expired_unused", reason: null, candidateTxHash: null, evidenceHash: "8".repeat(64) },
    unusedProof: { observedAt: at(600), startBlock: op.cursor.startBlock, expiryBlock: expiry,
      finalityBlock: { numberAtomic: "50000200", hash: hx("b"), timestampAtomic: String(op.intent.beforeUnix + 100) },
      childDelegationHash: op.material!.childDelegationHash, childSpentAtomic: "0", childScanHash: "a".repeat(64),
      transferScanHash: "b".repeat(64), anchorsHash: "c".repeat(64), protocolHash: "d".repeat(64) } }, at(600));
}
function rewrite(value: SmartAccountGaslessOperationRecord, change: (copy: any) => void): unknown {
  const copy = structuredClone(value) as any; change(copy);
  copy.fingerprint = hashObject(saImmutable(copy));
  let previous = copy.fingerprint;
  for (const t of copy.transitions) {
    t.previousHash = previous;
    const { transitionHash: _hash, ...body } = t;
    t.transitionHash = hashObject(body); previous = t.transitionHash;
  }
  const { integrityHash: _hash, ...body } = copy;
  return { ...body, integrityHash: hashObject(body) };
}
async function root(t: { after(action: () => Promise<void>): void }): Promise<string> {
  const base = await mkdtemp(join(await realpath(tmpdir()), "apn-sa-journal-"));
  t.after(async () => await rm(base, { recursive: true, force: true }));
  return join(base, "state");
}
async function writeCanonical(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${canonicalJson(value)}\n`, { mode: 0o600 }); await chmod(path, 0o600);
}

test("each phase authenticates its full prefix and completion may be observed after expiry without a settle attempt", () => {
  const all = stages();
  for (let index = 0; index < all.length; index++) {
    assert.deepEqual(validateSmartAccountGaslessOperation(all[index]), all[index]);
    assert.deepEqual(smartAccountGaslessAtTransition(all.at(-1)!, index), all[index]);
  }
  assert.equal(all[0]!.transitions[0]!.previousHash, all[0]!.fingerprint);
  assert.notEqual(make().transitions[0]!.transitionHash, make("other").transitions[0]!.transitionHash);
  for (const exposed of all.slice(4)) {
    const done = complete(uncertain(exposed));
    assert.equal(done.submissionAttempts, exposed.submissionAttempts);
    assert.ok(Date.parse(done.updatedAt) > Date.parse(done.intent.expiresAt));
    const dto = publicSmartAccountGaslessOperation(done);
    assert.equal(dto.permission.guard_held, false); assert.equal(dto.proof_class, "rpc_safe_correlated");
    assert.equal(dto.fees.proven_session_native_debit_wei, "0");
    assert.equal(dto.transfer.actual_sender_debit_atomic, "10000");
  }
});
test("late local sealing is recoverable before-effect evidence, and signing or exposure cannot start after expiry", () => {
  const [, approved, signing] = stages();
  assert.throws(() => advance(approved!, { state: "material_pending", signingAttempts: 1 }, at(301)), { code: "APN_STATE_CORRUPT" });
  const late = advance(signing!, { state: "material_sealed", material: material(signing!, at(301)) }, at(301));
  assert.throws(() => advance(late, { state: "exposure_pending", exposureAttempts: 1, exposureStartedAt: at(302) }, at(302)),
    { code: "APN_STATE_CORRUPT" });
  const failed = advance(late, { state: "failed_before_effect", failure: saFailure("sa_gasless_expired") }, at(302));
  assert.equal(publicSmartAccountGaslessOperation(failed).permission.status, "sealed_local");
  assert.equal(publicSmartAccountGaslessOperation(failed).transfer.actual_sender_debit_atomic, "0");
  const missing = advance(signing!, { state: "failed_before_effect", failure: saFailure("sa_gasless_material_unavailable") }, at(302));
  assert.equal(missing.signingAttempts, 1); assert.equal(missing.material, null);
});
test("effect markers cannot roll back, skip a phase, move in time, or acquire provider responses by recovery", () => {
  const [initial, approved, signing, sealed, exposed, verified, dispatch] = stages();
  const invalid: Array<[SmartAccountGaslessOperationRecord, Partial<SmartAccountGaslessMutable>, string]> = [
    [initial!, { state: "material_pending", signingAttempts: 1 }, at(2)],
    [approved!, { state: "material_sealed", signingAttempts: 1, material: material(approved!) }, at(3)],
    [signing!, { state: "execution_pending", signingAttempts: 0 }, at(3)],
    [sealed!, { state: "exposure_pending", exposureAttempts: 1, exposureStartedAt: at(2) }, at(4)],
    [exposed!, { state: "failed_before_effect", exposureAttempts: 0, exposureStartedAt: null,
      failure: saFailure("sa_gasless_expired") }, at(600)],
    [verified!, { state: "dispatch_pending", submissionAttempts: 1, dispatchStartedAt: at(5) }, at(6)],
    [dispatch!, { state: "unknown_finality", submissionAttempts: 0, dispatchStartedAt: null,
      failure: saFailure("sa_gasless_unknown") }, at(8)],
    [uncertain(exposed!), { state: "verified_pending", failure: null, verification: verified!.verification }, at(9)],
  ];
  for (const [op, patch, when] of invalid) assert.throws(() => advance(op, patch, when), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => advance(sealed!, { material: { ...sealed!.material!, materialHash: "f".repeat(64) } }, at(4)),
    { code: "APN_STATE_CORRUPT" });
});
test("complete and unused terminal states require exact bounded proof and reject partial or foreign evidence", () => {
  const exposed = stages()[4]!, terminal = unused(exposed), dto = publicSmartAccountGaslessOperation(terminal);
  assert.equal(dto.proof_class, "rpc_finalized_unused"); assert.equal(dto.fees.unused_gross_atomic, "10000");
  assert.equal(dto.transfer.actual_delivered_atomic, "0"); assert.equal(dto.permission.guard_held, false);
  for (const mutate of [
    (o: any) => { o.cursor.transferScanComplete = false; },
    (o: any) => { o.cursor.transferAnomalies = [TX]; },
    (o: any) => { o.unusedProof.childSpentAtomic = "1"; },
    (o: any) => { o.unusedProof.expiryBlock.timestampAtomic = String(exposed.intent.beforeUnix - 1); },
    (o: any) => { o.unusedProof.childDelegationHash = hx("f"); },
  ]) {
    const invalid = rewrite(terminal, o => { mutate(o); mutate(o.transitions.at(-1)); });
    assert.throws(() => validateSmartAccountGaslessOperation(invalid), { code: "APN_STATE_CORRUPT" });
  }
  for (const key of ["debitAtomic", "deliveredAtomic", "feeAtomic", "ownerNativeDebitWei", "sessionNativeDebitWei"])
    assert.throws(() => validateSmartAccountGaslessOperation(rewrite(complete(exposed), o => {
      o.settlement[key] = "1"; o.transitions.at(-1).settlement[key] = "1";
    })), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => advance(exposed, { state: "completed" }, at(600)), { code: "APN_STATE_CORRUPT" });
});
test("deep exact schemas and legal history reject corruption even with all unkeyed hashes recomputed", () => {
  const op = stages()[5]!;
  for (const mutate of [
    (o: any) => { o.privateKey = "synthetic-secret"; },
    (o: any) => { o.intent.binding.sessionSecret = "synthetic-secret"; },
    (o: any) => { o.verification.secret = "synthetic-secret"; o.transitions.at(-1).verification.secret = "synthetic-secret"; },
    (o: any) => { o.transitions.splice(2, 1); },
    (o: any) => { o.transitions[3].material.sealedAt = at(0); o.material.sealedAt = at(0); },
    (o: any) => { o.transitions[0].cursor.nextBlockAtomic = "49999980"; },
    (o: any) => { o.intent.binding.rootNonceAtomic = "1"; },
    (o: any) => { o.approval.fingerprint = "f".repeat(64); },
  ]) assert.throws(() => validateSmartAccountGaslessOperation(rewrite(op, mutate)), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateSmartAccountGaslessContinuity(make(), make("other")), { code: "APN_STATE_CORRUPT" });
});
test("provider-hint proof needs its actual saved response while independent discovery needs no provider response", () => {
  const all = stages();
  for (const op of [all[4]!, all[6]!, all[7]!]) {
    const hinted = rewrite(complete(op), copy => {
      copy.settlement.source = "provider_hint"; copy.transitions.at(-1).settlement.source = "provider_hint";
    });
    if (op.providerSettlement === null) assert.throws(() => validateSmartAccountGaslessOperation(hinted), { code: "APN_STATE_CORRUPT" });
    else assert.equal(validateSmartAccountGaslessOperation(hinted).settlement?.source, "provider_hint");
    assert.equal(complete(op).settlement?.source, "rpc_discovered");
  }
  const mismatched = rewrite(complete(all[7]!), copy => {
    for (const record of [copy, ...copy.transitions]) {
      if (record.providerSettlement !== null) record.providerSettlement.transactionHash = hx("f");
      if (record.settlement !== null) record.settlement.source = "provider_hint";
    }
  });
  assert.throws(() => validateSmartAccountGaslessOperation(mismatched), { code: "APN_STATE_CORRUPT" });
});
test("bounded cursors preserve anchors, earlier candidates and both scan-completion obligations", () => {
  const exposed = stages()[4]!, pending = uncertain(exposed);
  const end = { numberAtomic: "50000001", hash: hx("e"), timestampAtomic: String(exposed.intent.afterUnix + 2) };
  const progress = advance(pending, { cursor: { ...pending.cursor, nextBlockAtomic: "50000002", previousEndBlock: end,
    candidateHashes: [TX] }, observation: { ...pending.observation!, observedAt: at(9) } }, at(9));
  for (const cursor of [
    { ...progress.cursor, candidateHashes: [] }, { ...progress.cursor, previousEndBlock: { ...end, hash: hx("f") } },
    { ...progress.cursor, nextBlockAtomic: "50000003" }, { ...progress.cursor, childScanComplete: true },
    { ...progress.cursor, nextBlockAtomic: "50000000", previousEndBlock: null },
  ]) assert.throws(() => advance(progress, { cursor, observation: { ...progress.observation!, observedAt: at(10) } }, at(10)),
    { code: "APN_STATE_CORRUPT" });
  const repeated = advance(progress, { observation: { ...progress.observation!, observedAt: at(10) } }, at(10));
  assert.deepEqual(repeated, progress);
  assert.throws(() => advance(progress, { observation: { ...progress.observation!, observedAt: at(8) } }, at(10)),
    { code: "APN_STATE_CORRUPT" });
});
test("operation-first writes recover exact stale receipts in a fresh repository without rewriting corrupt receipts", async t => {
  const state = await root(t), repo = new SmartAccountGaslessOperationRepository(state), all = stages();
  for (const op of all.slice(0, 4)) await repo.persist(op);
  const exposed = all[4]!, historical = await repo.loadReceipt(exposed.profileHash, exposed.operationId);
  await repo.writeOperation(exposed); // Simulate a crash before its derived receipt write.
  const fresh = new SmartAccountGaslessOperationRepository(state);
  assert.deepEqual(await fresh.loadOperation(exposed.profileHash, exposed.operationId), exposed);
  await assert.rejects(() => fresh.loadReceipt(exposed.profileHash, exposed.operationId), { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(validateSmartAccountGaslessReceipt(historical, exposed), historical);
  await fresh.repairReceipt(exposed);
  assert.deepEqual(await fresh.loadReceipt(exposed.profileHash, exposed.operationId), smartAccountGaslessReceipt(exposed));
  const path = join(state, RECEIPTS, exposed.profileHash, `${exposed.operationId}.json`);
  const altered = { ...historical, profile: "foreign" }, { receipt_hash: _hash, ...body } = altered;
  await writeCanonical(path, { ...body, receipt_hash: hashObject(body) });
  const bytes = await readFile(path, "utf8");
  await assert.rejects(() => fresh.repairReceipt(exposed), { code: "APN_STATE_CORRUPT" });
  assert.equal(await readFile(path, "utf8"), bytes);
});
test("terminal bytes and receipts remain fixed, and stale writers cannot fork a saved prefix", async t => {
  const state = await root(t), repo = new SmartAccountGaslessOperationRepository(state), all = stages();
  for (const op of all.slice(0, 5)) await repo.persist(op);
  const exposed = all[4]!, done = complete(exposed); await repo.persist(done);
  const path = join(state, OPS, done.profileHash, `${done.operationId}.json`), original = await readFile(path, "utf8");
  await repo.persist(done); await repo.repairReceipt(done);
  assert.equal(await readFile(path, "utf8"), original);
  assert.throws(() => advance(done, { observation: { ...done.observation!, observedAt: at(601) } }, at(601)), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(() => repo.persist(uncertain(exposed)), { code: "APN_STATE_CORRUPT" });
  assert.equal(await readFile(path, "utf8"), original);
});
test("file identities, duplicates, symbolic links and the 256 KiB family bound fail closed", async t => {
  const state = await root(t), repo = new SmartAccountGaslessOperationRepository(state), first = make(); await repo.persist(first);
  await assert.rejects(() => repo.writeOperation(make("other", "other", first.operationId)), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(() => repo.writeOperation(make("other", "first")), { code: "APN_STATE_CORRUPT" });
  const alias = join(state, OPS, "f".repeat(64)); await symlink(await realpath(tmpdir()), alias);
  await assert.rejects(() => repo.listAllOperations(), { code: "APN_STATE_CORRUPT" }); await rm(alias);
  const path = join(state, OPS, first.profileHash, `${"e".repeat(64)}.json`);
  await writeCanonical(path, first);
  await assert.rejects(() => repo.loadOperation(first.profileHash, "e".repeat(64)), { code: "APN_STATE_CORRUPT" });
  await writeCanonical(path, { payload: "x".repeat(SA_FILE_LIMIT + 1) });
  await assert.rejects(() => repo.loadOperation(first.profileHash, "e".repeat(64)), { code: "APN_STATE_CORRUPT" });
});
test("capacity exhaustion retains terminal space and the last guarded state", () => {
  let op = uncertain(stages()[4]!), stopped = false;
  for (let index = 0; index < 256; index++) {
    const when = at(9 + index), before = op;
    try {
      assertSmartAccountGaslessCapacity(op);
      op = advance(op, { observation: { ...op.observation!, observedAt: when, evidenceHash: sha256(String(index)) } }, when);
    } catch (error) {
      assert.equal((error as { details?: { reason: string } }).details?.reason, "sa_gasless_capacity");
      assert.equal(publicSmartAccountGaslessOperation(before).permission.guard_held, true); stopped = true; break;
    }
  }
  assert.equal(stopped, true);
  const terminal = complete(op);
  assert.ok(Buffer.byteLength(canonicalJson(terminal)) < SA_FILE_LIMIT);
  assert.equal(terminal.state, "completed");
});
