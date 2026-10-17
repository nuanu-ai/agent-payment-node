import { approvalCode } from "../../src/approval-code.js";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { keccak256 } from "viem";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import { transitionBridge } from "../../src/lifi/transitions.js";
import { bridgeReceipt } from "../../src/lifi/receipt.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import type { BridgeOperationRecord } from "../../src/lifi/operation-model.js";
import { LIFI_DESTINATION_HASH, LIFI_SYNTHETIC_KEY, lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";
import { findStored } from "./stored-operations.js";

function previousCurrentReceipt(op: BridgeOperationRecord): Record<string, any> {
  const previous = structuredClone(bridgeReceipt(op)) as Record<string, any>;
  delete previous.receipt_hash;
  delete previous.asset_bounds;
  previous.fees.token_loss_bound_atomic =
    (BigInt(op.intent.materialization.request.amountAtomic) - BigInt(op.intent.materialization.minimumOutputAtomic)).toString();
  return { ...previous, receipt_hash: hashObject(previous) };
}
function beforeObservationTelemetryWriter(op: BridgeOperationRecord): BridgeOperationRecord {
  const previous = structuredClone(op) as any; delete previous.observationTelemetry;
  let prior = previous.fingerprint;
  previous.transitions = previous.transitions.map((entry: Record<string, any>) => {
    const body = structuredClone(entry); delete body.observationTelemetry; delete body.transitionHash; body.previousHash = prior;
    const next = { ...body, transitionHash: hashObject(body) }; prior = next.transitionHash; return next;
  });
  delete previous.integrityHash; previous.integrityHash = hashObject(previous);
  return validateBridgeOperation(previous);
}
function receiptBeforeObservationTelemetry(op: BridgeOperationRecord): Record<string, any> {
  const previous = structuredClone(bridgeReceipt(op)) as Record<string, any>;
  delete previous.receipt_hash; delete previous.observation_rpc_telemetry;
  return { ...previous, receipt_hash: hashObject(previous) };
}

for (const pair of ["eth-base", "base-arb", "arb-eth"] as const) for (const tool of ["across", "stargateV2"] as const) {
  test(`LI.FI ${tool} ${pair} selected route completes with independently correlated dual-chain proof`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, pair);
    const { id, operation } = await s.prepare(tool); const before = s.wrapping.loads;
    assert.equal(operation.effects.length, 2); assert.equal(operation.effects[1]!.envelope.provisionalGas, true);
    assert.equal(s.source.calls.includes("estimate:bridge"), false); assert.equal(s.source.submissions.length, 0);
    const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
    const record = (await findStored(s.core.bridges.records, id))!;
    assert.equal(record.state, "completed"); assert.equal(result.proof_class, "rpc_safe_correlated");
    assert.deepEqual(record.effects.map((e) => [e.role, e.submissionAttempts, e.phase]), [["approval", 1, "safe_success"], ["bridge", 1, "safe_success"]]);
    assert.ok(s.source.calls.indexOf("send") < s.source.calls.indexOf("estimate:bridge"));
    assert.equal(record.destinationProof!.transactionHash, LIFI_DESTINATION_HASH); assert.equal(record.failure?.residualAllowance?.amountAtomic, "0");
    assert.equal(s.approval.calls.length, 1); assert.equal(s.approval.calls[0]!.fingerprint, operation.fingerprint);
    assert.equal(s.approval.calls[0]!.exactPhrase, approvalCode("bridge", operation.fingerprint));
    assert.equal(s.source.submissions.length, 2); assert.ok(s.wrapping.loads > before); assert.equal(s.wrapping.creates, 0);
    const receipt = await s.core.execute({ command: "receipt.get", operationId: id }); assert.equal(receipt.ok, true, receipt.error?.message);
    const serialized = JSON.stringify(receipt); assert.equal(serialized.includes(LIFI_SYNTHETIC_KEY), false);
    for (const raw of s.source.submissions) assert.equal(serialized.includes(raw), false);
    const snapshot = JSON.stringify(record), calls = s.source.calls.length;
    await s.core.execute({ command: "operation.resume", operationId: id }); await s.core.execute({ command: "bridge.approve", operationId: id });
    assert.equal(JSON.stringify(await findStored(s.core.bridges.records, id)), snapshot); assert.equal(s.source.calls.length, calls);
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
  const pending = (await findStored(s.core.bridges.records, id))!; assert.equal(pending.state, "source_pending");
  assert.equal(pending.effects[0]!.phase, "included_success"); assert.equal(pending.effects[1]!.phase, "safe_success"); assert.equal(pending.destinationProof, null);
  s.source.safeApproval = true;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  assert.equal((resumed.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 2);
});

test("LI.FI observation phases use independent lazy bounded RPC sessions", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  s.source.safeApproval = false;
  const { id } = await s.prepare(); s.rpcSessions.length = 0;
  const first = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(first.ok, true, first.error?.message); assert.ok(s.rpcSessions.length >= 3);
  const approvalSession = s.rpcSessions[0]; assert.ok(approvalSession); assert.equal(s.rpcSessions[1], approvalSession);
  const approvalUnique = [...new Set(s.rpcSessions)]; assert.equal(approvalUnique.length, 2);
  // Plan-derived caps: the approval invocation's send step (11) and two effects' source observation (16).
  assert.deepEqual(approvalUnique.map((session) => session.telemetry().remainingHttpRequests), [11, 16]);
  s.source.safeApproval = true; s.rpcSessions.length = 0;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message); assert.ok(s.rpcSessions.length >= 4);
  const resumeSession = s.rpcSessions[0]; assert.ok(resumeSession); assert.equal(s.rpcSessions[1], resumeSession);
  const resumeUnique = [...new Set(s.rpcSessions)]; assert.equal(resumeUnique.length, 3);
  // Ethereum USDC to Base USDC with both effects sent: no send step, source cap 16 and destination cap 4, each with two retries.
  // Proven delivery derives its zero residual allowance, so completion opens no residual read session.
  assert.deepEqual(resumeUnique.map((session) => session.telemetry().remainingHttpRequests), [1, 16, 4]);
  assert.deepEqual(resumeUnique.map((session) => session.telemetry().remainingHttpAttempts), [1, 18, 6]);
  assert.notEqual(resumeSession, approvalSession);
});

test("LI.FI exhausted invocation budget leaves an effect unsigned for a fresh resume", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare();
  s.approval.confirm = async () => {
    // Leave exactly one POST of the derived invocation cap: too few to sign and still send.
    const budget = s.rpcSessions.at(-1)!.physicalBudget!;
    (budget as unknown as { posts: number }).posts += budget.remaining() - 1;
    return true;
  };
  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const stored = (await findStored(s.core.bridges.records, id))!;
  assert.equal(stored.effects[0]!.phase, "unsealed"); assert.equal(s.source.submissions.length, 0);
  const restart = await lifiFixture(temporary.root, "eth-base", { ...s, initializeWallet: false });
  const resumed = await restart.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  assert.equal((resumed.operation as { state: string }).state, "completed");
  assert.equal(s.source.submissions.length, 1);
});

test("LI.FI exhausted send slot preserves one durable seal for a fresh resume", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare();
  const originalSeal = s.custody.seal.bind(s.custody);
  s.custody.seal = async (...args) => {
    const material = await originalSeal(...args);
    const budget = s.rpcSessions.at(-1)!.physicalBudget!;
    (budget as unknown as { posts: number }).posts += budget.remaining();
    return material;
  };
  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const stored = (await findStored(s.core.bridges.records, id))!;
  assert.equal(stored.effects[0]!.phase, "sealed"); assert.equal(stored.effects[0]!.submissionAttempts, 0);
  assert.equal(s.source.submissions.length, 0);
  const restart = await lifiFixture(temporary.root, "eth-base", { ...s, initializeWallet: false });
  const resumed = await restart.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  assert.equal((resumed.operation as { state: string }).state, "completed");
  assert.equal(s.source.submissions.length, 1);
});

test("LI.FI expiry after paid approval preserves its fee and residual allowance, halting the unsent bridge", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.safeApproval = false;
  const { id } = await s.prepare(); const send = s.source.send.bind(s.source);
  s.source.send = async (raw) => { const hash = await send(raw); s.now.setTime(s.now.getTime() + 301_000); return hash; };
  const first = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(first.ok, true, first.error?.message);
  const pending = (await findStored(s.core.bridges.records, id))!; assert.equal(pending.state, "unknown_finality");
  assert.match(pending.failure!.reason, /^unsent_/); assert.equal(pending.effects[1]!.phase, "unsealed"); assert.equal(s.source.submissions.length, 1);
  s.source.safeApproval = true;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!; assert.equal(record.state, "failed_after_approval");
  assert.deepEqual(record.effects.map((effect) => [effect.role, effect.phase, effect.submissionAttempts]),
    [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  assert.ok(BigInt(record.effects[0]!.safeProof!.actualTotalFeeWei) > 0n); assert.equal(record.failure!.residualAllowance!.amountAtomic, s.request.amountAtomic);
  assert.equal(s.source.submissions.length, 1);
});

for (const role of ["approval", "bridge"] as const) test(`LI.FI ${role} safe revert retains paid fees without destination success`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.reverted.add(role);
  const { id } = await s.prepare(); const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!; assert.equal(record.state, "failed_confirmed_revert");
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
    // The source deployment check (selector routing, spoke binding) changes after review; a destination reads nothing.
    if (reason === "code") s.source.drift = true;
    if (reason === "fees") s.source.gasPrice = "9000000000";
    if (reason === "balance") s.source.native = 0n;
    return reason !== "refusal";
  };
  const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!; assert.equal(record.state, "failed_before_effect");
  assert.equal(s.source.submissions.length, 0); assert.equal(s.wrapping.loads, loads);
  assert.ok(record.effects.every((e) => e.phase === "unsealed"));
});

for (const boundary of ["signing_started", "sealed", "submitting", "submitted_pending"] as const) test(`LI.FI durable ${boundary} survives an interruption after its write and never replaces an effect`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare(); const persist = s.core.bridges.records.persist.bind(s.core.bridges.records);
  s.core.bridges.records.persist = async (op) => { await persist(op); if (op.effects[0]!.phase === boundary) throw new Error("synthetic interruption after the durable write"); };
  const interrupted = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(interrupted.ok, false);
  const stored = (await findStored(s.core.bridges.records, id))!; assert.equal(stored.effects[0]!.phase, boundary);
  const restart = await lifiFixture(temporary.root, "eth-base", { ...s, initializeWallet: false });
  const resumed = await restart.core.execute({ command: "operation.resume", operationId: id });
  // signing_started without sealed material or a SEND claim signed nothing: resume re-runs the guard and re-seals the same envelope.
  if (boundary === "submitting") { assert.equal(resumed.ok, true, resumed.error?.message); assert.equal((resumed.operation as { state: string }).state, "unknown_finality"); assert.equal(s.source.submissions.length, 0); }
  else { assert.equal(resumed.ok, true, resumed.error?.message); assert.equal((resumed.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 1); }
  assert.equal(restart.approval.calls.length, 0);
});

test("LI.FI ambiguous accepted submission recovers after expiry with the original hash and no resend", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare(); const send = s.source.send.bind(s.source);
  s.source.send = async (raw) => { await send(raw); s.source.missingHashes.add(keccak256(raw)); throw new Error("synthetic timeout"); };
  const first = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(first.ok, true, first.error?.message);
  const initial = (await findStored(s.core.bridges.records, id))!; assert.equal(initial.state, "unknown_finality");
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
  assert.equal((await findStored(s.core.bridges.records, id))!.effects[0]!.transactionHash, initial.effects[0]!.transactionHash);
});

test("LI.FI missing sealed material is never regenerated and an expired preserved seal is never submitted", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare(); const persist = s.core.bridges.records.persist.bind(s.core.bridges.records);
  s.core.bridges.records.persist = async (op) => { await persist(op); if (op.effects[0]!.phase === "sealed") throw new Error("stop at seal"); };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, false);
  const op = (await findStored(s.core.bridges.records, id))!, path = join(temporary.root, "bridge-effects", op.profileHash, `${id}-bridge.json`);
  const bytes = await readFile(path); await unlink(path); s.core.bridges.records.persist = persist;
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
  const receiptPath = join(temporary.root, "bridge-receipts", operation.profileHash, `${id}.json`);
  await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 }); await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  assert.equal((await s.core.execute({ command: "receipt.get", operationId: id })).error?.code, "APN_STATE_CORRUPT");
  assert.equal(s.source.submissions.length, 0);
});

test("LI.FI pre-asset-bounds current-v1 receipt of the current transition is returned as written; without it the receipt is derived", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "eth-linea");
  const { id, operation } = await s.prepare("across", "current-v1-receipt-upgrade");
  const receiptPath = join(temporary.root, "bridge-receipts", operation.profileHash, `${id}.json`);
  await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
  const previous = previousCurrentReceipt(operation), forged = structuredClone(previous);
  forged.transfer.amountAtomic = (BigInt(forged.transfer.amountAtomic) + 1n).toString();
  delete forged.receipt_hash; forged.receipt_hash = hashObject(forged);
  await writeFile(receiptPath, `${canonicalJson(forged)}\n`, { mode: 0o600 });
  await assert.rejects(s.core.bridges.records.loadReceipt(operation.profileHash, id), { code: "APN_STATE_CORRUPT" });

  const calls = s.source.calls.length, submissions = s.source.submissions.length;
  const materializations = s.provider.materializeCalls, wraps = s.wrapping.loads;
  let custodyAccesses = 0;
  s.custody.load = async () => { custodyAccesses++; throw new Error("custody must stay closed"); };
  s.custody.seal = async () => { custodyAccesses++; throw new Error("custody must stay closed"); };
  await writeFile(receiptPath, `${canonicalJson(previous)}\n`, { mode: 0o600 });
  // Phase 4b (CORE-13): a released version's receipt of this transition keeps its own shape; nothing is rewritten.
  assert.deepEqual(await s.core.bridges.records.loadReceipt(operation.profileHash, id), previous);
  assert.deepEqual(JSON.parse(await readFile(receiptPath, "utf8")), previous);
  await rm(receiptPath);
  const derived = await s.core.bridges.records.loadReceipt(operation.profileHash, id) as any;
  assert.notEqual(derived.receipt_hash, previous.receipt_hash);
  assert.equal(derived.asset_bounds.same_denomination, true);
  assert.deepEqual([custodyAccesses, s.wrapping.loads, s.source.calls.length, s.source.submissions.length, s.provider.materializeCalls],
    [0, wraps, calls, submissions, materializations]);
  assert.deepEqual(derived, bridgeReceipt(operation));
});

test("LI.FI pre-telemetry receipt is returned as written for its transition and derived with telemetry after it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, "base-arb"); s.source.sendTimeout = true; s.source.failObserve = true;
  const { id } = await s.prepare("stargateV2", "pre-observation-telemetry-receipt");
  const submitted = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(submitted.ok, true, submitted.error?.message);
  const current = (await findStored(s.core.bridges.records, id))!;
  assert.deepEqual(current.effects.map((effect) => [effect.role, effect.submissionAttempts]), [["approval", 1], ["bridge", 0]]);
  const historical = beforeObservationTelemetryWriter(current), operationPath = join(temporary.root, "bridge-operations", historical.profileHash, `${id}.json`),
    receiptPath = join(temporary.root, "bridge-receipts", historical.profileHash, `${id}.json`), historicalReceipt = receiptBeforeObservationTelemetry(historical);
  await writeFile(operationPath, `${canonicalJson(historical)}\n`, { mode: 0o600 });
  await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 });
  await writeFile(receiptPath, `${canonicalJson(historicalReceipt)}\n`, { mode: 0o600 });
  const journalBefore = await readFile(operationPath);
  assert.deepEqual(await s.core.bridges.records.loadReceipt(historical.profileHash, id), historicalReceipt);
  assert.deepEqual(await readFile(operationPath), journalBefore, "a receipt read must not rewrite the operation journal");
  await rm(receiptPath);
  assert.deepEqual((await s.core.bridges.records.loadReceipt(historical.profileHash, id) as any).observation_rpc_telemetry, []);
  await writeFile(receiptPath, `${canonicalJson(historicalReceipt)}\n`, { mode: 0o600 });
  const loaded = (await findStored(s.core.bridges.records, id))!;
  assert.deepEqual(loaded.effects.map((effect) => [effect.role, effect.submissionAttempts, effect.transactionHash]),
    historical.effects.map((effect) => [effect.role, effect.submissionAttempts, effect.transactionHash]));

  const telemetry = { schemaVersion: "apn.bridge-observation-telemetry.v1" as const, stage: "source_observation" as const,
    effectRole: "approval" as const, outcome: "failure" as const, physicalRequests: 1, httpAttempts: 1, logicalRpcItems: 1,
    batchCount: 0, maxBatchSize: 1, budgetRejectedBeforeTransport: 0,
    attemptsByEndpointRole: { primary: 1, receipt: 0, archive: 0 }, attemptsByMethodClass: { transaction: 1 } };
  const later = new Date(Date.parse(historical.updatedAt) + 1).toISOString();
  // Telemetry alone is diagnostics and never adds a transition; it rides along with the next real observation change.
  assert.equal(transitionBridge(historical, { observationTelemetry: [telemetry] }, later), historical);
  const observed = transitionBridge(historical, { observationTelemetry: [telemetry],
    failure: { reason: "source_observation_unavailable", residualAllowance: null } }, later);
  assert.equal(observed.transitions.length, historical.transitions.length + 1);
  // The released receipt file now belongs to an earlier transition: the current receipt is derived, telemetry included.
  await s.core.bridges.records.writeOperation(observed);
  const exact = bridgeReceipt(observed) as any; assert.deepEqual(await s.core.bridges.records.loadReceipt(observed.profileHash, id), exact);
  const reject = async (mutate: (receipt: any) => void) => {
    const forged = structuredClone(exact); mutate(forged); delete forged.receipt_hash; forged.receipt_hash = hashObject(forged);
    await writeFile(receiptPath, `${canonicalJson(forged)}\n`, { mode: 0o600 });
    await assert.rejects(s.core.bridges.records.loadReceipt(observed.profileHash, id), { code: "APN_STATE_CORRUPT" });
    await writeFile(receiptPath, `${canonicalJson(exact)}\n`, { mode: 0o600 });
  };
  await reject((receipt) => { delete receipt.observation_rpc_telemetry; });
  await reject((receipt) => { receipt.observation_rpc_telemetry[0].physical_requests = 2; });
  await reject((receipt) => { receipt.transfer.amountAtomic = (BigInt(receipt.transfer.amountAtomic) + 1n).toString(); });
  assert.equal(s.source.submissions.length, 1); assert.equal(observed.effects[1]!.submissionAttempts, 0);
});
