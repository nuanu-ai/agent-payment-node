/**
 * QA 0.5.67. SOLANA-X402-PREPARED-ERROR-CONTEXT-065-001 (post-commit addendum): a derived operation-index write that fails
 * after `x402 solana pay` saved its prepared record answered APN_INTERNAL with no id; the key fixes the id, so the saved
 * payment is named. X402-EXPIRED-UNSENT-WAIT-CONTEXT-067-001: `operation resume --wait-seconds` on an expired, never-sent
 * EIP-3009 authorization (FINALIZED not yet past its expiry) answered a bare APN_OPERATION_BLOCKED; it now answers as a
 * plain resume does, with the operation and a `not_exposed` wait outcome. Expiry, nonce and hold rules are unchanged.
 */
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import assert from "node:assert/strict";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import * as indexRuntime from "../../src/operation-index/index.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { BASE_USDC } from "../../src/constants.js";
import { StateStore } from "../../src/state.js";
import { X402SolanaRepository } from "../../src/x402-solana/repository.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { admitAsset, assetFixture } from "./x402-any-asset-helpers.js";
import { PAY_ARGS, readySolanaFixture } from "./x402-solana-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const { OperationIndex } = await testRuntime(indexRuntime, "operation-index/index.js");
const solanaId = (root: string, key: string) =>
  domainHash("apn.x402-solana.operation-id.v1", canonicalJson({ profileHash: new X402SolanaRepository(root).profileHash("default"), key }));

async function mcpCall(context: test.TestContext, options: unknown, name: string, args: Record<string, unknown>): Promise<OutputEnvelope> {
  const server = createMcpServer(options as never), [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b);
  const client = new Client({ name: "qa0567-recovery-context", version: "1" }); await client.connect(a);
  context.after(async () => { await client.close(); await server.close(); });
  return (await client.callTool({ name, arguments: args })).structuredContent as unknown as OutputEnvelope;
}

for (const via of ["cli", "mcp"] as const) test(`a derived-index failure after the Solana prepare commit still names the saved payment (${via})`, async (context) => {
  const f = await readySolanaFixture(context, runCli), key = `qa0567-index-${via}`, id = solanaId(f.root, key);
  const prototype = OperationIndex.prototype as unknown as { follow: (operationId: string) => Promise<void> }, follow = prototype.follow;
  let failures = 0;
  prototype.follow = async function (this: unknown, operationId: string) {
    if (operationId === id && failures++ === 0) throw Object.assign(new Error("ENOSPC: no space left on device, rename"), { code: "ENOSPC" });
    return await follow.call(this, operationId);
  };
  context.after(() => { prototype.follow = follow; });
  const failed = via === "cli" ? await runCli([...PAY_ARGS, "--idempotency-key", key], {}, f.options)
    : await mcpCall(context, f.options, "apn_x402_solana_pay", { profile: "default", url: X402_URL, asset: PAY_ARGS[PAY_ARGS.indexOf("--asset") + 1],
      max_amount: "20000", idempotency_key: key });
  assert.equal(failed.ok, false, JSON.stringify(failed)); assert.equal(failures, 1);
  const details = failed.error?.details as Record<string, unknown>;
  assert.deepEqual([details.operation_id, details.state, details.signed, details.exposed], [id, "prepared", false, false], JSON.stringify(failed));
  assert.equal((failed.operation as { operation_id: string }).operation_id, id);
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 0);
  // Once the store recovers, the same key continues the same payment and pays once.
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", key], {}, f.options);
  assert.equal((paid.data as { operation_id: string }).operation_id, id, JSON.stringify(paid));
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
});

test("a Solana pay that fails before any record is saved names no operation", async (context) => {
  const f = await readySolanaFixture(context, runCli);
  const refused = await runCli(["x402", "solana", "pay", "--profile", "nobody", ...PAY_ARGS.slice(5), "--idempotency-key", "qa0567-none"], {}, f.options);
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.equal(refused.operation, null); assert.equal(refused.error?.details?.operation_id, undefined);
});

for (const via of ["cli", "mcp"] as const) test(`a wait on an expired, never-sent x402 authorization answers with the operation until FINALIZED proves it unused (${via})`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const spec = { label: "Base USDC", chainId: 8453, token: BASE_USDC, name: "USD Coin", version: "2", decimals: 6 };
  const f = assetFixture(temporary.root, spec); await admitAsset(f, spec);
  let wall = 0; const wait = { nowMs: () => wall, wait: async (ms: number) => { wall += ms; return "elapsed" as const; } };
  const options = { stateRoot: temporary.root, rpc: f.rpc, clock: f.clock, policy: f.policy, native: f.native, http: f.http, wrappingSecret: f.wrapping, wait };
  const prepared = await runCli(["x402", "fetch", "prepare", "--profile", "default", "--url", X402_URL, "--idempotency-key", `qa0567-wait-${via}`,
    "--rpc-url", f.rpc.rpcOrigin], {}, options as never);
  const id = (prepared.operation as { operationId: string }).operationId;
  const approved = await runCli(["x402", "fetch", "approve", "--operation", id, "--rpc-url", f.rpc.rpcOrigin], {}, options as never);
  assert.equal((approved.operation as { state: string }).state, "authorized_not_sent", JSON.stringify(approved));
  const before = (await new StateStore(temporary.root).findX402Operation(id))!;
  f.clock.value = new Date(Number(before.authorization.validBefore) * 1000 + 1000);
  f.rpc.safeHead = { ...f.rpc.safeHead, timestamp: String(Math.floor(f.clock.value.getTime() / 1000)), observedAt: f.clock.value.toISOString() };
  const waited = via === "cli"
    ? await runCli(["operation", "resume", "--operation", id, "--rpc-url", f.rpc.rpcOrigin, "--wait-seconds", "1"], {}, options as never)
    : await mcpCall(t, options, "apn_operation_resume", { operation: id, rpc_url: f.rpc.rpcOrigin, wait_seconds: "1" });
  assert.equal(waited.ok, true, JSON.stringify(waited));
  const view = waited.operation as { operationId: string; state: string; settlementWait?: { outcome: string }; nextActions: readonly string[] };
  assert.deepEqual([view.operationId, view.state, view.settlementWait?.outcome], [id, "authorized_not_sent", "not_exposed"]);
  assert.ok(waited.next_actions.length > 0, JSON.stringify(waited));
  const after = (await new StateStore(temporary.root).findX402Operation(id))!;
  assert.deepEqual([after.attempts.length, after.integrityHash], [0, before.integrityHash]);
  assert.equal(f.http.calls.filter((call) => call.paymentSignature !== undefined).length, 0);
  // Once FINALIZED reaches the expiry, a plain resume of the same operation closes it unused.
  f.rpc.finalizedHead = { ...f.rpc.finalizedHead, timestamp: before.authorization.validBefore, observedAt: f.clock.value.toISOString() };
  const closed = await runCli(["operation", "resume", "--operation", id, "--rpc-url", f.rpc.rpcOrigin], {}, options as never);
  assert.equal((closed.operation as { state: string }).state, "failed_expired_unused", JSON.stringify(closed));
});
