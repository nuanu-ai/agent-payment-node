import assert from "node:assert/strict";
import test from "node:test";
import { OperationService } from "../../src/operation-service.js";
import { publicGaslessOperation } from "../../src/gasless/receipt.js";
import { transitionGasless } from "../../src/gasless/transitions.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

test("a bootstrap sealed by an earlier invocation is guarded again before disclosure and ends failed_before_effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  // The approving invocation stops right after the local bootstrap seal, before any disclosure.
  const persist = s.core.gasless.records.persist.bind(s.core.gasless.records);
  s.core.gasless.records.persist = async (op) => { await persist(op); if (op.bootstrap.phase === "sealed") throw new Error("interrupted-after-durable-write"); };
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, false);
  s.core.gasless.records.persist = persist;
  assert.equal((await s.record(id)).bootstrap.phase, "sealed");
  // No guard of the resuming invocation preceded that seal, so the disclosure waits for a full guard.
  s.rpc.current = { ...s.rpc.current, balanceAtomic: "1" };
  const snapshots = s.rpc.calls.filter((c) => c === "snapshot").length;
  const response = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  assert.equal(s.rpc.calls.filter((c) => c === "snapshot").length, snapshots + 1);
  const stored = await s.record(id);
  assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.terminal, true);
  assert.equal(stored.bootstrap.signingAttempts, 1); assert.equal(stored.bootstrap.disclosureAttempts, 0);
  assert.equal(publicGaslessOperation(stored).proof_class, "durable_pre_effect");
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
  await new OperationService(s.state).assertProfileAvailable(stored.profileHash);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
});

test("within one invocation the bootstrap guard's fees are reused for the disclosure after the local seal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  // Prepare, then a guard before the screen, before the bootstrap signature and before the final signature; then the fee check.
  assert.deepEqual(s.rpc.calls, ["snapshot", "snapshot", "mirror_estimate", "snapshot", "estimate", "snapshot", "fee_check", "send"]);
  assert.equal((await s.record(id)).state, "submitted_pending");
});

test("a 0.5.13 unknown_finality record with an undisclosed sealed bootstrap resumes to failed_before_effect after expiry", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const persist = s.core.gasless.records.persist.bind(s.core.gasless.records);
  s.core.gasless.records.persist = async (op) => { await persist(op); if (op.bootstrap.phase === "sealed") throw new Error("interrupted-after-durable-write"); };
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, false);
  s.core.gasless.records.persist = persist;
  const sealed = await s.record(id);
  assert.equal(sealed.bootstrap.phase, "sealed"); assert.equal(sealed.bootstrap.disclosureAttempts, 0);
  await s.core.gasless.records.persist(transitionGasless(sealed, { state: "unknown_finality", failure: "gasless_fee_budget" }, s.now.toISOString()));
  assert.equal((await s.record(id)).state, "unknown_finality");
  s.now.setTime(s.now.getTime() + 360000);
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  const after = await s.record(id);
  assert.equal(after.state, "failed_before_effect"); assert.equal(after.terminal, true);
  assert.equal(publicGaslessOperation(after).proof_class, "durable_pre_effect");
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
  await new OperationService(s.state).assertProfileAvailable(after.profileHash);
});
