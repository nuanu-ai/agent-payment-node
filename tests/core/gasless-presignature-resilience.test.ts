import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const approve = async (s: Awaited<ReturnType<typeof gaslessFixture>>, id: string) => {
  const response = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, response.error?.message);
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
  atApproval(s, () => { s.rpc.transport = 3; });
  const stored = await approve(s, id);
  assert.equal(stored.state, "completed");
  assert.deepEqual(s.wait.waits, [5000, 5000, 5000]);
  assert.equal(s.rpc.sends.length, 1);
});

test("a transport failure that never clears ends before any signature and names the transport", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  atApproval(s, () => { s.rpc.transport = 100; });
  const stored = await approve(s, id);
  assert.equal(stored.state, "failed_before_effect"); assert.equal(stored.failure, "gasless_rpc_unavailable");
  assert.equal(stored.bootstrap.signingAttempts, 0); assert.equal(s.wrapping.loads, 0);
  assert.equal(s.wait.waits.length, 17); assert.equal(s.rpc.sends.length, 0);
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, 0);
  await new OperationService(s.state).assertProfileAvailable(stored.profileHash);
});

test("an unavailable mirror estimate is retried, and a misfit still ends at once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  s.rpc.mirrorUnavailable = 2;
  const stored = await approve(s, id);
  assert.equal(stored.state, "completed");
  assert.equal(s.rpc.calls.filter((c) => c === "mirror_estimate").length, 3);
  assert.deepEqual(s.wait.waits, [5000, 5000]);

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

test("a receipt written with an earlier proof class is accepted and repaired", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root), { id } = await s.prepare();
  const stored = await approve(s, id);
  assert.equal(stored.state, "completed");
  const path = join(temporary.root, "gasless-receipts", stored.profileHash, `${id}.json`);
  const raw = await readFile(path, "utf8"), current = JSON.parse(raw) as Record<string, unknown>;
  assert.notEqual(current.proof_class, "effect_observation_pending");
  const { receipt_hash: _hash, ...body } = current;
  const historical = { ...body, proof_class: "effect_observation_pending" };
  const ending = raw.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${canonicalJson({ ...historical, receipt_hash: hashObject(historical) })}${ending}`);

  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, true, status.error?.message);
  const repaired = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  assert.equal(repaired.proof_class, current.proof_class);
  assert.equal(repaired.receipt_hash, current.receipt_hash);
});
