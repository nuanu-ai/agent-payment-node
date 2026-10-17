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
import { findStored } from "./stored-operations.js";

const secret = "provider-secret-token";
const endpoint = `https://user:${secret}@rpc.example/private?key=${secret}`;

test("LI.FI RPC transport ambiguity keeps only the JSON-RPC method", async () => {
  const transport = { request: async () => { throw new ApnError("APN_RPC_AMBIGUOUS", `failed at ${endpoint}`, { leaked: secret }); } };
  const rpc = bridgeRpcCall(1, { APN_ETHEREUM_RPC_URL: "https://rpc.example" }, { transport });
  await assert.rejects(rpc.call("eth_getCode", ["0x0000000000000000000000000000000000000000", "latest"]), (error: unknown) => {
    assert.ok(error instanceof ApnError); assert.equal(error.code, "APN_RPC_AMBIGUOUS");
    assert.deepEqual(error.details, { rpcMethod: "eth_getCode", endpointRole: "primary" });
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
  fail: (fixture: Awaited<ReturnType<typeof lifiFixture>>, error: ApnError) => () => void;
  pair?: "eth-bnb";
}>[] = [
  // The source deployment check travels in the account batch, so its transport failure is that batch's boundary.
  { name: "source deployment check transport", stage: "source_account_refresh", chainRole: "source", category: "account_nonce",
    method: "eth_call", fail: (s, error) => { const o = s.source.checkedAccount; s.source.checkedAccount = async () => { throw error; }; return () => { s.source.checkedAccount = o; }; } },
  // Only a destination whose delivery depends on third-party routing (the BNB composite) reads anything before the send.
  { name: "destination deployment check transport", stage: "destination_deployment_refresh", chainRole: "destination", category: "deployment_refresh",
    method: "eth_call", pair: "eth-bnb", fail: (s, error) => { const o = s.destination.deploymentCheck; s.destination.deploymentCheck = async () => { throw error; }; return () => { s.destination.deploymentCheck = o; }; } },
  { name: "source account and nonce transport", stage: "source_account_refresh", chainRole: "source", category: "account_nonce",
    method: "eth_getTransactionCount", fail: (s, error) => { const o = s.source.account; s.source.account = async () => { throw error; }; return () => { s.source.account = o; }; } },
  { name: "source simulation transport", stage: "source_execution_simulation", chainRole: "source", category: "simulation",
    method: "eth_estimateGas", fail: (s, error) => { const o = s.source.estimate; s.source.estimate = async () => { throw error; }; return () => { s.source.estimate = o; }; } },
  { name: "source fee quote transport", stage: "source_fee_quote", chainRole: "source", category: "fee_quote",
    method: "eth_call", fail: (s, error) => { const o = s.source.feeQuote; s.source.feeQuote = async () => { throw error; }; return () => { s.source.feeQuote = o; }; } },
];
const pendingEffects = (record: BridgeOperationRecord) => record.effects.map(({ role, phase, submissionAttempts }) => ({ role, phase, submissionAttempts }));

for (const row of cases) test(`LI.FI ${row.name} defers the approval with only its exact redacted pre-sign boundary`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root, row.pair); const { id, operation } = await s.prepare();
  const loads = s.wrapping.loads;
  const restore = row.fail(s, new ApnError("APN_RPC_AMBIGUOUS", `transport failed at ${endpoint}`, { rpcMethod: row.method, leaked: secret }));

  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!;
  const expected: BridgePreSignRpcFailure = {
    schemaVersion: "apn.bridge-presign-rpc-failure.v1", phase: "pre_sign_guard", effectRole: row.pair === "eth-bnb" ? "bridge" : "approval",
    stage: row.stage, chainRole: row.chainRole, chainId: row.chainRole === "source"
      ? operation.intent.materialization.request.fromChainId : operation.intent.materialization.request.toChainId,
    category: row.category, method: row.method,
  };
  // Nothing is signed before the guard passes, so an unavailable endpoint leaves the approval pending, not failed.
  assert.equal(record.state, "awaiting_approval"); assert.equal(record.terminal, false);
  assert.equal(record.failure?.reason, "pre_sign_rpc_unavailable");
  assert.deepEqual(record.failure?.preSignRpc, expected);
  assert.ok(record.effects.every((effect) => effect.phase === "unsealed" && effect.submissionAttempts === 0));
  assert.equal(s.source.submissions.length, 0); assert.equal(s.wrapping.loads, loads); assert.equal(s.approval.calls.length, 0);

  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal(status.ok, true, status.error?.message);
  assert.deepEqual((status.operation as any).next_actions, [`apn bridge approve --operation ${id}`]);
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

  restore();
  const approved = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(approved.ok, true, approved.error?.message);
  // The native BNB composite has one effect and waits for its provider-bound delivery; the token route also sends its approval.
  assert.equal((approved.operation as { state: string }).state, row.pair === "eth-bnb" ? "destination_pending" : "completed");
  assert.equal(s.source.submissions.length, row.pair === "eth-bnb" ? 1 : 2);
});

/** Fails the bridge simulation once the approval allowance exists, as a transport failure. Returns the restore. */
function failBridgeSimulation(s: Awaited<ReturnType<typeof lifiFixture>>, operation: BridgeOperationRecord): () => void {
  const estimate = s.source.estimate.bind(s.source), original = s.source.estimate;
  s.source.estimate = async (transaction) => {
    if (transaction.to === operation.effects.at(-1)!.envelope.to && s.source.allowance === s.request.amountAtomic) {
      throw new ApnError("APN_RPC_AMBIGUOUS", `transport failed at ${endpoint}`, { rpcMethod: "eth_estimateGas", leaked: secret });
    }
    return await estimate(transaction);
  };
  return () => { s.source.estimate = original; };
}

test("LI.FI bridge simulation transport failure after safe approval defers with its redacted boundary, then a resume sends", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  const restore = failBridgeSimulation(s, operation);

  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!;
  const expected: BridgePreSignRpcFailure = { schemaVersion: "apn.bridge-presign-rpc-failure.v1", phase: "pre_sign_guard",
    effectRole: "bridge", stage: "source_execution_simulation", chainRole: "source",
    chainId: operation.intent.materialization.request.fromChainId, category: "simulation", method: "eth_estimateGas" };
  assert.equal(record.state, "source_pending"); assert.equal(record.terminal, false);
  assert.equal(record.failure?.reason, "pre_sign_rpc_unavailable"); assert.deepEqual(record.failure?.preSignRpc, expected);
  assert.deepEqual(pendingEffects(record), [
    { role: "approval", phase: "safe_success", submissionAttempts: 1 },
    { role: "bridge", phase: "unsealed", submissionAttempts: 0 },
  ]);
  assert.equal(s.source.submissions.length, 1);

  const status = await s.core.execute({ command: "operation.status", operationId: id });
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(status.ok, true, status.error?.message); assert.equal(receipt.ok, true, receipt.error?.message);
  assert.equal((status.operation as any).reason, "pre_sign_rpc_unavailable");
  assert.deepEqual((status.operation as any).next_actions, [`apn operation resume --operation ${id}`, `apn operation status --operation ${id}`]);
  assert.equal((status.operation as any).pre_sign_rpc_failure.stage, "source_execution_simulation");
  assert.deepEqual((receipt.receipt as any).pre_sign_rpc_failure, (status.operation as any).pre_sign_rpc_failure);
  const serialized = JSON.stringify({ record, status, receipt });
  assert.equal(serialized.includes(endpoint), false); assert.equal(serialized.includes(secret), false); assert.equal(serialized.includes("leaked"), false);

  const loads = s.wrapping.loads;
  const still = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(still.ok, true, still.error?.message); assert.equal(s.source.submissions.length, 1); assert.equal(s.wrapping.loads, loads);
  assert.equal((still.operation as any).reason, "pre_sign_rpc_unavailable");
  restore();
  const sent = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(sent.ok, true, sent.error?.message); assert.equal((sent.operation as { state: string }).state, "completed");
  assert.equal(s.source.submissions.length, 2);

  for (const patch of [{ reason: "unsent_apn_operation_blocked" }, { bridgePhase: "signing_started" as const },
    { state: "failed_after_approval" as const, terminal: true }]) {
    assert.throws(() => validateBridgeOperation(resealFailure(record, patch)), { code: "APN_STATE_CORRUPT" });
  }
});

test("LI.FI deferred bridge guard after safe approval ends on the expired path, even when the residual read fails", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  failBridgeSimulation(s, operation);
  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal((await findStored(s.core.bridges.records, id))!.failure?.reason, "pre_sign_rpc_unavailable");

  const loads = s.wrapping.loads; s.now.setTime(Date.parse(operation.intent.expiresAt) + 60_000); s.source.failAccount = true;
  const unresolved = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(unresolved.ok, true, unresolved.error?.message);
  // The residual allowance is reported, never required: the expired unsent bridge ends on the first resume.
  const recovered = (await findStored(s.core.bridges.records, id))!;
  assert.equal(recovered.state, "failed_after_approval"); assert.equal(recovered.failure?.reason, "unsent_apn_reprepare_required");
  assert.equal(recovered.failure?.residualAllowance, null); assert.equal(recovered.failure?.residualAllowanceStatus, "unavailable");
  assert.deepEqual(pendingEffects(recovered), [
    { role: "approval", phase: "safe_success", submissionAttempts: 1 },
    { role: "bridge", phase: "unsealed", submissionAttempts: 0 },
  ]);
  assert.equal(s.source.submissions.length, 1); assert.equal(s.wrapping.loads, loads);
});

test("LI.FI bridge guard transport failure with the approval only included stays recoverable through later safe observation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root); const { id, operation } = await s.prepare();
  s.source.safeApproval = false; const restore = failBridgeSimulation(s, operation);

  const result = await s.core.execute({ command: "bridge.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  const record = (await findStored(s.core.bridges.records, id))!;
  assert.equal(record.terminal, false); assert.equal(record.failure?.reason, "pre_sign_rpc_unavailable");
  assert.equal(record.failure?.preSignRpc?.method, "eth_estimateGas");
  assert.equal(record.effects[0]?.phase, "included_success");
  assert.equal(record.effects.at(-1)?.phase, "unsealed"); assert.equal(record.effects.at(-1)?.submissionAttempts, 0);
  assert.equal(s.source.submissions.length, 1);

  s.source.safeApproval = true;
  const observed = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(observed.ok, true, observed.error?.message);
  const safe = (await findStored(s.core.bridges.records, id))!;
  assert.equal(safe.effects[0]?.phase, "safe_success"); assert.equal(safe.terminal, false);
  assert.equal(safe.failure?.reason, "pre_sign_rpc_unavailable"); assert.equal(s.source.submissions.length, 1);

  restore();
  const sent = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(sent.ok, true, sent.error?.message); assert.equal((sent.operation as { state: string }).state, "completed");
  assert.equal(s.source.submissions.length, 2);
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
