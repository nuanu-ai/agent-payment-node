import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ApnCore } from "../../src/core.js";
import { GaslessHttps, type GaslessTransport } from "../../src/gasless/https.js";
import { ApnError } from "../../src/errors.js";
import { GaslessObservationRpc } from "../../src/gasless/observation-rpc.js";
import type { GaslessDependencies } from "../../src/gasless/service.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const ENV = "APN_BASE_OBSERVE_RPC_URL", ENDPOINT = "https://archive.example/base-observation";
const instant = { minimumIntervalMs: 0, monotonicNow: () => 0, sleep: async () => undefined };

async function submitted(t: TestContext, key: string) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const fixture = await gaslessFixture(temporary.root);
  const { id } = await fixture.prepare(key);
  fixture.rpc.result = "pending";
  assert.equal((await fixture.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await fixture.record(id)).state, "submitted_pending");
  return { fixture, id };
}

function resumeCore(fixture: Awaited<ReturnType<typeof gaslessFixture>>, transport: GaslessTransport) {
  const dependencies: GaslessDependencies = {
    rpcFor: () => { throw new Error("unexpected execution RPC"); },
    observationRpcFor: (chainId, name) => new GaslessObservationRpc(chainId, ENDPOINT, name, transport, instant),
    custody: { load: async () => { throw new Error("unexpected load"); }, seal: async () => { throw new Error("unexpected seal"); } },
  };
  return new ApnCore({ state: fixture.state, gasless: dependencies, clock: { now: () => new Date(fixture.now) } });
}

test("explicit observation RPC that refuses with an HTTP status names that status in the resume output", async (t) => {
  // 408, 429 and 5xx make the RPC unavailable; any other status is a protocol refusal. Both name the status now.
  for (const [status, cause, reason] of [[403, "http_403", "gasless_receipt_unresolved"], [429, "http_429", "gasless_observation_rpc_unavailable"],
    [503, "http_503", "gasless_observation_rpc_unavailable"]] as const) {
    const { fixture, id } = await submitted(t, `observation-diagnostic-http-${status}`);
    const core = resumeCore(fixture, { request: async () => ({ status, body: "canary_provider_body" }) });
    const result = await core.execute({ command: "operation.resume", operationId: id, observationRpcEnv: ENV });
    assert.equal(result.ok, true, JSON.stringify(result));
    const operation = result.operation as { state: string; reason: string; observation_rpc_diagnostic?: unknown };
    assert.equal(operation.state, "unknown_finality");
    assert.equal(operation.reason, reason);
    assert.deepEqual(operation.observation_rpc_diagnostic, { rpc_origin: "https://archive.example", cause, rpc_error_code: null });
    assert.equal(JSON.stringify(result).includes("canary_provider_body"), false);
    assert.equal((await fixture.record(id) as unknown as Record<string, unknown>).observation_rpc_diagnostic, undefined);
  }
});

test("a JSON-RPC error keeps only its numeric code and never the provider's message", async (t) => {
  const { fixture, id } = await submitted(t, "observation-diagnostic-rpc-error");
  const core = resumeCore(fixture, { request: async (_endpoint, _method, body) => {
    const parsed = JSON.parse(body!) as { id: string } | Array<{ id: string }>;
    const error = (row: { id: string }) => ({ jsonrpc: "2.0", id: row.id, error: { code: -32602, message: "canary_archive_token_url" } });
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? parsed.map(error) : error(parsed)) };
  } });
  const result = await core.execute({ command: "operation.resume", operationId: id, observationRpcEnv: ENV });
  const operation = result.operation as { state: string; observation_rpc_diagnostic?: { rpc_error_code: unknown } };
  assert.equal(operation.state, "unknown_finality");
  assert.equal(operation.observation_rpc_diagnostic?.rpc_error_code, -32602);
  assert.equal(JSON.stringify(result).includes("canary_archive_token_url"), false);
});

test("a transport failure without an HTTP status is named as such", async (t) => {
  const { fixture, id } = await submitted(t, "observation-diagnostic-transport");
  const core = resumeCore(fixture, { request: async () => { throw new Error("canary_socket_reset"); } });
  const result = await core.execute({ command: "operation.resume", operationId: id, observationRpcEnv: ENV });
  const operation = result.operation as { reason: string; observation_rpc_diagnostic?: { cause: unknown } };
  assert.equal(operation.reason, "gasless_observation_rpc_unavailable");
  assert.equal(operation.observation_rpc_diagnostic?.cause, "transport_failure");
  assert.equal(JSON.stringify(result).includes("canary_socket_reset"), false);
});

test("APN's own transport failures carry their reason, and the observation names it", async (t) => {
  await assert.rejects(new GaslessHttps().request("https://archive.example/rpc", "POST", "x".repeat(256 * 1024 + 1), 1024, "APN_RPC_CONFIG"),
    (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS" && error.details?.reason === "transport_request_size");
  const { fixture, id } = await submitted(t, "observation-diagnostic-transport-reason");
  const core = resumeCore(fixture, { request: async () => {
    throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless transport failed: request_deadline.", { reason: "transport_request_deadline" });
  } });
  const result = await core.execute({ command: "operation.resume", operationId: id, observationRpcEnv: ENV });
  const operation = result.operation as { reason: string; observation_rpc_diagnostic?: { cause: unknown } };
  assert.equal(operation.reason, "gasless_observation_rpc_unavailable");
  assert.equal(operation.observation_rpc_diagnostic?.cause, "transport_request_deadline");
});
