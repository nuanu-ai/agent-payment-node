import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import test from "node:test";
import { hashObject, sha256 } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import type { GaslessObservation } from "../../src/gasless/model.js";
import { assertGaslessPermissionClosure } from "../../src/gasless/permission-invalidation.js";
import { gaslessFixture, GaslessTestRpc, testWord } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const phases = ["bootstrap_signing", "bootstrap_sealed", "bootstrap_disclosure", "bootstrap_checked",
  "user_signing", "user_sealed", "user_submitting", "user_submitted"] as const;
function atBoundary(op: GaslessOperationRecord, boundary: typeof phases[number]): boolean {
  if (boundary === "bootstrap_signing") return op.bootstrap.phase === "signing_started";
  if (boundary === "bootstrap_sealed") return op.bootstrap.phase === "sealed";
  if (boundary === "bootstrap_disclosure") return op.bootstrap.phase === "disclosure_started";
  if (boundary === "bootstrap_checked") return op.bootstrap.phase === "checked" && op.userOperation.signingAttempts === 0;
  if (boundary === "user_signing") return op.userOperation.phase === "signing_started";
  if (boundary === "user_sealed") return op.userOperation.phase === "sealed";
  if (boundary === "user_submitting") return op.userOperation.phase === "submitting";
  return op.userOperation.phase === "submitted_pending";
}
for (const boundary of phases) test(`gasless durable ${boundary} survives expiry without repeat effects`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const repair = s.core.gasless.records.repairReceipt.bind(s.core.gasless.records);
  s.core.gasless.records.repairReceipt = async (op) => {
    if (atBoundary(op, boundary)) throw new Error("receipt-write-interrupted");
    await repair(op);
  };
  const interrupted = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(interrupted.ok, false); const before = await s.record(id); assert.equal(atBoundary(before, boundary), true);
  const estimates = s.rpc.calls.filter((c) => c === "estimate").length, sends = s.rpc.sends.length;
  s.now.setTime(s.now.getTime() + 360000);
  const restarted = await gaslessFixture(temporary.root, 8453, { ...s, initializeWallet: false });
  const resumed = await restarted.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  const after = await restarted.record(id);
  assert.equal(after.fingerprint, before.fingerprint);
  assert.equal(after.bootstrap.signingAttempts, before.bootstrap.signingAttempts);
  assert.equal(after.userOperation.signingAttempts, before.userOperation.signingAttempts);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, estimates);
  assert.equal(s.rpc.sends.length, sends); assert.equal(restarted.approval.calls.length, 0);
  assert.equal(after.state, boundary === "user_submitted" ? "completed" : "unknown_finality");
  if (!after.terminal) await assert.rejects(new OperationService(s.state).assertProfileAvailable(after.profileHash), { code: "APN_OPERATION_BLOCKED" });
});

for (const boundary of ["bootstrap_checked", "user_sealed"] as const) {
  test(`gasless ${boundary} resumes the remaining original approved phase before expiry`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
    const repair = s.core.gasless.records.repairReceipt.bind(s.core.gasless.records);
    s.core.gasless.records.repairReceipt = async (op) => { if (atBoundary(op, boundary)) throw new Error("interrupted"); await repair(op); };
    assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, false);
    const before = await s.record(id), bootHash = before.bootstrap.materialHash;
    const restart = await gaslessFixture(temporary.root, 8453, { ...s, initializeWallet: false });
    const response = await restart.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(response.ok, true, response.error?.message); const after = await restart.record(id);
    assert.equal(after.state, "completed"); assert.equal(after.bootstrap.materialHash, bootHash);
    if (boundary === "user_sealed") assert.equal(after.userOperation.materialHash, before.userOperation.materialHash);
    assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 1); assert.equal(s.rpc.sends.length, 1);
  });
}

for (const branch of ["sponsored", "post_op_reverted", "prefund_too_low"] as const) {
  test(`gasless ${branch} failure retains actual USDC fee and guard until safe allowance cleanup`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root), { id } = await s.prepare(); s.rpc.success = false; s.rpc.branch = branch;
    const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(response.ok, true, response.error?.message); const before = await s.record(id);
    assert.equal(before.state, "failed_effects_pending"); assert.equal(before.terminal, false); assert.equal(before.settlement, null);
    const evidence = before.observation!.settlement!, fee = evidence.accounting.feeAtomic;
    assert.ok(BigInt(fee) > 0n); assert.equal(evidence.accounting.deliveredAtomic, "0");
    if (branch !== "sponsored") assert.equal(fee, evidence.accounting.prefundAtomic);
    await assert.rejects(new OperationService(s.state).assertProfileAvailable(before.profileHash), { code: "APN_OPERATION_BLOCKED" });
    s.rpc.result = "throw";
    const unavailable = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(unavailable.ok, true);
    assert.equal(hashObject(await s.record(id)), hashObject(before));
    s.rpc.result = "safe"; s.rpc.safeAllowance = "0"; s.rpc.safeNumber = "103";
    s.now.setTime(s.now.getTime() + 360000);
    const cleared = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(cleared.ok, true, cleared.error?.message);
    const final = await s.record(id); assert.equal(final.state, "failed_confirmed_revert");
    assert.equal(final.settlement!.accounting.feeAtomic, fee); assert.equal(s.rpc.sends.length, 1);
    await new OperationService(s.state).assertProfileAvailable(final.profileHash);
  });
}

test("gasless failed estimate is disclosed once, keeps non-expiring permission exposure and redacts errors", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare(); s.rpc.estimateFails = true;
  const first = await s.core.execute({ command: "gasless.transfer.approve", operationId: id }); assert.equal(first.ok, true);
  assert.equal((await s.record(id)).state, "unknown_finality"); assert.equal(s.rpc.sends.length, 0);
  s.rpc.estimateFails = false; s.now.setTime(s.now.getTime() + 360000);
  const recovered = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(recovered.ok, true);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 1);
  assert.equal((await s.record(id)).userOperation.signingAttempts, 0);
  assert.equal(JSON.stringify(recovered).includes("canary_provider_secret"), false);
});

test("gasless accepted lost send response recovers in a fresh process after expiry with no signing or sending", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare(); s.rpc.timeout = true; s.rpc.result = "missing";
  const first = await s.core.execute({ command: "gasless.transfer.approve", operationId: id }); assert.equal(first.ok, true);
  const before = await s.record(id); assert.equal(before.state, "unknown_finality"); assert.equal(s.rpc.sends.length, 1);
  const child = await promisify(execFile)(process.execPath,
    [resolve("tests/core/gasless-fixtures/restart.mjs"), temporary.root, id], { cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(child.stdout); assert.equal(result.ok, true, result.error);
  assert.equal(result.state, "completed"); assert.equal(result.signingCalls, 0); assert.equal(result.sendCalls, 0);
  assert.equal(result.estimateCalls, 0); assert.equal(result.userOperationHash, before.userOperation.userOperationHash);
  assert.equal(result.bootstrapMaterialHash, before.bootstrap.materialHash); assert.equal(result.wrappingLoads, 0);
});

test("records produced by the legacy binary retain their exact offer and close only from new permission proof", async (t) => {
  const bundle = JSON.parse(await readFile(resolve("tests/core/gasless-fixtures/legacy-offers-719.json"), "utf8"));
  assert.equal(bundle.producerCommit, "d4617cdc751cad283d36d53edb05ff5585012836");
  assert.equal(bundle.syntheticOnly, true); assert.equal(bundle.cases.length, 4);
  for (const fixture of bundle.cases) await t.test(fixture.name, async (child) => {
    assert.equal(sha256(fixture.operationUtf8), fixture.operationSha256);
    assert.equal(sha256(fixture.receiptUtf8), fixture.receiptSha256);
    const temporary = await temporaryState(); child.after(temporary.cleanup);
    const original = JSON.parse(fixture.operationUtf8) as GaslessOperationRecord;
    const operationPath = resolve(temporary.root, "gasless-operations", original.profileHash, `${original.operationId}.json`);
    const receiptPath = resolve(temporary.root, "gasless-receipts", original.profileHash, `${original.operationId}.json`);
    for (const name of ["gasless-operations", "gasless-receipts"]) {
      await mkdir(resolve(temporary.root, name, original.profileHash), { recursive: true, mode: 0o700 });
    }
    await writeFile(operationPath, fixture.operationUtf8, { mode: 0o600 });
    await writeFile(receiptPath, fixture.receiptUtf8, { mode: 0o600 });
    const now = new Date(Date.parse(original.intent.expiresAt) + 360000);
    const rpc = new GaslessTestRpc(8453, original.intent.owner.address, original.intent.initialSnapshot.delegation, now);
    rpc.current = original.intent.initialSnapshot;
    let custodyCalls = 0;
    const denyCustody = async (): Promise<never> => { custodyCalls++; throw new Error("Unexpected legacy custody access"); };
    const s = await gaslessFixture(temporary.root, 8453, { rpc, now, initializeWallet: false,
      custody: { load: denyCustody, seal: denyCustody } });
    const before = await s.record(original.operationId); assert.deepEqual(before, original);
    assert.equal((await s.core.execute({ command: "operation.status", operationId: original.operationId })).ok, true);
    assert.equal(await readFile(operationPath, "utf8"), fixture.operationUtf8);
    assert.equal(await readFile(receiptPath, "utf8"), fixture.receiptUtf8);
    await assert.rejects(new OperationService(s.state).assertProfileAvailable(original.profileHash), { code: "APN_OPERATION_BLOCKED" });
    rpc.observe = async () => permissionObservation(original);
    const result = await s.core.execute({ command: "operation.resume", operationId: original.operationId });
    assert.equal(result.ok, true, result.error?.message); const after = await s.record(original.operationId);
    assert.equal(after.state, "failed_permissions_invalidated"); assert.deepEqual(after.intent, original.intent);
    assert.deepEqual(after.bootstrap, original.bootstrap); assert.deepEqual(after.userOperation, original.userOperation);
    assert.deepEqual(after.transitions.slice(0, original.transitions.length), original.transitions);
    assert.equal(after.settlement, null); assert.equal(custodyCalls, 0); assert.equal(s.wrapping.loads, 0);
    assert.equal(rpc.sends.length, 0); assert.equal(rpc.calls.includes("estimate"), false);
    await new OperationService(s.state).assertProfileAvailable(original.profileHash);
  });
});

for (const delegation of ["empty", "expected"] as const) {
  test(`gasless ${delegation} bootstrap closes only from safe permission invalidation and survives restart`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root, 8453, { delegation }), { id } = await s.prepare();
    s.rpc.estimateFails = true;
    assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    const before = await s.record(id), oldReceiptPath = resolve(temporary.root, "gasless-receipts", before.profileHash, `${id}.json`);
    const oldReceipt = await readFile(oldReceiptPath, "utf8"), loads = s.wrapping.loads;
    assert.equal(before.bootstrap.disclosureAttempts, 1); assert.equal(before.userOperation.signingAttempts, 0);
    const observation = permissionObservation(before);
    if (delegation === "expected") {
      assert.equal(observation.permissionInvalidation?.safeAccount.eoaNonceAtomic, before.intent.initialSnapshot.eoaNonceAtomic);
      assert.equal(observation.permissionInvalidation?.headAccount.eoaNonceAtomic, before.intent.initialSnapshot.eoaNonceAtomic);
    }
    s.rpc.observe = async () => { s.rpc.calls.push("observe"); return observation; };
    s.now.setTime(s.now.getTime() + 360000);
    const result = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(result.ok, true, result.error?.message);
    const after = await s.record(id), publicOp = result.operation as any;
    assert.equal(after.state, "failed_permissions_invalidated"); assert.equal(after.terminal, true);
    assert.deepEqual(after.intent, before.intent); assert.equal(after.fingerprint, before.fingerprint);
    assert.deepEqual(after.bootstrap, before.bootstrap); assert.deepEqual(after.userOperation, before.userOperation);
    assert.deepEqual(after.transitions.slice(0, before.transitions.length), before.transitions);
    assert.equal(after.settlement, null); assert.equal(after.observation?.transactionHash, null);
    assert.equal(publicOp.proof_class, "rpc_safe_permissions_invalidated"); assert.equal(publicOp.payment_submitted, false);
    assert.equal(publicOp.permission.guard_held, false); assert.equal(publicOp.permission.residual_allowance_atomic, "0");
    assert.equal(publicOp.permission.observed_designation, delegation);
    assert.equal(publicOp.permission.delegation_persists, delegation === "expected");
    assert.equal(publicOp.transfer.actual_delivered_atomic, null); assert.equal(publicOp.transfer.actual_sender_debit_atomic, null);
    assert.equal(publicOp.fees.actual_fee_atomic, null); assert.equal(publicOp.fees.proven_sender_native_debit_wei, null);
    assert.equal(s.wrapping.loads, loads); assert.equal(s.rpc.sends.length, 0);
    assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 1);
    await new OperationService(s.state).assertProfileAvailable(after.profileHash);
    // The old receipt was generated without the new optional proof fields. It is
    // still authenticated as a historical receipt and repaired to the new state.
    await writeFile(oldReceiptPath, oldReceipt, { mode: 0o600 });
    const calls = s.rpc.calls.length;
    assert.equal((await s.core.execute({ command: "operation.status", operationId: id })).ok, true);
    assert.equal(JSON.parse(await readFile(oldReceiptPath, "utf8")).state, "failed_permissions_invalidated");
    const child = await promisify(execFile)(process.execPath,
      [resolve("tests/core/gasless-fixtures/restart.mjs"), temporary.root, id],
      { cwd: process.cwd(), timeout: 30000, maxBuffer: 1024 * 1024 });
    const restarted = JSON.parse(child.stdout);
    assert.equal(restarted.ok, true); assert.equal(restarted.state, "failed_permissions_invalidated");
    assert.equal(restarted.signingCalls, 0); assert.equal(restarted.sendCalls, 0);
    assert.equal(restarted.estimateCalls, 0); assert.equal(restarted.wrappingLoads, 0);
    assert.equal(s.rpc.calls.length, calls); assert.equal(hashObject(await s.record(id)), hashObject(after));
    assert.notEqual((await s.prepare("after-safe-bootstrap-invalidation")).id, id);
  });
}

test("gasless malformed or incomplete permission proof cannot release the original profile guard", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare(); s.rpc.estimateFails = true;
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const before = await s.record(id); s.now.setTime(s.now.getTime() + 360000);
  const mutations: Array<(o: any) => void> = [
    (o) => { o.permissionInvalidation.chainId = 1; },
    (o) => { o.permissionInvalidation.intentHash = "f".repeat(64); },
    (o) => { o.permissionInvalidation.bootstrapMaterialHash = "f".repeat(64); },
    (o) => { o.permissionInvalidation.protocolHash = "f".repeat(64); },
    (o) => { o.permissionInvalidation.safeAccount.owner = testWord("wrong").slice(0, 42); },
    (o) => { o.permissionInvalidation.safeAccount.permitNonceAtomic = before.intent.initialSnapshot.permitNonceAtomic; },
    (o) => { o.permissionInvalidation.headAccount.permitNonceAtomic = before.intent.initialSnapshot.permitNonceAtomic; },
    (o) => { o.permissionInvalidation.safeAccount.eoaNonceAtomic = before.intent.initialSnapshot.eoaNonceAtomic; },
    (o) => { o.permissionInvalidation.headAccount.eoaNonceAtomic = before.intent.initialSnapshot.eoaNonceAtomic; },
    (o) => { o.permissionInvalidation.safeAccount.allowanceAtomic = "1"; },
    (o) => { o.permissionInvalidation.headAccount.allowanceAtomic = "1"; },
    (o) => { o.permissionInvalidation.headAccount.pendingEoaNonceAtomic = "100"; },
    (o) => { o.permissionInvalidation.safeAccount.pendingEoaNonceAtomic = "100"; },
    (o) => { o.permissionInvalidation.safeAccount.permitNonceAtomic = "10"; },
    (o) => { o.permissionInvalidation.safeAccount.eoaNonceAtomic = "10"; },
    (o) => { o.permissionInvalidation.safeAccount.entryPointNonceAtomic = "10"; },
    (o) => { o.permissionInvalidation.headAccount.entryPointNonceAtomic = "10"; },
    (o) => { o.permissionInvalidation.headAccount.delegation = "foreign"; },
    (o) => { o.permissionInvalidation.safeBlock.numberAtomic = "99"; },
    (o) => { o.permissionInvalidation.headBlock.numberAtomic = "100"; },
    (o) => { o.permissionInvalidation.headBlock.hash = `0x${"0".repeat(64)}`; },
    (o) => { o.permissionInvalidation.headBlock.timestampAtomic = "0"; },
    (o) => { o.status = "unresolved"; },
    (o) => { o.reason = "gasless_receipt_unresolved"; },
    (o) => { o.transactionHash = testWord("not-a-payment"); },
    (o) => { delete o.permissionInvalidation; },
  ];
  for (const mutate of mutations) {
    const mutated = structuredClone(permissionObservation(before)); mutate(mutated);
    const observation = { ...mutated,
      evidenceHash: mutated.permissionInvalidation === undefined ? null : hashObject(mutated.permissionInvalidation) };
    s.rpc.observe = async () => observation;
    const result = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(result.ok, true, result.error?.message);
    const held = await s.record(id); assert.equal(held.terminal, false);
    assert.deepEqual(held.bootstrap, before.bootstrap); assert.deepEqual(held.userOperation, before.userOperation);
    assert.equal(held.settlement, null); assert.equal(held.observation?.permissionInvalidation, undefined);
    await assert.rejects(new OperationService(s.state).assertProfileAvailable(held.profileHash), { code: "APN_OPERATION_BLOCKED" });
  }
  assert.equal(s.rpc.sends.length, 0); assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 1);
});

for (const boundary of ["bootstrap_signing", "user_signing", "user_sealed"] as const) {
  test(`gasless permission invalidation rejects ineligible ${boundary} markers`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
    const repair = s.core.gasless.records.repairReceipt.bind(s.core.gasless.records);
    s.core.gasless.records.repairReceipt = async (op) => {
      if (atBoundary(op, boundary)) throw new Error("interrupted"); await repair(op);
    };
    assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, false);
    const op = await s.record(id), observation = permissionObservation(op);
    assert.throws(() => assertGaslessPermissionClosure(op, { ...op, observation }), { code: "APN_STATE_CORRUPT" });
    await assert.rejects(new OperationService(s.state).assertProfileAvailable(op.profileHash), { code: "APN_OPERATION_BLOCKED" });
    assert.equal(s.rpc.sends.length, 0);
  });
}

function permissionObservation(op: GaslessOperationRecord): GaslessObservation {
  const i = op.intent.initialSnapshot;
  const nonce = (BigInt(i.eoaNonceAtomic) + (i.delegation === "empty" ? 1n : 0n)).toString();
  const account = { owner: i.owner, balanceAtomic: i.balanceAtomic, nativeBalanceWei: i.nativeBalanceWei,
    allowanceAtomic: "0", permitNonceAtomic: (BigInt(i.permitNonceAtomic) + 1n).toString(),
    entryPointNonceAtomic: i.entryPointNonceAtomic, eoaNonceAtomic: nonce, pendingEoaNonceAtomic: nonce, delegation: i.delegation };
  const proof = { chainId: i.chainId, intentHash: hashObject(op.intent),
    bootstrapMaterialHash: op.bootstrap.materialHash ?? "f".repeat(64), protocolHash: i.protocolHash,
    safeBlock: { numberAtomic: "101", hash: testWord("101"), timestampAtomic: i.block.timestampAtomic },
    headBlock: { numberAtomic: "102", hash: testWord("102"), timestampAtomic: i.block.timestampAtomic },
    safeAccount: { ...account }, headAccount: { ...account } };
  return { status: "permissions_invalidated", transactionHash: null, settlement: null, cursor: op.cursor,
    evidenceHash: hashObject(proof), reason: "gasless_bootstrap_permissions_invalidated", permissionInvalidation: proof };
}
