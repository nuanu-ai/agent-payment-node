import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { gaslessReceipt } from "../../src/gasless/receipt.js";
import { OperationService } from "../../src/operation-service.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const approve = async (s: Awaited<ReturnType<typeof gaslessFixture>>, id: string) => {
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
  if ((await s.record(id)).state === "submitted_pending") {
    const observed = await s.core.execute({ command: "operation.resume", operationId: id });
    assert.equal(observed.ok, true, observed.error?.message);
  }
  return await s.record(id);
};
/** Injects a fault the moment the owner confirms, so it lands on the first check after approval. */
const atApproval = (s: Awaited<ReturnType<typeof gaslessFixture>>, fault: () => void) => {
  const confirm = s.approval.confirm.bind(s.approval);
  s.approval.confirm = async (input) => { const accepted = await confirm(input); fault(); return accepted; };
};

test("a transport failure before the bootstrap signature is retried inside the window", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  atApproval(s, () => { s.rpc.transport = 1; });
  const stored = await approve(s, id);
  assert.equal(stored.state, "completed");
  // One guard retry is the invocation's whole retry allowance, and it is part of the derived POST budget.
  assert.deepEqual(s.wait.waits, [5000]);
  assert.equal(s.rpc.sends.length, 1);
});

test("a transport failure that never clears ends before any signature and names the transport", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  atApproval(s, () => { s.rpc.transport = 100; });
  const stored = await approve(s, id);
  assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.failure, "gasless_rpc_unavailable");
  assert.equal(stored.bootstrap.signingAttempts, 0); assert.equal(s.wrapping.loads, 0);
  assert.equal(s.wait.waits.length, 1); assert.equal(s.rpc.sends.length, 0);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0);
  await new OperationService(s.state).assertProfileAvailable(stored.profileHash);
});

test("an unavailable mirror estimate is retried within the allowance, and a misfit still ends at once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  // The retry allowance is one guard's POSTs (3); a mirror retry costs 2, so one retry fits and a second does not.
  s.rpc.mirrorUnavailable = 1;
  const stored = await approve(s, id);
  assert.equal(stored.state, "completed");
  assert.equal(s.rpc.calls.filter((c) => c === "mirror_estimate").length, 2);
  assert.deepEqual(s.wait.waits, [5000]);
  const third = await temporaryState(); t.after(third.cleanup);
  const twice = await gaslessFixture(third.root), again = await twice.prepare();
  twice.rpc.mirrorUnavailable = 2;
  const exhausted = await approve(twice, again.id);
  assert.equal(exhausted.state, "failed_before_effect"); assert.equal(exhausted.failure, "gasless_mirror_estimate_unavailable");
  assert.equal(exhausted.bootstrap.signingAttempts, 0);

  const second = await temporaryState(); t.after(second.cleanup);
  const misfit = await gaslessFixture(second.root), prepared = await misfit.prepare();
  misfit.rpc.mirrorResult = "misfit";
  const refused = await approve(misfit, prepared.id);
  assert.equal(refused.state, "failed_before_effect"); assert.equal(refused.failure, "gasless_mirror_estimate_bounds");
  assert.deepEqual(misfit.wait.waits, []);
});

test("retries stop when the approval window no longer leaves room for the remaining steps", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id, operation } = await s.prepare();
  atApproval(s, () => {
    s.rpc.transport = 5;
    // 20 seconds left: the minimum remaining plus one interval no longer fits.
    s.now.setTime(Date.parse(operation.intent.expiresAt) - 20_000);
  });
  const stored = await approve(s, id);
  assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.failure, "gasless_rpc_unavailable");
  assert.deepEqual(s.wait.waits, []); assert.equal(stored.bootstrap.signingAttempts, 0);
});

test("a definite refusal is never retried", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  atApproval(s, () => { s.rpc.current = { ...s.rpc.current, balanceAtomic: "1" }; });
  const stored = await approve(s, id);
  assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.failure, "gasless_fee_budget");
  assert.deepEqual(s.wait.waits, []); assert.equal(s.wrapping.loads, 0);
});

test("a receipt a released version wrote with an earlier proof class for the current transition is returned as written", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const stored = await approve(s, id);
  assert.equal(stored.state, "completed");
  const path = join(temporary.root, "gasless-receipts", stored.profileHash, `${id}.json`);
  const current = gaslessReceipt(stored) as unknown as Record<string, unknown>;
  assert.notEqual(current.proof_class, "effect_observation_pending");
  const { receipt_hash: _hash, ...body } = current;
  const historical = { ...body, proof_class: "effect_observation_pending" };
  const written = { ...historical, receipt_hash: hashObject(historical) };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${canonicalJson(written)}\n`, { mode: 0o600 });

  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, true, status.error?.message);
  assert.deepEqual((await s.core.execute({ command: "receipt.get", operationId: id })).receipt, written);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), written);
  // Without that file, the receipt is derived from the operation (phase 4b, CORE-13).
  await rm(path);
  assert.deepEqual((await s.core.execute({ command: "receipt.get", operationId: id })).receipt, current);
});
