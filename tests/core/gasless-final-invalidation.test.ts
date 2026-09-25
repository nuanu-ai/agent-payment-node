import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { hashObject } from "../../src/canonical.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import type { GaslessObservation } from "../../src/gasless/model.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import { OperationService } from "../../src/operation-service.js";
import { gaslessFixture, testWord } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

function invalidation(op: GaslessOperationRecord): GaslessObservation {
  const i = op.intent.initialSnapshot;
  const eoa = (BigInt(i.eoaNonceAtomic) + 1n).toString();
  const safeBlock = { numberAtomic: "101", hash: testWord("101"), timestampAtomic: i.block.timestampAtomic };
  const account = { owner: i.owner, balanceAtomic: i.balanceAtomic, nativeBalanceWei: i.nativeBalanceWei,
    allowanceAtomic: "0", permitNonceAtomic: (BigInt(i.permitNonceAtomic) + 1n).toString(),
    entryPointNonceAtomic: (BigInt(i.entryPointNonceAtomic) + 1n).toString(),
    eoaNonceAtomic: eoa, pendingEoaNonceAtomic: eoa, delegation: i.delegation };
  const proof = { chainId: i.chainId, intentHash: hashObject(op.intent),
    bootstrapMaterialHash: op.bootstrap.materialHash!, userOperationMaterialHash: op.userOperation.materialHash!,
    userOperationHash: op.userOperation.userOperationHash!, protocolHash: i.protocolHash, safeBlock,
    headBlock: { ...safeBlock, numberAtomic: "102", hash: testWord("102") }, safeAccount: account, headAccount: { ...account } };
  return { status: "permissions_invalidated", transactionHash: null, settlement: null,
    cursor: { startBlock: i.block, nextBlockAtomic: "102", previousEndBlock: { ...safeBlock } },
    evidenceHash: hashObject(proof), reason: "gasless_final_permissions_invalidated", permissionInvalidation: proof };
}

type Fixture = Awaited<ReturnType<typeof gaslessFixture>>;
async function stopAfterFinalSeal(root: string, delegation: "empty" | "expected") {
  const first = await gaslessFixture(root, 8453, { delegation }), { id } = await first.prepare();
  const repair = first.core.gasless.records.repairReceipt.bind(first.core.gasless.records);
  first.core.gasless.records.repairReceipt = async op => {
    if (op.userOperation.phase === "sealed" && op.userOperation.signingAttempts === 1 &&
      op.userOperation.materialHash !== null && op.userOperation.userOperationHash !== null &&
      op.userOperation.submissionAttempts === 0) throw new Error("final-seal-write-interrupted");
    await repair(op);
  };
  const interrupted = await first.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(interrupted.ok, false);
  const before = await first.record(id);
  assert.equal(before.bootstrap.phase, "checked"); assert.equal(before.bootstrap.signingAttempts, 1);
  assert.equal(before.bootstrap.disclosureAttempts, 1); assert.notEqual(before.bootstrap.materialHash, null);
  assert.equal(before.userOperation.phase, "sealed"); assert.equal(before.userOperation.signingAttempts, 1);
  assert.equal(before.userOperation.disclosureAttempts, 0); assert.equal(before.userOperation.submissionAttempts, 0);
  assert.notEqual(before.userOperation.materialHash, null); assert.notEqual(before.userOperation.userOperationHash, null);
  assert.equal(first.rpc.sends.length, 0); assert.equal(first.rpc.calls.filter(c => c === "estimate").length, 1);
  first.now.setTime(Date.parse(before.intent.expiresAt) + 1);
  let custodyCalls = 0;
  const denied = async (): Promise<never> => { custodyCalls++; throw new Error("Unexpected expired final-seal custody access"); };
  const s = await gaslessFixture(root, 8453, { ...first, initializeWallet: false,
    custody: { load: denied, seal: denied } });
  return { s, id, before, custodyCalls: () => custodyCalls };
}

const finalCases = [
  ["empty", "sealed_unsubmitted"], ["expected", "sealed_unsubmitted"],
  ["empty", "attempted_ambiguous"], ["expected", "attempted_ambiguous"],
  ["empty", "attempted_pending"],
] as const;
for (const [delegation, mode] of finalCases) test(`gasless ${delegation} ${mode} final invalidation releases only future authority and preserves ambiguous financial results`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let s: Fixture, id: string, before: GaslessOperationRecord, custodyCalls = () => 0;
  if (mode === "sealed_unsubmitted") {
    ({ s, id, before, custodyCalls } = await stopAfterFinalSeal(temporary.root, delegation));
  } else {
    s = await gaslessFixture(temporary.root, 8453, { delegation }); ({ id } = await s.prepare());
    s.rpc.timeout = mode === "attempted_ambiguous"; s.rpc.result = "missing";
    if (mode === "attempted_pending") s.rpc.observe = async (_intent, _identity, cursor) => ({ status: "pending", transactionHash: null,
      settlement: null, cursor, evidenceHash: hashObject("pending"), reason: null });
    assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    before = await s.record(id); s.now.setTime(s.now.getTime() + 360000);
  }
  const loads = s.wrapping.loads, sends = s.rpc.sends.length;
  const estimates = s.rpc.calls.filter(c => c === "estimate").length;
  assert.equal(before.state, mode === "attempted_pending" ? "submitted_pending" :
    mode === "sealed_unsubmitted" ? "user_operation_pending" : "unknown_finality");
  assert.equal(before.userOperation.submissionAttempts, mode === "sealed_unsubmitted" ? 0 : 1);
  assert.equal(before.terminal, false);
  const receiptPath = resolve(temporary.root, "gasless-receipts", before.profileHash, `${id}.json`);
  const oldReceipt = await readFile(receiptPath, "utf8");
  s.rpc.observe = async () => invalidation(before);
  const result = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(result.ok, true, result.error?.message); const after = await s.record(id), publicOp = result.operation as any;
  assert.equal(after.state, "failed_permissions_invalidated"); assert.equal(after.terminal, true);
  for (const key of ["intent", "bootstrap", "userOperation", "approval", "fingerprint"] as const) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(after.transitions.slice(0, before.transitions.length), before.transitions);
  assert.equal(publicOp.proof_class, "rpc_safe_final_permissions_invalidated");
  assert.equal(publicOp.payment_submission_attempted, mode !== "sealed_unsubmitted"); assert.equal(publicOp.payment_submitted, null);
  assert.equal(publicOp.prior_payment_effects, "unknown"); assert.equal(publicOp.permission.guard_held, false);
  assert.equal(publicOp.transfer.actual_delivered_atomic, null); assert.equal(publicOp.fees.actual_fee_atomic, null);
  const usage = new AssetUsageLedger(temporary.root);
  const identity = { account: s.account.address, chain: "eip155:8453",
    asset: { kind: "token" as const, identifier: after.intent.token } };
  const lease = await usage.load(identity, after.intent.allowlist!.reservationId);
  assert.equal(lease?.state, mode === "sealed_unsubmitted" ? "released_unsubmitted" :
    mode === "attempted_pending" ? "submitted" : "unknown_finality");
  assert.equal((await usage.usage(identity, s.now)).amountAtomic,
    mode === "sealed_unsubmitted" ? "0" : after.intent.request.grossAtomic);
  assert.equal(s.wrapping.loads, loads); assert.equal(custodyCalls(), 0); assert.equal(s.rpc.sends.length, sends);
  assert.equal(s.rpc.calls.filter(c => c === "estimate").length, estimates);
  await new OperationService(s.state).assertProfileAvailable(after.profileHash);
  await writeFile(receiptPath, oldReceipt, { mode: 0o600 });
  assert.equal((await s.core.execute({ command: "operation.status", operationId: id })).ok, true);
  const child = await promisify(execFile)(process.execPath,
    [resolve("tests/core/gasless-fixtures/restart.mjs"), temporary.root, id], { cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024 });
  const restart = JSON.parse(child.stdout);
  assert.equal(restart.ok, true); assert.equal(restart.state, "failed_permissions_invalidated");
  assert.equal(restart.signingCalls + restart.sendCalls + restart.estimateCalls + restart.wrappingLoads, 0);
  assert.equal(hashObject(await s.record(id)), hashObject(after));
});

for (const submissionAttempted of [false, true]) test(`gasless ${submissionAttempted ? "attempted" : "sealed unsubmitted"} final invalidation requires both sealed identities, invalidated nonces and the completed canonical scan`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let s: Fixture, id: string, before: GaslessOperationRecord, custodyCalls = () => 0;
  if (submissionAttempted) {
    s = await gaslessFixture(temporary.root); ({ id } = await s.prepare()); s.rpc.timeout = true; s.rpc.result = "missing";
    await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    before = await s.record(id); s.now.setTime(s.now.getTime() + 360000);
  } else {
    ({ s, id, before, custodyCalls } = await stopAfterFinalSeal(temporary.root, "empty"));
  }
  const sends = s.rpc.sends.length, estimates = s.rpc.calls.filter(c => c === "estimate").length;
  const faults: Array<(o: any) => void> = [
    o => { delete o.permissionInvalidation.userOperationHash; },
    o => { delete o.permissionInvalidation.userOperationMaterialHash; },
    o => { o.permissionInvalidation.userOperationHash = testWord("foreign"); },
    o => { o.permissionInvalidation.userOperationMaterialHash = "f".repeat(64); },
    o => { o.permissionInvalidation.bootstrapMaterialHash = "f".repeat(64); },
    o => { o.permissionInvalidation.safeAccount.entryPointNonceAtomic = before.intent.initialSnapshot.entryPointNonceAtomic; },
    o => { o.permissionInvalidation.headAccount.entryPointNonceAtomic = before.intent.initialSnapshot.entryPointNonceAtomic; },
    o => { o.permissionInvalidation.safeAccount.permitNonceAtomic = before.intent.initialSnapshot.permitNonceAtomic; },
    o => { o.permissionInvalidation.headAccount.permitNonceAtomic = before.intent.initialSnapshot.permitNonceAtomic; },
    o => { o.permissionInvalidation.safeAccount.allowanceAtomic = "1"; },
    o => { o.permissionInvalidation.headAccount.allowanceAtomic = "1"; },
    o => { o.permissionInvalidation.headAccount.pendingEoaNonceAtomic = "100"; },
    o => { o.permissionInvalidation.safeAccount.eoaNonceAtomic = before.intent.initialSnapshot.eoaNonceAtomic; },
    o => { o.cursor.previousEndBlock = null; }, o => { o.cursor.nextBlockAtomic = "101"; },
    o => { o.permissionInvalidation.safeBlock.hash = testWord("foreign"); },
    o => { o.reason = "gasless_bootstrap_permissions_invalidated"; },
  ];
  for (const [index, fault] of faults.entries()) {
    const proof = structuredClone(invalidation(before)); fault(proof);
    s.rpc.observe = async () => ({ ...proof, evidenceHash: hashObject(proof.permissionInvalidation) });
    const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true);
    const held = await s.record(id); assert.equal(held.terminal, false, `fault ${index}`); assert.equal(held.state, "unknown_finality");
    await assert.rejects(new OperationService(s.state).assertProfileAvailable(held.profileHash), { code: "APN_OPERATION_BLOCKED" });
  }
  assert.equal(custodyCalls(), 0); assert.equal(s.rpc.sends.length, sends);
  assert.equal(s.rpc.calls.filter(c => c === "estimate").length, estimates);
});

for (const kind of ["bounded_progress", "partial", "reorg", "malformed", "matching_event"] as const) {
  test(`gasless expired sealed unsubmitted ${kind} observation retains the profile guard`, async t => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const { s, id, before, custodyCalls } = await stopAfterFinalSeal(temporary.root, "empty");
    const start = before.cursor.startBlock, end = BigInt(start.numberAtomic) + 255n;
    const advanced = { startBlock: start, nextBlockAtomic: (end + 1n).toString(),
      previousEndBlock: { numberAtomic: end.toString(), hash: testWord(end.toString()), timestampAtomic: start.timestampAtomic } };
    const originalCursor = structuredClone(before.cursor);
    s.rpc.observe = async () => {
      if (kind === "bounded_progress") return { status: "not_found", transactionHash: null, settlement: null,
        cursor: advanced, evidenceHash: hashObject({ start, end: end.toString() }), reason: null };
      if (kind === "partial" || kind === "reorg") return { status: "unresolved", transactionHash: null, settlement: null,
        cursor: originalCursor, evidenceHash: kind === "reorg" ? hashObject("gasless_scan_cursor_reorg") : null,
        reason: "gasless_receipt_unresolved" };
      if (kind === "matching_event") return { status: "pending", transactionHash: testWord("matching-event"),
        settlement: null, cursor: originalCursor, evidenceHash: hashObject("matching-event"), reason: null };
      const malformed = structuredClone(invalidation(before)) as any;
      malformed.permissionInvalidation!.safeAccount.allowanceAtomic = "1";
      return { ...malformed, evidenceHash: hashObject(malformed.permissionInvalidation) };
    };
    const result = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(result.ok, true, result.error?.message);
    const held = await s.record(id); assert.equal(held.terminal, false); assert.equal(held.state, "unknown_finality");
    assert.deepEqual(held.cursor, kind === "bounded_progress" ? advanced : originalCursor);
    assert.equal(held.userOperation.submissionAttempts, 0); assert.equal(custodyCalls(), 0);
    assert.equal(s.rpc.sends.length, 0); assert.equal(s.rpc.calls.filter(c => c === "estimate").length, 1);
    await assert.rejects(new OperationService(s.state).assertProfileAvailable(held.profileHash), { code: "APN_OPERATION_BLOCKED" });
  });
}
