import assert from "node:assert/strict";
import test from "node:test";
import { bridgeReceipt } from "../../src/lifi/receipt.js";
import { temporaryState } from "./helpers.js";
import { LIFI_DESTINATION_HASH, lifiFixture } from "./lifi-helpers.js";
import { ApnError } from "../../src/errors.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { observationRpcFailure } from "../../src/lifi/observation-diagnostics.js";

test("LI.FI observation diagnostics retain only the sanitized endpoint role", () => {
  const error = new ApnError("APN_RPC_PROTOCOL", "Bridge validation failed: bridge_RPC_HTTP_status.", {
    reason: "bridge_RPC_HTTP_status", rpcMethod: "eth_getTransactionReceipt", httpStatus: "403", attempts: "1",
    endpointRole: "receipt", endpointUrl: "https://secret.example/token",
  });
  assert.deepEqual(observationRpcFailure("destination", "bridge", error), {
    schemaVersion: "apn.bridge-observation-rpc-failure.v1", stage: "destination_receipt", effectRole: "bridge",
    code: "APN_RPC_PROTOCOL", reason: "bridge_RPC_HTTP_status", rpcMethod: "eth_getTransactionReceipt",
    httpStatus: 403, attempts: 1, endpointRole: "receipt",
  });
});

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
    assert.equal(s.destination.calls.includes("logs"), false);
    s.destination.destinationAvailable = true;
    const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
    assert.equal((resumed.operation as { state: string }).state, "completed"); assert.equal(s.source.submissions.length, 2);
  });
}

test("LI.FI destination inclusion without safe finality remains pending and completes by observing the same hash", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.destination.destinationSafe = false;
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  assert.equal((await s.core.bridges.records.findOperation(id))!.destinationProof, null);
  assert.equal((await s.core.bridges.records.findOperation(id))!.state, "destination_pending");
  assert.equal(s.destination.calls.includes("logs"), false);
  s.destination.destinationSafe = true;
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const record = (await s.core.bridges.records.findOperation(id))!; assert.equal(record.state, "completed");
  assert.equal(record.destinationProof!.transactionHash, LIFI_DESTINATION_HASH); assert.equal(s.source.submissions.length, 2);
});

test("LI.FI safe reverted provider destination remains nonterminal and accepts a later replacement transaction", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  s.destination.destinationStatus = "reverted";
  const { id } = await s.prepare();
  const first = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(first.ok, true, first.error?.message);
  const reverted = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(reverted.state, "unknown_finality"); assert.equal(reverted.terminal, false); assert.equal(reverted.destinationProof, null);
  assert.ok(reverted.usageLease); assert.equal(reverted.failure?.reason, "destination_observation_unavailable");
  assert.deepEqual(reverted.failure?.observationRpc, { schemaVersion: "apn.bridge-observation-rpc-failure.v1",
    stage: "destination_receipt", effectRole: "bridge", code: "APN_RPC_PROTOCOL",
    reason: "destination_transaction_reverted", rpcMethod: "eth_getTransactionReceipt" });
  const statusCalls = s.provider.statusCalls;
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const conflicted = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(s.provider.statusCalls, statusCalls + 1); assert.equal(conflicted.state, "unknown_finality");
  assert.equal(conflicted.failure?.observationRpc?.reason, "destination_transaction_reverted");
  assert.equal(conflicted.destinationProof, null); assert.equal(conflicted.usageLease?.reservationId, reverted.usageLease?.reservationId);

  const replacement = `0x${"78".repeat(32)}` as const;
  s.provider.hint = replacement; s.destination.destinationHash = replacement; s.destination.destinationStatus = "success";
  const recovered = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(recovered.ok, true, recovered.error?.message);
  const completed = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(completed.state, "completed"); assert.equal(completed.destinationProof?.transactionHash, replacement);
  assert.equal(s.destination.calls.includes("logs"), false);
});

test("LI.FI waits without a provider-named destination transaction and preserves the legacy scan cursor", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.provider.hint = null;
  const { id, operation } = await s.prepare("stargateV2");
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const current = (await s.core.bridges.records.findOperation(id))!; assert.equal(current.state, "destination_pending");
  assert.deepEqual(current.destinationScan, operation.destinationScan);
  assert.equal(s.destination.calls.includes("logs"), false);
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
  assert.equal(Object.hasOwn(receipt.observation_rpc_failure as object, "endpoint_role"), false);
  assert.doesNotThrow(() => validateBridgeOperation(current), "old v1 records without optional diagnostics still decode");
});

test("LI.FI source receipt protocol failures persist only allowlisted diagnostics", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const { id } = await s.prepare();
  const secret = "sk-secret-do-not-persist", endpoint = "https://user:password@rpc.example/private?api_key=secret";
  s.source.observe = async () => { throw new ApnError("APN_RPC_PROTOCOL", `provider body ${secret} ${endpoint}`, {
    reason: "receipt_status", rpcMethod: "eth_getTransactionReceipt", httpStatus: "502", attempts: "2",
    endpointRole: "receipt", secret, endpoint, query: "api_key=secret", credentials: "user:password",
    responseBody: `raw provider body ${secret}`,
  } as any); };
  const result = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await s.core.bridges.records.findOperation(id))!;
  assert.deepEqual(current.failure?.observationRpc, { schemaVersion: "apn.bridge-observation-rpc-failure.v1",
    stage: "source_receipt", effectRole: "approval", code: "APN_RPC_PROTOCOL", reason: "receipt_status",
    rpcMethod: "eth_getTransactionReceipt", httpStatus: 502, attempts: 2, endpointRole: "receipt" });
  const projected = bridgeReceipt(current) as ReturnType<typeof bridgeReceipt> & { observation_rpc_failure?: unknown };
  assert.deepEqual(projected.observation_rpc_failure, { schema_version: "apn.bridge-observation-rpc-failure.v1",
    stage: "source_receipt", effect_role: "approval", code: "APN_RPC_PROTOCOL", reason: "receipt_status",
    rpc_method: "eth_getTransactionReceipt", http_status: 502, attempts: 2, endpoint_role: "receipt" });
  const persisted = JSON.stringify({ operation: current, projected });
  for (const forbidden of [secret, endpoint, "password", "api_key", "provider body", "raw provider body", "user:password"])
    assert.equal(persisted.includes(forbidden), false, forbidden);
});

test("LI.FI exact destination receipt log failures persist bounded diagnostics without scanning", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const { id } = await s.prepare(); s.destination.destinationAvailable = false;
  const initial = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(initial.ok, true, initial.error?.message);
  s.destination.destinationAvailable = true;
  s.destination.observe = async () => { throw new ApnError("APN_RPC_PROTOCOL", "unsafe raw response https://rpc.example/key", {
    reason: "receipt_log_membership", rpcMethod: "eth_getTransactionReceipt", httpStatus: "999", attempts: "999",
    responseBody: "authorization: bearer secret",
  } as any); };
  const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(current.failure?.reason, "destination_observation_unavailable");
  assert.deepEqual(current.failure?.observationRpc, { schemaVersion: "apn.bridge-observation-rpc-failure.v1",
    stage: "destination_receipt", effectRole: "bridge", code: "APN_RPC_PROTOCOL", reason: "receipt_log_membership",
    rpcMethod: "eth_getTransactionReceipt" });
  assert.equal(s.destination.calls.includes("logs"), false);
  const persisted = JSON.stringify(bridgeReceipt(current));
  for (const forbidden of ["rpc.example", "authorization", "bearer", "raw response"]) assert.equal(persisted.includes(forbidden), false, forbidden);
  assert.equal(persisted.includes("http_status"), false);
});

test("LI.FI validated safe source evidence resumes without source RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root); s.destination.destinationAvailable = false;
  s.provider.statusValue = "completed_observed";
  const { id } = await s.prepare(); assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const previous = (await s.core.bridges.records.findOperation(id))!; s.source.missingHashes.add(previous.effects[0]!.transactionHash!);
  const sourceCalls = s.source.calls.length, providerCalls = s.provider.statusCalls;
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  const current = (await s.core.bridges.records.findOperation(id))!; assert.equal(current.state, "destination_pending");
  assert.deepEqual(current.effects.map((e) => e.safeProof), previous.effects.map((e) => e.safeProof));
  assert.equal(s.source.calls.length, sourceCalls); assert.equal(s.provider.statusCalls, providerCalls);
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

test("LI.FI validated safe destination proof resumes locally without destination or provider RPC", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const { id } = await s.prepare(); const repair = s.core.bridges.records.repairReceipt.bind(s.core.bridges.records);
  s.core.bridges.records.repairReceipt = async (op) => { if (op.destinationProof !== null) throw new Error("synthetic durable boundary"); await repair(op); };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, false);
  s.core.bridges.records.repairReceipt = repair; const previous = (await s.core.bridges.records.findOperation(id))!;
  const destinationCalls = s.destination.calls.length, providerCalls = s.provider.statusCalls;
  s.destination.changedBlock = true;
  const result = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(result.ok, true, result.error?.message);
  const current = (await s.core.bridges.records.findOperation(id))!; assert.equal(current.state, "completed");
  assert.deepEqual(current.destinationProof, previous.destinationProof); assert.equal(current.terminal, true);
  assert.equal(s.destination.calls.length, destinationCalls); assert.equal(s.provider.statusCalls, providerCalls);
  assert.equal(s.source.submissions.length, 2);
});

test("LI.FI journals destination proof before residual failure and reuses it on retry", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const { id } = await s.prepare(); const observe = s.destination.observe.bind(s.destination);
  s.destination.observe = async (...args) => { const result = await observe(...args); if (result !== null) s.source.failAccount = true; return result; };
  const first = await s.core.execute({ command: "bridge.approve", operationId: id }); assert.equal(first.ok, true, first.error?.message);
  const checkpoint = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(checkpoint.state, "unknown_finality"); assert.ok(checkpoint.destinationProof);
  assert.equal(checkpoint.failure?.reason, "residual_allowance_unavailable");
  const destinationCalls = s.destination.calls.length, providerCalls = s.provider.statusCalls;
  s.source.failAccount = false;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const completed = (await s.core.bridges.records.findOperation(id))!; assert.equal(completed.state, "completed");
  assert.deepEqual(completed.destinationProof, checkpoint.destinationProof);
  assert.equal(s.destination.calls.length, destinationCalls); assert.equal(s.provider.statusCalls, providerCalls);
});
