import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { sha256 } from "../../src/canonical.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import type { GaslessEffectIdentity, GaslessIntent } from "../../src/gasless/model.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import { GaslessObservationRpc, gaslessObservationRpcFactory } from "../../src/gasless/observation-rpc.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { ObservationTransport, type ObservationFault } from "./gasless-fixtures/observation-transport.js";
import { temporaryState } from "./helpers.js";

type Json = Record<string, any>;
const ENDPOINT = "https://archive.example/v1/canary-private-token";
const ENVIRONMENT = "APN_BASE_ARCHIVE_RPC_URL";
const FORBIDDEN = /bundler|snapshot|fee|estimate|send|UserOperationByHash|UserOperationReceipt/iu;

test("concrete alternate RPC proves bootstrap and final permission invalidation for both delegation states", async t => {
  for (const phase of ["bootstrap", "final"] as const) for (const delegation of ["empty", "expected"] as const) {
    await t.test(`${phase} ${delegation}`, async child => {
      const { operation } = await prepared(child, phase, delegation);
      const transport = await ObservationTransport.create(ENDPOINT, operation.intent);
      if (phase === "final") transport.setFinalIdentity(operation.userOperation.userOperationHash!);
      const rpc = new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport);
      const originalEndpointHash = operation.intent.initialSnapshot.rpcEndpointHash;
      const result = await rpc.observe(operation.intent, identity(operation), operation.cursor);
      assert.equal(result.status, "permissions_invalidated");
      assert.equal(result.transactionHash, null);
      assert.equal(result.settlement, null);
      assert.equal(result.reason, phase === "final" ? "gasless_final_permissions_invalidated" :
        "gasless_bootstrap_permissions_invalidated");
      assert.equal(result.permissionInvalidation?.safeAccount.allowanceAtomic, "0");
      assert.equal(result.permissionInvalidation?.safeAccount.permitNonceAtomic,
        (BigInt(operation.intent.initialSnapshot.permitNonceAtomic) + 1n).toString());
      assert.equal(result.permissionInvalidation?.safeAccount.entryPointNonceAtomic,
        (BigInt(operation.intent.initialSnapshot.entryPointNonceAtomic) + (phase === "final" ? 1n : 0n)).toString());
      assert.equal(result.source?.environmentName, ENVIRONMENT);
      assert.equal(result.source?.rpcOrigin, "https://archive.example");
      assert.equal(result.source?.rpcEndpointHash, sha256(ENDPOINT));
      assert.deepEqual(result.source?.initialBlock, operation.intent.initialSnapshot.block);
      assert.equal(JSON.stringify(result.source).includes("canary-private-token"), false);
      assert.equal(operation.intent.initialSnapshot.rpcEndpointHash, originalEndpointHash);
      assert.ok(transport.calls.length > 0);
      assert.ok(transport.calls.every(call => call.endpoint === ENDPOINT && call.maxBytes === 2 * 1024 * 1024 &&
        call.code === "APN_RPC_CONFIG"));
      assert.deepEqual(transport.calls.map(call => call.id), transport.calls.map((_, index) => String(index + 1)));
      assert.equal(transport.calls.some(call => FORBIDDEN.test(call.method)), false);
      assert.equal(transport.calls.some(call => call.method === "eth_getLogs"), phase === "final");
    });
  }
});

test("alternate RPC rejects wrong binding, chain and preparation anchor before returning evidence", async t => {
  const { operation } = await prepared(t, "bootstrap", "expected");
  const selected = gaslessObservationRpcFactory({ [ENVIRONMENT]: ENDPOINT,
    APN_UNUSED_RPC_URL: "https://unused.example/secret" })(8453, ENVIRONMENT);
  assert.equal(selected.rpcEndpointHash, sha256(ENDPOINT));
  assert.throws(() => gaslessObservationRpcFactory({})(8453, ENVIRONMENT), { code: "APN_RPC_CONFIG" });
  assert.throws(() => gaslessObservationRpcFactory({ [ENVIRONMENT]: ENDPOINT })(8453, "BASE_RPC"),
    { code: "APN_INVALID_INPUT" });

  const noNetwork = await ObservationTransport.create(ENDPOINT, operation.intent);
  for (const unsafe of [`${ENDPOINT}?key=canary`, `${ENDPOINT}#canary`,
    "https://user:password@archive.example/rpc", "http://archive.example/rpc", "https://127.0.0.1/rpc"]) {
    assert.throws(() => new GaslessObservationRpc(8453, unsafe, ENVIRONMENT, noNetwork), { code: "APN_RPC_CONFIG" });
  }
  assert.equal(noNetwork.calls.length, 0);

  for (const fault of ["chain", "initial_hash", "initial_timestamp", "post_initial_reorg"] as const) {
    const transport = await ObservationTransport.create(ENDPOINT, operation.intent);
    transport.setFault(fault);
    const rpc = new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport);
    await assert.rejects(rpc.observe(operation.intent, identity(operation), operation.cursor),
      { code: fault === "chain" ? "APN_CHAIN_MISMATCH" : "APN_RPC_PROTOCOL" }, fault);
  }

  const mutations: Array<[string, (intent: Json) => void]> = [
    ["token", intent => { intent.token = gaslessDeployment(8453).paymaster; }],
    ["domain", intent => { intent.tokenDomain.domainSeparator = `0x${"f".repeat(64)}`; }],
    ["intent", intent => { intent.unsignedEnvelopeHash = "f".repeat(64); }],
  ];
  for (const [name, mutate] of mutations) {
    const transport = await ObservationTransport.create(ENDPOINT, operation.intent);
    const rpc = new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport);
    const changed = structuredClone(operation.intent) as unknown as Json; mutate(changed);
    await assert.rejects(rpc.observe(changed as GaslessIntent, identity(operation), operation.cursor),
      { code: "APN_STATE_CORRUPT" }, name);
    assert.equal(transport.calls.length, 0, name);
  }
});

test("current protocol, permission, finality and log faults retain the final guard", async t => {
  const { operation } = await prepared(t, "final", "empty");
  const protocolAndPermissionFaults: ObservationFault[] = ["protocol_code", "protocol_storage", "protocol_domain",
    "permit", "allowance", "pending", "entrypoint", "eoa", "owner_code", "finality", "current_reorg"];
  for (const fault of protocolAndPermissionFaults) {
    const transport = await ObservationTransport.create(ENDPOINT, operation.intent);
    transport.setFinalIdentity(operation.userOperation.userOperationHash!); transport.setFault(fault);
    const result = await new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport)
      .observe(operation.intent, identity(operation), operation.cursor);
    assert.notEqual(result.status, "permissions_invalidated", fault);
    assert.equal(result.permissionInvalidation, undefined, fault);
    assert.equal(result.settlement, null, fault);
  }
  for (const fault of ["scan_error", "log_malformed", "log_truncated", "log_wrong_identity"] as const) {
    const transport = await ObservationTransport.create(ENDPOINT, operation.intent);
    transport.setFinalIdentity(operation.userOperation.userOperationHash!); transport.setFault(fault);
    const result = await new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport)
      .observe(operation.intent, identity(operation), operation.cursor);
    assert.equal(result.status, "unresolved", fault);
    assert.deepEqual(result.cursor, operation.cursor, fault);
    assert.equal(result.permissionInvalidation, undefined, fault);
  }
});

test("bounded scan advances 256 blocks in ten-block requests and closes only after invalidation is covered", async t => {
  const { operation } = await prepared(t, "final", "expected");
  const start = BigInt(operation.intent.initialSnapshot.block.numberAtomic), safe = start + 300n;
  const transport = await ObservationTransport.create(ENDPOINT, operation.intent);
  transport.setFinalIdentity(operation.userOperation.userOperationHash!); transport.setScan(safe, safe);
  const rpc = new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport);
  const first = await rpc.observe(operation.intent, identity(operation), operation.cursor);
  assert.equal(first.status, "not_found");
  assert.equal(first.permissionInvalidation, undefined);
  assert.equal(first.cursor.nextBlockAtomic, (start + 256n).toString());
  const firstRanges = ranges(transport);
  assert.equal(firstRanges.length, 26);
  assert.deepEqual(firstRanges[0], [start, start + 9n]);
  assert.deepEqual(firstRanges.at(-1), [start + 250n, start + 255n]);

  const reorgTransport = await ObservationTransport.create(ENDPOINT, operation.intent);
  reorgTransport.setFinalIdentity(operation.userOperation.userOperationHash!);
  reorgTransport.setScan(safe, safe); reorgTransport.setFault("cursor_reorg");
  const reset = await new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, reorgTransport)
    .observe(operation.intent, identity(operation), first.cursor);
  assert.equal(reset.status, "unresolved");
  assert.deepEqual(reset.cursor, operation.cursor);
  assert.equal(ranges(reorgTransport).length, 0);

  const second = await rpc.observe(operation.intent, identity(operation), first.cursor);
  assert.equal(second.status, "permissions_invalidated");
  assert.equal(second.permissionInvalidation?.safeBlock.numberAtomic, safe.toString());
  const allRanges = ranges(transport);
  assert.equal(allRanges.length, 31);
  assert.deepEqual(allRanges.at(-1), [start + 296n, safe]);
  assert.ok(allRanges.every(([from, to]) => to - from + 1n <= 10n));
});

test("canonical EntryPoint scan settles a submitted operation without a locator and rejects receipt conflicts", async t => {
  const { operation } = await prepared(t, "final", "empty");
  const userOperationHash = operation.userOperation.userOperationHash!;
  const transport = await ObservationTransport.create(ENDPOINT, operation.intent);
  await transport.installSettlement(userOperationHash);
  const rpc = new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport);
  const settled = await rpc.observe(operation.intent, identity(operation), operation.cursor);
  assert.equal(settled.status, "safe");
  assert.equal(settled.settlement?.userOperationHash, userOperationHash);
  assert.equal(settled.settlement?.accounting.success, true);
  assert.equal(settled.settlement?.accounting.deliveredAtomic, operation.intent.recipientAtomic);
  assert.equal(settled.source?.rpcEndpointHash, sha256(ENDPOINT));
  assert.equal(transport.calls.some(call => /getUserOperation|bundler/iu.test(call.method)), false);
  assert.ok(transport.calls.some(call => call.method === "eth_getLogs"));
  assert.ok(transport.calls.some(call => call.method === "eth_getTransactionByHash"));

  for (const fault of ["receipt_missing", "receipt_conflict", "receipt_malformed"] as const) {
    const faulty = await ObservationTransport.create(ENDPOINT, operation.intent);
    await faulty.installSettlement(userOperationHash); faulty.setFault(fault);
    const held = await new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, faulty)
      .observe(operation.intent, identity(operation), operation.cursor);
    assert.equal(held.status, "unresolved", fault);
    assert.equal(held.settlement, null, fault);
    assert.deepEqual(held.cursor, operation.cursor, fault);
  }
});

test("JSON-RPC envelope, response bounds, HTTP errors and transport failures redact provider canaries", async t => {
  const { operation } = await prepared(t, "bootstrap", "expected");
  const canary = "canary_provider_body_secret";
  const cases: Array<[string, (id: string) => Promise<{ status: number; body: string }>, string]> = [
    ["mismatched id", async () => ({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: "wrong", result: "0x2105" }) }), "APN_RPC_PROTOCOL"],
    ["result and error", async id => ({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result: "0x2105",
      error: { message: canary } }) }), "APN_RPC_PROTOCOL"],
    ["missing result", async id => ({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id }) }), "APN_RPC_PROTOCOL"],
    ["invalid JSON", async () => ({ status: 200, body: `{${canary}` }), "APN_RPC_PROTOCOL"],
    ["HTTP status", async () => ({ status: 503, body: canary }), "APN_RPC_PROTOCOL"],
    ["oversize", async () => ({ status: 200, body: canary.repeat(150_000) }), "APN_RPC_PROTOCOL"],
    ["provider error", async id => ({ status: 200, body: JSON.stringify({ jsonrpc: "2.0", id,
      error: { code: -32000, message: canary } }) }), "APN_RPC_PROTOCOL"],
    ["transport", async () => { throw new Error(canary); }, "APN_RPC_AMBIGUOUS"],
  ];
  for (const [name, response, code] of cases) {
    const transport: GaslessTransport = { request: async (_endpoint, _method, body) => {
      const id = body === null ? "missing" : String((JSON.parse(body) as Json).id);
      return await response(id);
    } };
    const rpc = new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport);
    await assert.rejects(rpc.observe(operation.intent, identity(operation), operation.cursor), (error: any) => {
      assert.equal(error.code, code, name);
      assert.equal(String(error.message).includes(canary), false, name);
      assert.equal(String(error).includes("canary-private-token"), false, name);
      return true;
    });
  }

  let requests = 0;
  const transport: GaslessTransport = { request: async () => { requests += 1; throw new Error("network forbidden"); } };
  const rpc = new GaslessObservationRpc(8453, ENDPOINT, ENVIRONMENT, transport);
  await assert.rejects((rpc as unknown as { call(method: string, params: readonly unknown[]): Promise<unknown> })
    .call("eth_sendUserOperation", []), { code: "APN_RPC_PROTOCOL" });
  await assert.rejects((rpc as unknown as { call(method: string, params: readonly unknown[]): Promise<unknown> })
    .call("eth_estimateUserOperationGas", []), { code: "APN_RPC_PROTOCOL" });
  assert.equal(requests, 0);
});

async function prepared(t: TestContext, phase: "bootstrap" | "final", delegation: "empty" | "expected") {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const fixture = await gaslessFixture(temporary.root, 8453, { delegation });
  const { id } = await fixture.prepare(`observation-rpc-${phase}-${delegation}`);
  if (phase === "bootstrap") fixture.rpc.estimateFails = true;
  else { fixture.rpc.timeout = true; fixture.rpc.result = "missing"; }
  const approved = await fixture.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(approved.ok, true, approved.error?.message);
  const operation = await fixture.record(id);
  assert.notEqual(operation.bootstrap.materialHash, null);
  assert.equal(operation.userOperation.materialHash !== null, phase === "final");
  assert.equal(operation.userOperation.userOperationHash !== null, phase === "final");
  return { fixture, operation };
}

function identity(operation: GaslessOperationRecord): GaslessEffectIdentity {
  return { bootstrapMaterialHash: operation.bootstrap.materialHash,
    userOperationMaterialHash: operation.userOperation.materialHash,
    userOperationHash: operation.userOperation.userOperationHash };
}

function ranges(transport: ObservationTransport): Array<[bigint, bigint]> {
  return transport.calls.filter(call => call.method === "eth_getLogs").map(call => {
    const filter = call.params[0] as Json;
    return [BigInt(filter.fromBlock), BigInt(filter.toBlock)];
  });
}
