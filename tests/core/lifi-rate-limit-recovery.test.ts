import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { publicBridgeOperation } from "../../src/lifi/receipt.js";
import { RpcReadSession, bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { temporaryState } from "./helpers.js";
import { approvalSafe, effects, invocation } from "./lifi-send-step-helpers.js";

/** Rate-limits the first archive POST of the guard (a deployment chunk) once. */
const firstArchive = (shape: "http_429" | "json_rpc") => {
  let fired = false;
  return (post: { readonly role: string }) => !fired && post.role === "archive" ? (fired = true, shape) : null;
};

for (const shape of ["http_429", "json_rpc"] as const) test(`a ${shape} rate limit in the bridge guard after a SAFE approval is recoverable and a later resume sends`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root);
  const limited = invocation(s, op, "scalar", 0, { limit: firstArchive(shape) }), deferred = await limited.execution.resume(op);
  assert.deepEqual(effects(deferred), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  assert.equal(deferred.terminal, false); assert.equal(deferred.failure?.reason, "pre_sign_rpc_rate_limited");
  assert.deepEqual(limited.seals, []); assert.equal(limited.chain.sent.length, 0);
  const view = publicBridgeOperation(deferred);
  assert.equal(view.reason, "pre_sign_rpc_rate_limited");
  assert.deepEqual(view.next_actions, [`apn operation resume --operation ${op.operationId}`, `apn operation status --operation ${op.operationId}`]);
  assert.deepEqual((await s.core.bridges.records.findOperation(op.operationId))!.failure, deferred.failure);
  // The next resume repeats the full guard, clears the deferral when it signs and sends the one bridge. A rate limit in the
  // bridge's own source observation then stays recoverable as well.
  const later = invocation(s, deferred, "scalar", 0, { at: Date.parse(deferred.updatedAt) + 1_000, limit: (post) => post.index >= 24 ? shape : null });
  const sent = await later.execution.resume(deferred);
  assert.deepEqual(later.seals, [21]); assert.equal(later.sendPost(), 24); assert.equal(later.chain.sent.length, 1);
  assert.equal(sent.effects[1]!.submissionAttempts, 1);
  assert.equal(sent.transitions.find((entry) => entry.effects[1]!.phase === "signing_started")!.failure, null);
  assert.equal(sent.state, "unknown_finality"); assert.equal(sent.terminal, false);
  assert.equal(sent.failure?.reason, "source_observation_unavailable"); assert.equal(sent.failure?.observationRpc?.code, "APN_RPC_RATE_LIMITED");
});

for (const shape of ["timeout", "http_503"] as const) test(`a ${shape} in the bridge guard after a SAFE approval is recoverable with its boundary and a later resume sends`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root);
  // Both attempts of the first archive deployment chunk fail; the session retries a transport timeout or 503 once.
  let failures = 0;
  const limited = invocation(s, op, "primary", 0, { limit: (post) => post.host === "archive-8453.example" && failures < 2 ? (failures += 1, shape) : null });
  const deferred = await limited.execution.resume(op);
  assert.equal(failures, 2); assert.equal(deferred.terminal, false); assert.equal(deferred.failure?.reason, "pre_sign_rpc_unavailable");
  assert.deepEqual(effects(deferred), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  assert.equal(deferred.failure?.preSignRpc?.effectRole, "bridge"); assert.equal(deferred.failure?.preSignRpc?.category, "deployment_refresh");
  assert.deepEqual(limited.seals, []); assert.equal(limited.chain.sent.length, 0);
  assert.deepEqual(publicBridgeOperation(deferred).next_actions, [`apn operation resume --operation ${op.operationId}`, `apn operation status --operation ${op.operationId}`]);
  const later = invocation(s, deferred, "primary", 0, { at: Date.parse(deferred.updatedAt) + 1_000 }), sent = await later.execution.resume(deferred);
  assert.equal(later.sendPost(), 24); assert.equal(later.chain.sent.length, 1); assert.equal(sent.effects[1]!.submissionAttempts, 1);
  assert.equal(sent.transitions.find((entry) => entry.effects[1]!.phase === "signing_started")!.failure, null);
});

test("a rate limit on the raw bridge send keeps the no-resend first-attempt rule", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root);
  const run = invocation(s, op, "primary", 0, { limit: (post) => post.methods.includes("eth_sendRawTransaction") ? "http_429" : null });
  const attempted = await run.execution.resume(op);
  assert.deepEqual(effects(attempted)[1], ["bridge", "unknown_finality", 1]); assert.equal(attempted.terminal, false);
  const later = invocation(s, attempted, "primary", 0, { at: Date.parse(attempted.updatedAt) + 1_000 }), observed = await later.execution.resume(attempted);
  assert.equal(observed.effects[1]!.submissionAttempts, 1); assert.equal(later.chain.sent.length, 0);
  assert(later.chain.posts.every((post) => !post.methods.includes("eth_sendRawTransaction")));
});

test("a rate-limited bridge guard followed by quote expiry ends on the normal expired path", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root);
  const deferred = await invocation(s, op, "primary", 0, { limit: firstArchive("http_429") }).execution.resume(op);
  assert.equal(deferred.failure?.reason, "pre_sign_rpc_rate_limited"); assert.equal(deferred.terminal, false);
  const late = invocation(s, deferred, "primary", 0, { at: Date.parse(op.intent.expiresAt) + 60_000 }), ended = await late.execution.resume(deferred);
  assert.equal(ended.state, "failed_after_approval"); assert.equal(ended.terminal, true);
  assert.deepEqual(effects(ended), [["approval", "safe_success", 1], ["bridge", "unsealed", 0]]);
  assert.equal(ended.failure?.reason, "unsent_apn_reprepare_required");
  assert.equal(ended.failure?.residualAllowance?.amountAtomic, op.intent.materialization.request.amountAtomic);
  assert.deepEqual(late.seals, []); assert.equal(late.chain.sent.length, 0); assert.equal(late.chain.posts.length, 2);
});

test("a deterministic guard refusal after a SAFE approval stays terminal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { s, op } = await approvalSafe(temporary.root);
  const run = invocation(s, op, "primary", 0, { allowance: 0n }), ended = await run.execution.resume(op);
  assert.equal(ended.state, "failed_after_approval"); assert.equal(ended.terminal, true);
  assert.equal(ended.failure?.reason, "unsent_apn_permission_allowance_insufficient");
  assert.deepEqual(run.seals, []); assert.equal(run.chain.sent.length, 0);
});

test("official Base JSON-RPC rate limits are typed as rate limits; other JSON-RPC errors stay protocol failures", async () => {
  const cases = [
    { name: "batch -32007", batch: true, status: 200, error: { code: -32007, message: "5/second request limit reached" }, code: "APN_RPC_RATE_LIMITED" },
    { name: "scalar -32011", batch: false, status: 200, error: { code: -32011, message: "request limit reached" }, code: "APN_RPC_RATE_LIMITED" },
    { name: "HTTP 429", batch: false, status: 429, error: { code: -32011, message: "request limit reached" }, code: "APN_RPC_RATE_LIMITED" },
    { name: "batch -32000", batch: true, status: 200, error: { code: -32000, message: "header not found" }, code: "APN_RPC_PROTOCOL" },
    { name: "scalar -32000", batch: false, status: 200, error: { code: -32000, message: "header not found" }, code: "APN_RPC_PROTOCOL" },
  ] as const;
  for (const row of cases) {
    let now = 0;
    const transport = { request: async (_url: string, _verb: string, body: string | null) => {
      const parsed = JSON.parse(body!) as { id: string } | Array<{ id: string }>, items = Array.isArray(parsed) ? parsed : [parsed];
      const values = items.map((item) => ({ jsonrpc: "2.0", id: item.id, error: row.error }));
      return { status: row.status, headers: {}, body: JSON.stringify(Array.isArray(parsed) ? values : values[0]) };
    } };
    const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://mainnet.base.org" }, { transport })(8453,
      new RpcReadSession({ now: () => now, wait: async (ms) => { now += ms; } }));
    await assert.rejects(row.batch ? rpc.block("safe") : rpc.assertChain(), (error: unknown) => {
      assert(error instanceof ApnError); assert.equal(error.code, row.code, row.name); return true;
    });
  }
});
