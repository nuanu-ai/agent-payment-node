import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import type { BridgeOperationRecord, BridgePreSignRpcFailure } from "../../src/lifi/operation-model.js";
import { validateBridgeOperation } from "../../src/lifi/operation-validation.js";
import { bridgeRpcCall } from "../../src/lifi/rpc.js";
import { lifiFixture } from "./lifi-helpers.js";
import { temporaryState } from "./helpers.js";

const secret = "provider-secret-token";
const endpoint = `https://user:${secret}@rpc.example/private?key=${secret}`;

test("LI.FI RPC transport ambiguity keeps only the JSON-RPC method", async () => {
  const transport = { request: async () => { throw new ApnError("APN_RPC_AMBIGUOUS", `failed at ${endpoint}`, { leaked: secret }); } };
  const rpc = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://rpc.example" }, { transport });
  await assert.rejects(rpc.call("eth_getCode", ["0x0000000000000000000000000000000000000000", "latest"]), (error: unknown) => {
    assert.ok(error instanceof ApnError); assert.equal(error.code, "APN_RPC_AMBIGUOUS");
    assert.deepEqual(error.details, { rpcMethod: "eth_getCode" });
    assert.equal(JSON.stringify(error).includes(secret), false); assert.equal(error.message.includes(endpoint), false);
    return true;
  });
});

const cases: readonly Readonly<{
  name: string;
  stage: BridgePreSignRpcFailure["stage"];
  chainRole: BridgePreSignRpcFailure["chainRole"];
  category: BridgePreSignRpcFailure["category"];
  method: NonNullable<BridgePreSignRpcFailure["method"]>;
  fail: (fixture: Awaited<ReturnType<typeof lifiFixture>>, error: ApnError) => void;
}>[] = [
  { name: "source deployment transport", stage: "source_deployment_refresh", chainRole: "source", category: "deployment_refresh",
    method: "eth_getCode", fail: (s, error) => { s.source.deployment = async () => { throw error; }; } },
  { name: "destination deployment trace probe transport", stage: "destination_deployment_refresh", chainRole: "destination", category: "deployment_refresh",
    method: "debug_traceTransaction", fail: (s, error) => { s.destination.deployment = async () => { throw error; }; } },
  { name: "source account and nonce transport", stage: "source_account_refresh", chainRole: "source", category: "account_nonce",
    method: "eth_getTransactionCount", fail: (s, error) => { s.source.account = async () => { throw error; }; } },
  { name: "source simulation transport", stage: "source_execution_simulation", chainRole: "source", category: "simulation",
    method: "eth_estimateGas", fail: (s, error) => { s.source.estimate = async () => { throw error; }; } },
  { name: "source fee quote transport", stage: "source_fee_quote", chainRole: "source", category: "fee_quote",
    method: "eth_call", fail: (s, error) => { s.source.feeQuote = async () => { throw error; }; } },
];

for (const row of cases) test(`LI.FI ${row.name} persists only its exact redacted pre-sign boundary`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  const loads = s.wrapping.loads;
  row.fail(s, new ApnError("APN_RPC_AMBIGUOUS", `transport failed at ${endpoint}`, { rpcMethod: row.method, leaked: secret }));

  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!;
  const expected: BridgePreSignRpcFailure = {
    schemaVersion: "apn.bridge-presign-rpc-failure.v1", phase: "pre_sign_guard", effectRole: "approval",
    stage: row.stage, chainRole: row.chainRole, chainId: row.chainRole === "source"
      ? operation.intent.materialization.request.fromChainId : operation.intent.materialization.request.toChainId,
    category: row.category, method: row.method,
  };
  assert.equal(record.state, "failed_before_effect");
  assert.equal(record.failure?.reason, "unsent_apn_rpc_ambiguous");
  assert.deepEqual(record.failure?.preSignRpc, expected);
  assert.ok(record.effects.every((effect) => effect.phase === "unsealed" && effect.submissionAttempts === 0));
  assert.equal(s.source.submissions.length, 0); assert.equal(s.wrapping.loads, loads);

  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, true, status.error?.message);
  assert.deepEqual((status.operation as any).pre_sign_rpc_failure, {
    schema_version: expected.schemaVersion, phase: expected.phase, effect_role: expected.effectRole,
    stage: expected.stage, chain_role: expected.chainRole, chain_id: expected.chainId,
    category: expected.category, method: expected.method,
  });
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(receipt.ok, true, receipt.error?.message);
  assert.deepEqual((receipt.receipt as any).pre_sign_rpc_failure, (status.operation as any).pre_sign_rpc_failure);
  const durable = await readFile(join(temporary.root, "bridge-operations", record.profileHash, `${id}.json`), "utf8");
  const serialized = JSON.stringify({ durable, status, receipt });
  assert.equal(serialized.includes(endpoint), false); assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("leaked"), false);
});

test("LI.FI bridge simulation ambiguity after safe approval retains its redacted boundary without bridge signing or send", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  const estimate = s.source.estimate.bind(s.source);
  s.source.estimate = async (transaction) => {
    if (transaction.to === operation.effects.at(-1)!.envelope.to && s.source.allowance === s.request.amountAtomic) {
      throw new ApnError("APN_RPC_AMBIGUOUS", `transport failed at ${endpoint}`, { rpcMethod: "eth_estimateGas", leaked: secret });
    }
    return await estimate(transaction);
  };

  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!;
  const expected: BridgePreSignRpcFailure = { schemaVersion: "apn.bridge-presign-rpc-failure.v1", phase: "pre_sign_guard",
    effectRole: "bridge", stage: "source_execution_simulation", chainRole: "source",
    chainId: operation.intent.materialization.request.fromChainId, category: "simulation", method: "eth_estimateGas" };
  assert.equal(record.state, "failed_after_approval"); assert.equal(record.failure?.reason, "unsent_apn_rpc_ambiguous");
  assert.deepEqual(record.failure?.preSignRpc, expected);
  assert.deepEqual(record.effects.map(({ role, phase, submissionAttempts }) => ({ role, phase, submissionAttempts })), [
    { role: "approval", phase: "safe_success", submissionAttempts: 1 },
    { role: "bridge", phase: "unsealed", submissionAttempts: 0 },
  ]);
  assert.equal(s.source.submissions.length, 1);

  const status = await s.core.execute({ command: "operation.status", operationId: id });
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(status.ok, true, status.error?.message); assert.equal(receipt.ok, true, receipt.error?.message);
  assert.equal((status.operation as any).pre_sign_rpc_failure.effect_role, "bridge");
  assert.equal((status.operation as any).pre_sign_rpc_failure.stage, "source_execution_simulation");
  assert.equal((status.operation as any).pre_sign_rpc_failure.method, "eth_estimateGas");
  assert.deepEqual((receipt.receipt as any).pre_sign_rpc_failure, (status.operation as any).pre_sign_rpc_failure);
  const serialized = JSON.stringify({ record, status, receipt });
  assert.equal(serialized.includes(endpoint), false); assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes("leaked"), false);

  const loads = s.wrapping.loads;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message); assert.equal(s.source.submissions.length, 1); assert.equal(s.wrapping.loads, loads);

  assert.throws(() => validateBridgeOperation(resealFailure(record, { reason: "unsent_apn_operation_blocked" })), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateBridgeOperation(resealFailure(record, { bridgePhase: "signing_started" })), { code: "APN_STATE_CORRUPT" });
});

test("LI.FI safe approval keeps bridge ambiguity when residual allowance read fails, then terminalizes with the same diagnostic", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  const estimate = s.source.estimate.bind(s.source);
  s.source.estimate = async (transaction) => {
    if (transaction.to === operation.effects.at(-1)!.envelope.to && s.source.allowance === s.request.amountAtomic) {
      s.source.failAccount = true;
      throw new ApnError("APN_RPC_AMBIGUOUS", `transport failed at ${endpoint}`, { rpcMethod: "eth_estimateGas", leaked: secret });
    }
    return await estimate(transaction);
  };

  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!;
  const expected: BridgePreSignRpcFailure = { schemaVersion: "apn.bridge-presign-rpc-failure.v1", phase: "pre_sign_guard",
    effectRole: "bridge", stage: "source_execution_simulation", chainRole: "source",
    chainId: operation.intent.materialization.request.fromChainId, category: "simulation", method: "eth_estimateGas" };
  assert.equal(record.state, "unknown_finality"); assert.equal(record.failure?.reason, "unsent_apn_rpc_ambiguous");
  assert.deepEqual(record.failure?.preSignRpc, expected); assert.equal(record.failure?.residualAllowance, null);
  assert.equal(record.failure?.residualAllowanceStatus, "unavailable");
  assert.deepEqual(record.effects.map(({ role, phase, submissionAttempts }) => ({ role, phase, submissionAttempts })), [
    { role: "approval", phase: "safe_success", submissionAttempts: 1 },
    { role: "bridge", phase: "unsealed", submissionAttempts: 0 },
  ]);
  assert.equal(s.source.submissions.length, 1);

  const status = await s.core.execute({ command: "operation.status", operationId: id });
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(status.ok, true, status.error?.message); assert.equal(receipt.ok, true, receipt.error?.message);
  assert.equal((status.operation as any).reason, "unsent_apn_rpc_ambiguous");
  assert.equal((status.operation as any).residual_allowance_status, "unavailable");
  assert.equal((status.operation as any).pre_sign_rpc_failure.method, "eth_estimateGas");
  assert.deepEqual((receipt.receipt as any).pre_sign_rpc_failure, (status.operation as any).pre_sign_rpc_failure);
  const serialized = JSON.stringify({ record, status, receipt });
  assert.equal(serialized.includes(endpoint), false); assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes("leaked"), false);

  const loads = s.wrapping.loads; s.source.failAccount = false;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  const recovered = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(recovered.state, "failed_after_approval"); assert.equal(recovered.failure?.reason, "unsent_apn_rpc_ambiguous");
  assert.deepEqual(recovered.failure?.preSignRpc, expected); assert.equal(recovered.failure?.residualAllowanceStatus, "observed");
  assert.equal(recovered.effects.at(-1)?.phase, "unsealed"); assert.equal(recovered.effects.at(-1)?.submissionAttempts, 0);
  assert.equal(s.source.submissions.length, 1); assert.equal(s.wrapping.loads, loads);
  const recoveredStatus = await s.core.execute({ command: "operation.status", operationId: id });
  const recoveredReceipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal((recoveredStatus.operation as any).residual_allowance_status, "observed");
  assert.equal((recoveredStatus.operation as any).pre_sign_rpc_failure.method, "eth_estimateGas");
  assert.deepEqual((recoveredReceipt.receipt as any).pre_sign_rpc_failure, (recoveredStatus.operation as any).pre_sign_rpc_failure);
  assert.throws(() => validateBridgeOperation(resealFailure(recovered, { bridgePhase: "signing_started" })), { code: "APN_STATE_CORRUPT" });
});

test("LI.FI bridge ambiguity with approval only included is retained through later safe observation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  s.source.safeApproval = false;
  const estimate = s.source.estimate.bind(s.source);
  s.source.estimate = async (transaction) => {
    if (transaction.to === operation.effects.at(-1)!.envelope.to && s.source.allowance === s.request.amountAtomic) {
      throw new ApnError("APN_RPC_AMBIGUOUS", `transport failed at ${endpoint}`, { rpcMethod: "eth_estimateGas", leaked: secret });
    }
    return await estimate(transaction);
  };

  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(record.state, "unknown_finality"); assert.equal(record.failure?.reason, "unsent_apn_rpc_ambiguous");
  assert.equal(record.failure?.preSignRpc?.method, "eth_estimateGas");
  assert.equal(record.effects[0]?.phase, "included_success");
  assert.equal(record.effects.at(-1)?.phase, "unsealed"); assert.equal(record.effects.at(-1)?.submissionAttempts, 0);
  assert.equal(s.source.submissions.length, 1);
  const status = await s.core.execute({ command: "operation.status", operationId: id });
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(status.ok, true, status.error?.message); assert.equal(receipt.ok, true, receipt.error?.message);
  assert.equal((status.operation as any).pre_sign_rpc_failure.effect_role, "bridge");
  assert.equal((status.operation as any).pre_sign_rpc_failure.method, "eth_estimateGas");
  assert.deepEqual((receipt.receipt as any).pre_sign_rpc_failure, (status.operation as any).pre_sign_rpc_failure);

  const loads = s.wrapping.loads; s.source.safeApproval = true;
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  const recovered = (await s.core.bridges.records.findOperation(id))!;
  assert.equal(recovered.state, "failed_after_approval"); assert.equal(recovered.failure?.reason, "unsent_apn_rpc_ambiguous");
  assert.equal(recovered.failure?.preSignRpc?.method, "eth_estimateGas");
  assert.equal(recovered.effects.at(-1)?.phase, "unsealed"); assert.equal(recovered.effects.at(-1)?.submissionAttempts, 0);
  assert.equal(s.source.submissions.length, 1); assert.equal(s.wrapping.loads, loads);
  const recoveredStatus = await s.core.execute({ command: "operation.status", operationId: id });
  const recoveredReceipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(recoveredStatus.ok, true, recoveredStatus.error?.message); assert.equal(recoveredReceipt.ok, true, recoveredReceipt.error?.message);
  assert.equal((recoveredStatus.operation as any).pre_sign_rpc_failure.method, "eth_estimateGas");
  assert.deepEqual((recoveredReceipt.receipt as any).pre_sign_rpc_failure, (recoveredStatus.operation as any).pre_sign_rpc_failure);
});

test("LI.FI successful current operation and receipt retain their existing projection", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); s.source.allowance = s.request.amountAtomic;
  const { id } = await s.prepare();
  const completed = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(completed.ok, true, completed.error?.message);
  assert.equal(Object.hasOwn(completed.operation as object, "pre_sign_rpc_failure"), false);
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(receipt.ok, true, receipt.error?.message);
  assert.equal(Object.hasOwn(receipt.receipt as object, "pre_sign_rpc_failure"), false);
  assert.equal(s.source.submissions.length, 1);
});

function resealFailure(record: BridgeOperationRecord, patch: { readonly reason?: string; readonly state?: BridgeOperationRecord["state"];
  readonly terminal?: boolean; readonly bridgePhase?: BridgeOperationRecord["effects"][number]["phase"] }): BridgeOperationRecord {
  const changed = structuredClone(record) as any, transition = changed.transitions.at(-1)!;
  if (patch.reason !== undefined) { changed.failure.reason = patch.reason; transition.failure.reason = patch.reason; }
  if (patch.state !== undefined) { changed.state = patch.state; transition.state = patch.state; }
  if (patch.terminal !== undefined) changed.terminal = patch.terminal;
  if (patch.bridgePhase !== undefined) { changed.effects.at(-1).phase = patch.bridgePhase; transition.effects.at(-1).phase = patch.bridgePhase; }
  const { transitionHash: _transitionHash, ...transitionBody } = transition;
  transition.transitionHash = hashObject(transitionBody);
  const { integrityHash: _integrityHash, ...body } = changed;
  changed.integrityHash = hashObject(body);
  return changed;
}
