import assert from "node:assert/strict";
import test from "node:test";
import type { MetaMaskGaslessBinding, MetaMaskGaslessRequest } from "../../src/metamask-gasless/model.js";
import { mmError } from "../../src/metamask-gasless/reasons.js";
import { OperationService } from "../../src/operation-service.js";
import { mmFixture } from "./metamask-gasless-helpers.js";
import { temporaryState } from "./helpers.js";

/**
 * The window between the owner's approval and the durable dispatch marker. Every check in it is re-taken, so a
 * transport hiccup or a price move inside the owner's maximum is waited out instead of destroying the operation,
 * and every definite refusal still ends it at once, before any effect.
 */
const TRANSPORT = () => mmError("mm_gasless_provider_unavailable");
/** gross 10 USDC, ceiling 0.08, floor 9.90: the owner's maximum leaves room above the prepared fee. */
const HEADROOM: Omit<MetaMaskGaslessRequest, "chainId"> = { recipient: "0x2222222222222222222222222222222222222222",
  grossAtomic: "10000000", maxFeeAtomic: "80000", minReceivedAtomic: "9900000" };

test("a transient provider failure after approval is waited out inside the window and the transfer completes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), { id } = await f.prepare();
  const binding = f.binding;
  let attempts = 0;
  f.provider.inspect = async () => { attempts += 1; if (attempts <= 2) throw TRANSPORT(); return binding; };
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  assert.equal((await f.record(id)).state, "completed");
  assert.deepEqual(f.wait.waits, [5000, 5000]);
  assert.equal(attempts, 3);
  assert.equal(f.provider.submissions.length, 1);
});

test("a persistent transport failure ends before any effect with its precise reason and no dispatch marker", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), { id, operation } = await f.prepare();
  f.provider.inspect = async () => { throw TRANSPORT(); };
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  const stored = await f.record(id);
  assert.equal(stored.state, "failed_before_effect");
  assert.equal(stored.failure?.reason, "mm_gasless_provider_unavailable");
  assert.equal(stored.failure?.code, "APN_PROVIDER_UNAVAILABLE");
  assert.equal(stored.submissionAttempts, 0);
  assert.equal(stored.dispatchStartedAt, null);
  assert.equal(f.provider.submissions.length, 0);
  assert.equal(f.wait.waits.length, 17);
  assert.deepEqual([...new Set(f.wait.waits)], [5000]);
  // Nothing was dispatched, so the operation is terminal and releases the account for a deliberate re-prepare.
  await new OperationService(f.state).assertEvmAccountAvailable(stored.profileHash,
    f.request.chainId, operation.intent.binding.address);
});

test("the bounded retry never runs past the approved window", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), { id } = await f.prepare();
  // 18 s of the 300 s TTL remain: less than the 15 s reserve plus one 5 s pause, so no pause may be taken.
  f.approval.hook = () => f.advance(282_000);
  f.provider.inspect = async () => { throw TRANSPORT(); };
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  const stored = await f.record(id);
  assert.equal(stored.state, "failed_before_effect");
  assert.equal(stored.failure?.reason, "mm_gasless_provider_unavailable");
  assert.deepEqual(f.wait.waits, []);
  assert.equal(f.provider.submissions.length, 0);
});

test("an interrupt ends the wait and the operation at once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), { id } = await f.prepare();
  f.wait.result = "interrupted";
  f.provider.inspect = async () => { throw TRANSPORT(); };
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  assert.equal((await f.record(id)).failure?.reason, "mm_gasless_provider_unavailable");
  assert.deepEqual(f.wait.waits, [5000]);
  assert.equal(f.provider.submissions.length, 0);
});

for (const [name, reason, fail] of [
  ["a changed provider binding", "mm_gasless_binding_changed", (binding: MetaMaskGaslessBinding) =>
    ({ ...binding, revision: binding.revision + 1 })],
  ["a consumed root permission", "mm_gasless_evidence_invalid", null],
] as const) {
  test(`${name} is a definite refusal and is never retried`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const f = await mmFixture(temporary.root), { id } = await f.prepare();
    if (fail === null) f.rpc.state = { ...f.rpc.state, counterAtomic: "1" };
    else { const drifted = fail(f.binding); f.provider.inspect = async () => drifted; }
    const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(response.ok, true, JSON.stringify(response.error));
    const stored = await f.record(id);
    assert.equal(stored.state, "failed_before_effect");
    assert.equal(stored.failure?.reason, reason);
    assert.deepEqual(f.wait.waits, []);
    assert.equal(f.provider.submissions.length, 0);
  });
}

test("an unclassifiable guard failure names the guard, never an unknown APN failure", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), { id } = await f.prepare();
  f.provider.inspect = async () => { throw new Error("private_identity_canary"); };
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  const stored = await f.record(id);
  assert.equal(stored.state, "failed_before_effect");
  assert.equal(stored.failure?.reason, "mm_gasless_guard_unavailable");
  assert.equal(stored.failure?.code, "APN_PROVIDER_UNAVAILABLE");
  assert.deepEqual(f.wait.waits, []);
  assert.equal(JSON.stringify(stored).includes("private_identity_canary"), false);
  assert.equal(f.provider.submissions.length, 0);
});

test("a prepare snapshot older than the observation ceiling no longer destroys an approved transfer", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), { id, operation } = await f.prepare();
  // The owner reads the 25-line screen and types the exact code: past MM_OBSERVATION_MAX_AGE_MS, inside the TTL.
  f.approval.hook = () => f.advance(150_000);
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  const stored = await f.record(id);
  assert.equal(stored.state, "completed");
  assert.equal(stored.submissionAttempts, 1);
  // The frozen snapshot stayed identity evidence; the dispatch clock ran on the snapshot taken at the guard.
  assert.equal(operation.intent.initialSnapshot.observedAt, operation.intent.preparedAt);
  assert.ok(Date.parse(stored.dispatchStartedAt!) - Date.parse(operation.intent.initialSnapshot.observedAt) > 120_000);
  assert.equal(f.provider.submissions.length, 1);
});

test("a fee that moves up inside the owner's maximum is repriced, dispatched and settled at the new price", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root);
  const prepared = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile,
    request: { ...HEADROOM, chainId: f.request.chainId }, idempotencyKey: "mm-reprice-inside-cap-0001" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = (prepared.operation as { operation_id: string }).operation_id;
  const frozen = (await f.record(id)).intent;
  assert.equal(frozen.quote.feeAtomic, "50000");
  assert.equal(frozen.quote.netAtomic, "9950000");

  f.approval.hook = () => { f.provider.fees = ["70000"]; f.provider.feeAt = 0; };
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  const stored = await f.record(id);
  assert.equal(stored.state, "completed");
  assert.equal(stored.dispatch?.quote.feeAtomic, "70000");
  assert.equal(stored.dispatch?.quote.netAtomic, "9930000");
  assert.notEqual(stored.dispatch?.delegationHash, frozen.delegationHash);
  // The POST carried the repriced batch and its re-derived delegation, never the prepared one.
  const submitted = f.provider.submissions[0]!;
  assert.equal(submitted.quote.feeAtomic, "70000");
  assert.equal(submitted.delegationHash, stored.dispatch?.delegationHash);
  assert.equal(submitted.quote.hash, stored.dispatch?.quote.hash);
  assert.equal(stored.settlement?.feeAtomic, "70000");
  assert.equal(stored.settlement?.deliveredAtomic, "9930000");
  assert.equal(stored.settlement?.debitAtomic, "10000000");
  // The intent stays immutable, so the fingerprint the owner approved is unchanged.
  assert.equal(stored.intent.quote.feeAtomic, "50000");
  assert.equal(stored.fingerprint, (await f.record(id)).fingerprint);
  const receipt = await f.core.metaMaskGasless.receipt(id);
  assert.equal(receipt.transfer.frozen_fee_atomic, "70000");
  assert.equal(receipt.transfer.user_max_fee_atomic, "80000");
  assert.equal(receipt.permission.delegation_hash, stored.dispatch?.delegationHash);
});

test("a fee above the owner's maximum is waited out and then refused, with nothing dispatched", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root);
  const prepared = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile,
    request: { ...HEADROOM, chainId: f.request.chainId }, idempotencyKey: "mm-reprice-above-cap-0001" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = (prepared.operation as { operation_id: string }).operation_id;
  f.approval.hook = () => { f.provider.fees = ["80001"]; f.provider.feeAt = 0; };
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  const stored = await f.record(id);
  assert.equal(stored.state, "failed_before_effect");
  assert.equal(stored.failure?.reason, "mm_gasless_fee_cap");
  assert.equal(stored.failure?.code, "APN_FEE_BUDGET_EXCEEDED");
  assert.deepEqual([...new Set(f.wait.waits)], [5000]);
  assert.equal(stored.dispatch, null);
  assert.equal(stored.submissionAttempts, 0);
  assert.equal(stored.dispatchStartedAt, null);
  assert.equal(f.wait.waits.length, 17);
  assert.equal(f.provider.submissions.length, 0);
});

test("a fee that moves down is dispatched at the lower price, so the ceiling is the binding number", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), { id, operation } = await f.prepare();
  assert.equal(operation.intent.quote.feeAtomic, "50000");
  f.approval.hook = () => { f.provider.fees = ["30000"]; f.provider.feeAt = 0; };
  const response = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(response.ok, true, JSON.stringify(response.error));
  const stored = await f.record(id);
  assert.equal(stored.state, "completed");
  assert.equal(stored.dispatch?.quote.feeAtomic, "30000");
  assert.equal(stored.dispatch?.quote.netAtomic, "9970000");
  assert.equal(f.provider.submissions[0]?.quote.feeAtomic, "30000");
  assert.equal(stored.settlement?.feeAtomic, "30000");
  assert.deepEqual(f.wait.waits, []);
});
