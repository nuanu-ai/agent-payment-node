import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import type { BridgePreSignRpcFailure } from "../../src/lifi/operation-model.js";
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
