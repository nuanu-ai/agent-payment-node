import assert from "node:assert/strict";
import test from "node:test";
import { OperationService } from "../../src/operation-service.js";
import { transitionGasless } from "../../src/gasless/transitions.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

test("gasless guard failure after the local bootstrap seal but before disclosure ends failed_before_effect and frees the profile", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const seal = s.custody.seal.bind(s.custody);
  s.custody.seal = async (...args: Parameters<typeof seal>) => {
    const sealed = await seal(...args); s.rpc.current = { ...s.rpc.current, balanceAtomic: "1" }; return sealed;
  };
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  const stored = await s.record(id);
  assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.terminal, true);
  assert.equal(stored.bootstrap.signingAttempts, 1); assert.equal(stored.bootstrap.disclosureAttempts, 0);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
  await new OperationService(s.state).assertProfileAvailable(stored.profileHash);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
});

test("a 0.5.13 unknown_finality record with an undisclosed sealed bootstrap resumes to failed_before_effect after expiry", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const repair = s.core.gasless.records.repairReceipt.bind(s.core.gasless.records);
  s.core.gasless.records.repairReceipt = async (op) => {
    if (op.bootstrap.phase === "sealed") throw new Error("receipt-write-interrupted");
    await repair(op);
  };
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, false);
  s.core.gasless.records.repairReceipt = repair;
  const sealed = await s.record(id);
  assert.equal(sealed.bootstrap.phase, "sealed"); assert.equal(sealed.bootstrap.disclosureAttempts, 0);
  await s.core.gasless.records.persist(transitionGasless(sealed, { state: "unknown_finality", failure: "gasless_fee_budget" }, s.now.toISOString()));
  assert.equal((await s.record(id)).state, "unknown_finality");
  s.now.setTime(s.now.getTime() + 360000);
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  const after = await s.record(id);
  assert.equal(after.state, "failed_before_effect"); assert.equal(after.terminal, true);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0); assert.equal(s.rpc.sends.length, 0);
  await new OperationService(s.state).assertProfileAvailable(after.profileHash);
});
