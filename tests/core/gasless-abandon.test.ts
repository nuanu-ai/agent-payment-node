import assert from "node:assert/strict";
import test from "node:test";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { OperationService } from "../../src/operation-service.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";
import { MM_TEST_RECIPIENT, mmFixture, mmWriteOperationFile } from "./metamask-gasless-helpers.js";
import { fillLegacyHistory } from "./metamask-gasless-journal-fixtures/factory.js";

class AbandonApproval implements OperationAbandonApprovalPort {
  calls: OperationAbandonIntent[] = [];
  async approve(intent: OperationAbandonIntent) { this.calls.push(intent); }
}

test("local gasless unknown effect is owner-abandoned only after its approval window and never re-sent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const approval = new AbandonApproval();
  const s = await gaslessFixture(temporary.root, 8453, { abandonApproval: approval }), { id } = await s.prepare();
  s.rpc.estimateFails = true;
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const before = await s.record(id);
  assert.equal(before.state, "unknown_finality"); assert.equal(before.bootstrap.disclosureAttempts, 1);
  const estimates = s.rpc.calls.filter((c) => c === "estimate").length, sends = s.rpc.sends.length;
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(approval.calls.length, 0);
  s.rpc.result = "missing"; s.now.setTime(s.now.getTime() + 360000);
  const abandoned = await s.core.execute({ command: "operation.abandon", operationId: id });
  assert.equal(abandoned.ok, true, abandoned.error?.message);
  const after = await s.record(id);
  assert.equal(after.state, "abandoned_unknown"); assert.equal(after.terminal, true);
  assert.equal(approval.calls.length, 1); assert.equal(approval.calls[0]!.operationId, id);
  assert.equal(approval.calls[0]!.chainLabel, "Base (8453)"); assert.equal(approval.calls[0]!.unit, "USDC");
  assert.equal(s.rpc.calls.filter((c) => c === "estimate").length, estimates); assert.equal(s.rpc.sends.length, sends);
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal((receipt.receipt as { state: string }).state, "abandoned_unknown");
  await new OperationService(s.state).assertProfileAvailable(after.profileHash);
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).ok, true);
  assert.equal(approval.calls.length, 1);
});

test("local gasless owner abandonment refuses a terminal operation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const approval = new AbandonApproval();
  const s = await gaslessFixture(temporary.root, 8453, { abandonApproval: approval }), { id } = await s.prepare();
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await s.record(id)).state, "submitted_pending");
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal((await s.record(id)).state, "completed");
  s.now.setTime(s.now.getTime() + 360000);
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(approval.calls.length, 0);
});

test("MetaMask gasless unknown relay is owner-abandoned only after its approval window and never re-submitted", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const approval = new AbandonApproval();
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: approval }), { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await f.record(id)).state, "unknown_finality");
  const submissions = f.provider.submissions.length;
  assert.equal((await f.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(approval.calls.length, 0);
  f.now.setTime(f.now.getTime() + 600_000); f.provider.failObserve = true;
  const abandoned = await f.core.execute({ command: "operation.abandon", operationId: id });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error));
  const after = await f.record(id);
  assert.equal(after.state, "abandoned_unknown"); assert.equal(after.terminal, true);
  assert.equal(approval.calls.length, 1); assert.equal(approval.calls[0]!.providerId, "metamask-agent-wallet");
  assert.equal(f.provider.submissions.length, submissions);
  const receipt = await f.core.execute({ command: "receipt.get", operationId: id });
  assert.equal((receipt.receipt as { state: string }).state, "abandoned_unknown");
  await new OperationService(f.state).assertProfileAvailable(after.profileHash);
});

test("a canonically reverted MetaMask relay leaves a live delegation; the owner may release it after its window (R4)", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const approval = new AbandonApproval();
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: approval }), { id } = await f.prepare();
  f.rpc.phase = "reverted";
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await f.record(id)).state, "failed_effects_pending");
  assert.equal((await f.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  f.now.setTime(f.now.getTime() + 600_000); f.provider.failObserve = true;
  const abandoned = await f.core.execute({ command: "operation.abandon", operationId: id });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error));
  const after = await f.record(id);
  assert.equal(after.state, "abandoned_unknown"); assert.equal(after.terminal, true); assert.equal(approval.calls.length, 1);
  await new OperationService(f.state).assertProfileAvailable(after.profileHash);
});

test("MetaMask gasless owner abandonment still fits a journal an earlier release filled to the history limit", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const approval = new AbandonApproval();
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: approval }), { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  const full = fillLegacyHistory(await f.record(id), 96);
  await mmWriteOperationFile(temporary.root, full);
  f.now.setTime(f.now.getTime() + 600_000); f.provider.failObserve = true;
  const abandoned = await f.core.execute({ command: "operation.abandon", operationId: id });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error));
  const after = await f.record(id);
  assert.equal(after.state, "abandoned_unknown"); assert.equal(after.transitions.length, 97);
  assert.equal(approval.calls.length, 1);
  assert.equal(((await f.core.execute({ command: "receipt.get", operationId: id })).receipt as { state: string }).state, "abandoned_unknown");
  await new OperationService(f.state).assertProfileAvailable(after.profileHash);
});

test("MetaMask abandonment shows the dispatched gross and, for a fixed net, the approved ceiling beside it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const approval = new AbandonApproval();
  const f = await mmFixture(temporary.root, 42161, "empty", { abandonApproval: approval });
  f.provider.fees = ["17443", "17479"]; f.rpc.state = { ...f.rpc.state, usdcBalanceAtomic: "40000" };
  const request = { chainId: 42161 as const, recipient: MM_TEST_RECIPIENT, grossAtomic: "25000", maxFeeAtomic: "24000",
    minReceivedAtomic: "1000", fixedNet: { netAtomic: "1000", maxGrossAtomic: "25000" } };
  const prepared = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request, idempotencyKey: "mm-abandon-fixed-net" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error)); const id = (prepared.operation as { operation_id: string }).operation_id;
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await f.record(id)).dispatch?.quote.feeAtomic, "17479");
  f.now.setTime(f.now.getTime() + 600_000); f.provider.failObserve = true;
  assert.equal((await f.core.execute({ command: "operation.abandon", operationId: id })).ok, true);
  const shown = approval.calls[0]!;
  assert.deepEqual([shown.amountAtomic, shown.amountDecimal, shown.budgetCeilingAtomic, shown.budgetCeilingDecimal],
    ["18479", "0.018479", "25000", "0.025"]);
});
