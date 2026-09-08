import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { keccak256 } from "viem";
import { hashObject } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { bridgeReceipt } from "../../src/lifi/receipt.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { LIFI_DESTINATION_HASH, LIFI_SYNTHETIC_KEY, lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

for (const pair of ["eth-base", "base-arb", "arb-eth"] as const) for (const tool of ["across", "stargateV2"] as const) {
  test(`LI.FI ${tool} ${pair} selected route completes with independently correlated dual-chain proof`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, pair);
    const { id, operation } = await s.prepare(tool); const before = s.wrapping.loads;
    assert.equal(operation.effects.length, 2); assert.equal(operation.effects[1]!.envelope.provisionalGas, true);
    assert.equal(s.source.calls.includes("estimate:bridge"), false); assert.equal(s.source.submissions.length, 0);
    const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
    const record = (await s.core.bridges.records.findOperation(id))!;
    assert.equal(record.state, "completed"); assert.equal(result.proof_class, "rpc_safe_correlated");
    assert.deepEqual(record.effects.map((e) => [e.role, e.submissionAttempts, e.phase]), [["approval", 1, "safe_success"], ["bridge", 1, "safe_success"]]);
    assert.ok(s.source.calls.indexOf("send") < s.source.calls.indexOf("estimate:bridge"));
    assert.equal(record.destinationProof!.transactionHash, LIFI_DESTINATION_HASH); assert.equal(record.failure?.residualAllowance?.amountAtomic, "0");
    assert.equal(s.approval.calls.length, 1); assert.equal(s.approval.calls[0]!.fingerprint, operation.fingerprint);
    assert.equal(s.approval.calls[0]!.exactPhrase, `APPROVE BRIDGE ${operation.fingerprint}`);
    assert.equal(s.source.submissions.length, 2); assert.ok(s.wrapping.loads > before); assert.equal(s.wrapping.creates, 0);
    const receipt = await s.core.execute({ command: "receipt.get", operationId: id }); assert.equal(receipt.ok, true, receipt.error?.message);
    const serialized = JSON.stringify(receipt); assert.equal(serialized.includes(LIFI_SYNTHETIC_KEY), false);
    for (const raw of s.source.submissions) assert.equal(serialized.includes(raw), false);
    const snapshot = JSON.stringify(record), calls = s.source.calls.length;
    await s.core.execute({ command: "operation.resume", operationId: id }); await s.core.execute({ command: "bridge.approve", operationId: id });
    assert.equal(JSON.stringify(await s.core.bridges.records.findOperation(id)), snapshot); assert.equal(s.source.calls.length, calls);
  });
}

test("LI.FI exact existing allowance uses one source effect and globally idempotent replay uses no network", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id, input, operation } = await s.prepare(); assert.deepEqual(operation.effects.map((e) => e.role), ["bridge"]);
  assert.equal(operation.effects[0]!.envelope.provisionalGas, false); const calls = s.source.calls.length, materializations = s.provider.materializeCalls;
  const replay = await s.core.execute(input); assert.equal(replay.ok, true); assert.equal(s.source.calls.length, calls); assert.equal(s.provider.materializeCalls, materializations);
  assert.equal((await s.core.execute({ ...input, route: "route-stargateV2" })).error?.code, "APN_IDEMPOTENCY_CONFLICT");
  await assert.rejects(new OperationService(s.state).resolvePrepare({ kind: "direct_transfer", profileHash: operation.profileHash, operationId: id,
    idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  assert.equal(s.provider.materializeCalls, materializations);
  const approved = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(approved.ok, true, approved.error?.message);
  assert.equal((approved.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 1);
});

test("LI.FI bridge sends after included approval without waiting for safe, and completion waits for both safe effects", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.safeApproval = false;
  const { id } = await s.prepare(); const first = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(first.ok, true, first.error?.message); assert.equal(s.source.submissions.length, 2);
  const pending = (await s.core.bridges.records.findOperation(id))!; assert.equal(pending.state, "source_pending");
  assert.equal(pending.effects[0]!.phase, "included_success"); assert.equal(pending.effects[1]!.phase, "safe_success"); assert.equal(pending.destinationProof, null);
  s.source.safeApproval = true;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  assert.equal((resumed.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 2);
});

test("LI.FI expiry after paid approval preserves its fee and residual allowance, halting the unsent bridge", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.safeApproval = false;
  const { id } = await s.prepare(); const send = s.source.send.bind(s.source);
  s.source.send = async (raw) => { const hash = await send(raw); s.now.setTime(s.now.getTime() + 301_000); return hash; };
  const first = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(first.ok, true, first.error?.message);
  const pending = (await s.core.bridges.records.findOperation(id))!; assert.equal(pending.state, "unknown_finality");
  assert.match(pending.failure!.reason, /^unsent_/); assert.equal(pending.effects[1]!.phase, "unsealed"); assert.equal(s.source.submissions.length, 1);
  s.source.safeApproval = true;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!; assert.equal(record.state, "failed_after_approval");
  assert.ok(BigInt(record.effects[0]!.safeProof!.actualTotalFeeWei) > 0n); assert.equal(record.failure!.residualAllowance!.amountAtomic, s.request.amountAtomic);
  assert.equal(s.source.submissions.length, 1);
});

for (const role of ["approval", "bridge"] as const) test(`LI.FI ${role} safe revert retains paid fees without destination success`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.reverted.add(role);
  const { id } = await s.prepare(); const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!; assert.equal(record.state, "failed_confirmed_revert");
  assert.equal(record.destinationProof, null); assert.equal(s.source.submissions.length, role === "approval" ? 1 : 2);
  assert.ok(BigInt(record.effects.find((e) => e.role === role)!.safeProof!.actualTotalFeeWei) > 0n);
});

for (const reason of ["refusal", "expiry", "last-slot", "nonce", "allowance", "code", "fees", "balance"] as const) test(`LI.FI ${reason} after review has no signed or submitted effect`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); const { id } = await s.prepare();
  const loads = s.wrapping.loads;
  s.approval.confirm = async (input) => {
    s.approval.calls.push(input);
    if (reason === "expiry") s.now.setTime(s.now.getTime() + 301_000);
    if (reason === "last-slot") s.now.setTime(s.now.getTime() + 286_000);
    if (reason === "nonce") s.source.nonce++;
    if (reason === "allowance") s.source.allowance = "1";
    if (reason === "code") s.destination.drift = true;
    if (reason === "fees") s.source.gasPrice = "9000000000";
    if (reason === "balance") s.source.native = 0n;
    return reason !== "refusal";
  };
  const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!; assert.equal(record.state, "failed_before_effect");
  assert.equal(s.source.submissions.length, 0); assert.equal(s.wrapping.loads, loads);
  assert.ok(record.effects.every((e) => e.phase === "unsealed"));
});

for (const boundary of ["signing_started", "sealed", "submitting", "submitted_pending"] as const) test(`LI.FI durable ${boundary} survives receipt-write interruption and never replaces an effect`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare(); const repair = s.core.bridges.records.repairReceipt.bind(s.core.bridges.records);
  s.core.bridges.records.repairReceipt = async (op) => { if (op.effects[0]!.phase === boundary) throw new Error("synthetic durable receipt interruption"); await repair(op); };
  const interrupted = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(interrupted.ok, false);
  const stored = (await s.core.bridges.records.findOperation(id))!; assert.equal(stored.effects[0]!.phase, boundary);
  const restart = await lifiFixture(temporary.root, "eth-base", { ...s, initializeWallet: false });
  const resumed = await restart.core.execute({ command: "operation.resume", operationId: id });
  if (boundary === "signing_started") { assert.equal(resumed.error?.code, "APN_PROVIDER_EFFECT_UNAVAILABLE"); assert.equal(s.source.submissions.length, 0); }
  else if (boundary === "submitting") { assert.equal(resumed.ok, true, resumed.error?.message); assert.equal((resumed.operation as { state: string }).state, "unknown_finality"); assert.equal(s.source.submissions.length, 0); }
  else { assert.equal(resumed.ok, true, resumed.error?.message); assert.equal((resumed.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 1); }
  assert.equal(restart.approval.calls.length, 0);
});

test("LI.FI ambiguous accepted submission recovers after expiry with the original hash and no resend", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare(); const send = s.source.send.bind(s.source);
  s.source.send = async (raw) => { await send(raw); s.source.missingHashes.add(keccak256(raw)); throw new Error("synthetic timeout"); };
  const first = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(first.ok, true, first.error?.message);
  const initial = (await s.core.bridges.records.findOperation(id))!; assert.equal(initial.state, "unknown_finality");
  const uncertain = bridgeReceipt(initial);
  assert.equal(uncertain.fees.actual_source_fees_wei, null); assert.equal(uncertain.fees.unresolved_source_fee_effects.length, 1);
  assert.equal(uncertain.fees.unresolved_source_fee_effects[0]!.included_fee_wei, null);
  assert.equal(uncertain.fees.unresolved_source_fee_effects[0]!.transaction_hash, initial.effects[0]!.transactionHash);
  s.now.setTime(s.now.getTime() + 86_400_000);
  for (let i = 0; i < 2; i++) assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal(s.source.submissions.length, 1);
  await assert.rejects(new OperationService(s.state).assertProfileAvailable(initial.profileHash), { code: "APN_OPERATION_BLOCKED" });
  s.source.missingHashes.clear();
  const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  assert.equal((result.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 1);
  assert.equal((await s.core.bridges.records.findOperation(id))!.effects[0]!.transactionHash, initial.effects[0]!.transactionHash);
});

test("LI.FI missing sealed material is never regenerated and an expired preserved seal is never submitted", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare(); const repair = s.core.bridges.records.repairReceipt.bind(s.core.bridges.records);
  s.core.bridges.records.repairReceipt = async (op) => { if (op.effects[0]!.phase === "sealed") throw new Error("stop at seal"); await repair(op); };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, false);
  const op = (await s.core.bridges.records.findOperation(id))!, path = join(temporary.root, "bridge-effects", op.profileHash, `${id}-bridge.json`);
  const bytes = await readFile(path); await unlink(path); s.core.bridges.records.repairReceipt = repair;
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).error?.code, "APN_PROVIDER_EFFECT_UNAVAILABLE");
  await writeFile(path, bytes, { mode: 0o600 }); s.now.setTime(s.now.getTime() + 301_000);
  const recovered = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(recovered.ok, true, recovered.error?.message);
  assert.equal((recovered.operation as { state: string }).state, "failed_before_effect"); assert.equal(s.source.submissions.length, 0);
  assert.deepEqual(await readFile(path), bytes);
});

test("LI.FI history, immutable effect identities and derived receipt corruption are rejected", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  const forged = structuredClone(operation) as any; forged.kind = "direct_transfer";
  const { integrityHash: _h, ...body } = forged; forged.integrityHash = hashObject(body);
  assert.throws(() => validateBridgeOperation(forged), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => transitionBridge(operation, { state: "completed" }, s.now.toISOString()), { code: "APN_STATE_CORRUPT" });
  const receipt = bridgeReceipt(operation) as any; receipt.transfer.amountAtomic = "1";
  const { receipt_hash: _r, ...receiptBody } = receipt; receipt.receipt_hash = hashObject(receiptBody);
  await writeFile(join(temporary.root, "bridge-receipts", operation.profileHash, `${id}.json`), JSON.stringify(receipt), { mode: 0o600 });
  assert.equal((await s.core.execute({ command: "receipt.get", operationId: id })).error?.code, "APN_STATE_CORRUPT");
  assert.equal(s.source.submissions.length, 0);
});
