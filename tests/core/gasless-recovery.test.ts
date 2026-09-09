import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import { gaslessFixture } from "./gasless-helpers.js";
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
