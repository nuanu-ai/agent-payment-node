import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "../../src/model.js";
import { bridgeReceipt } from "../../src/lifi/receipt.js";
import { temporaryState } from "./helpers.js";
import { LIFI_DESTINATION_HASH, lifiFixture } from "./lifi-helpers.js";
import { ApnError } from "../../src/errors.js";

test("LI.FI Across slow-fill delivery persists an empty repayment credit and reserve-funded exact output", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  s.destination.destinationFillType = 2; const { id } = await s.prepare("across");
  const completed = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(completed.ok, true, completed.error?.message);
  const op = (await s.core.bridges.records.findOperation(id))!; assert.equal(op.state, "completed");
  assert.equal(op.destinationProof!.fillType, 2); assert.equal(op.destinationProof!.relayerCredit, `0x${"00".repeat(32)}`);
  assert.equal(op.destinationProof!.repaymentChainIdAtomic, "0"); assert.equal(s.source.submissions.length, 2);
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id }); assert.equal(receipt.ok, true, receipt.error?.message);
  assert.equal((receipt.receipt as ReturnType<typeof bridgeReceipt>).destination_proof!.fillType, 2);
});

for (const status of ["not_found", "pending", "completed_observed", "partial_observed", "refund_observed", "failed_observed", "unknown"] as const) {
  test(`LI.FI provider ${status} cannot replace independently safe destination evidence`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
    s.provider.statusValue = status; s.destination.destinationAvailable = false;
    const { id } = await s.prepare(); const result = await s.core.execute({ command: "bridge.approve", operationId: id });
    assert.equal(result.ok, true, result.error?.message); const record = (await s.core.bridges.records.findOperation(id))!;
    assert.equal(record.terminal, false); assert.equal(record.destinationProof, null);
    assert.equal(record.state, ["not_found", "pending", "completed_observed"].includes(status) ? "destination_pending" : "unknown_finality");
    assert.ok(record.effects.every((e) => e.phase === "safe_success")); assert.equal(s.source.submissions.length, 2);
    s.destination.destinationAvailable = true;
    const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
    assert.equal((resumed.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 2);
  });
}

test("LI.FI destination inclusion without safe finality remains pending and completes by observing the same hash", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.destination.destinationSafe = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  assert.equal((await s.core.bridges.records.findOperation(id))!.destinationProof, null);
  s.destination.destinationSafe = true;
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const record = (await s.core.bridges.records.findOperation(id))!; assert.equal(record.state, "completed");
  assert.equal(record.destinationProof!.transactionHash, LIFI_DESTINATION_HASH); assert.equal(s.source.submissions.length, 2);
});

test("LI.FI Stargate cached delivery followed by a later retry scans all matching candidates", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.provider.hint = null;
  const { id } = await s.prepare("stargateV2"); const cached = `0x${"cd".repeat(32)}` as Hex, block = await s.destination.block("2000");
  s.destination.scanRows = [cached, LIFI_DESTINATION_HASH].map((transactionHash) => ({ transactionHash, blockNumberAtomic: "2000", blockHash: block.hash }));
  const observe = s.destination.observe.bind(s.destination), candidates: Hex[] = [];
  s.destination.observe = async (hash, envelope) => {
    candidates.push(hash); const found = await observe(hash === cached ? LIFI_DESTINATION_HASH : hash, envelope);
    return hash !== cached || found === null ? found : { ...found, receipt: { ...found.receipt, transactionHash: cached, logs: [] } };
  };
  const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  assert.equal((result.operation as { state: string }).state, "completed"); assert.deepEqual(candidates, [cached, LIFI_DESTINATION_HASH]);
  assert.equal(s.destination.scanned.length, 1); assert.equal(s.destination.scanned[0]!.topics.length, 3);
});

test("LI.FI destination cursor advances by at most 1024 blocks and rejects a changed previous boundary", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.provider.hint = null;
  const { id } = await s.prepare(); const block = s.destination.block.bind(s.destination);
  s.destination.block = async (tag) => await block(tag === "safe" ? "6500" : tag);
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  assert.equal((await s.core.bridges.records.findOperation(id))!.destinationScan.nextBlockAtomic, "3024");
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const previous = (await s.core.bridges.records.findOperation(id))!; assert.equal(previous.destinationScan.nextBlockAtomic, "4048");
  assert.deepEqual(s.destination.scanned.map((r) => [r.fromBlockAtomic, r.toBlockAtomic]), [["2000", "3023"], ["3024", "4047"]]);
  s.destination.changedBlock = true;
  const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await s.core.bridges.records.findOperation(id))!; assert.equal(current.state, "unknown_finality");
  assert.deepEqual(current.destinationScan, previous.destinationScan); assert.equal(s.destination.scanned.length, 2);
});

test("LI.FI unresolved destination candidates never advance the scan cursor", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.provider.hint = null;
  const { id, operation } = await s.prepare(); s.destination.destinationAvailable = false;
  s.destination.scanRows = [{ transactionHash: LIFI_DESTINATION_HASH, blockNumberAtomic: "2000", blockHash: (await s.destination.block("2000")).hash }];
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const current = (await s.core.bridges.records.findOperation(id))!; assert.equal(current.state, "unknown_finality");
  assert.deepEqual(current.destinationScan, operation.destinationScan);
});

for (const role of ["approval", "bridge"] as const) test(`LI.FI included ${role} reorg preserves submitted identities and cannot complete`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  s.source.safeApproval = false; s.source.safeBridge = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const before = (await s.core.bridges.records.findOperation(id))!, hash = before.effects.find((e) => e.role === role)!.transactionHash!;
  s.source.missingHashes.add(hash);
  const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(current.state, "unknown_finality"); assert.equal(current.effects.find((e) => e.role === role)!.includedProof, null);
  assert.equal(current.failure?.reason, "source_observation_unavailable");
  assert.deepEqual(current.failure?.observationRpc, { schemaVersion: "apn.bridge-observation-rpc-failure.v1",
    stage: "source_observation", effectRole: role, code: "APN_RECEIPT_NOT_FOUND" });
  assert.equal(current.destinationProof, null); assert.equal(current.terminal, false);
  assert.deepEqual(current.effects.map((e) => e.transactionHash), before.effects.map((e) => e.transactionHash));
  if (role === "bridge") assert.equal(current.sourceProof, null);
  s.source.missingHashes.clear(); s.source.safeApproval = true; s.source.safeBridge = true;
  const recovered = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(recovered.ok, true, recovered.error?.message);
  assert.equal((recovered.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 2);
});

test("LI.FI source observation errors replace stale projection with a bounded safe diagnostic", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const { id } = await s.prepare();
  s.source.observe = async () => { throw new ApnError("APN_RPC_AMBIGUOUS", "synthetic unavailable", { transportReason: "timeout" }); };
  const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(current.state, "unknown_finality"); assert.equal(current.failure?.reason, "source_observation_unavailable");
  assert.deepEqual(current.failure?.observationRpc, { schemaVersion: "apn.bridge-observation-rpc-failure.v1",
    stage: "source_observation", effectRole: "approval", code: "APN_RPC_AMBIGUOUS" });
  const receipt = bridgeReceipt(current) as ReturnType<typeof bridgeReceipt> & { observation_rpc_failure?: unknown };
  assert.deepEqual(receipt.observation_rpc_failure, { schema_version: "apn.bridge-observation-rpc-failure.v1",
    stage: "source_observation", effect_role: "approval", code: "APN_RPC_AMBIGUOUS" });
});

test("LI.FI contradiction to safe source evidence preserves it and waits for the original canonical proof", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.destination.destinationAvailable = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const previous = (await s.core.bridges.records.findOperation(id))!; s.source.missingHashes.add(previous.effects[0]!.transactionHash!);
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const current = (await s.core.bridges.records.findOperation(id))!; assert.equal(current.state, "unknown_finality");
  assert.deepEqual(current.effects.map((e) => e.safeProof), previous.effects.map((e) => e.safeProof));
  s.source.missingHashes.clear(); s.destination.destinationAvailable = true;
  const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  assert.equal((result.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 2);
});

test("LI.FI unchanged polling does not grow history, including changed provider timestamps and response hashes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.destination.destinationAvailable = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const previous = (await s.core.bridges.records.findOperation(id))!;
  for (let i = 0; i < 3; i++) { s.now.setTime(s.now.getTime() + 60_000); assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true); }
  assert.deepEqual(await s.core.bridges.records.findOperation(id), previous);
});

test("LI.FI interruption after durable destination evidence repairs its receipt and rechecks the same delivery", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const { id } = await s.prepare(); const repair = s.core.bridges.records.repairReceipt.bind(s.core.bridges.records);
  s.core.bridges.records.repairReceipt = async (op) => { if (op.destinationProof !== null) throw new Error("synthetic derived receipt write failure"); await repair(op); };
  const first = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(first.ok, false);
  const previous = (await s.core.bridges.records.findOperation(id))!; assert.ok(previous.destinationProof); assert.equal(previous.terminal, false);
  const restart = await lifiFixture(temporary.root, "eth-base", { ...s, initializeWallet: false });
  const result = await restart.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await restart.core.bridges.records.findOperation(id))!; assert.equal(current.state, "completed");
  assert.deepEqual(current.destinationProof, previous.destinationProof); assert.equal(s.source.submissions.length, 2);
  assert.deepEqual(await restart.core.bridges.records.loadReceipt(current.profileHash, id), bridgeReceipt(current));
});

test("LI.FI safe destination contradiction after a partial local commit never replaces delivery identity", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const { id } = await s.prepare(); const repair = s.core.bridges.records.repairReceipt.bind(s.core.bridges.records);
  s.core.bridges.records.repairReceipt = async (op) => { if (op.destinationProof !== null) throw new Error("synthetic durable boundary"); await repair(op); };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, false);
  s.core.bridges.records.repairReceipt = repair; const previous = (await s.core.bridges.records.findOperation(id))!;
  s.destination.changedBlock = true;
  const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await s.core.bridges.records.findOperation(id))!; assert.equal(current.state, "unknown_finality");
  assert.deepEqual(current.destinationProof, previous.destinationProof); assert.equal(current.terminal, false);
  s.destination.changedBlock = false;
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal((await s.core.bridges.records.findOperation(id))!.state, "completed"); assert.equal(s.source.submissions.length, 2);
});
