import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { bridgeNoRouteEvidence } from "../../src/lifi/no-route.js";
import { temporaryState } from "./helpers.js";
import { LIFI_SYNTHETIC_SENDER, LifiTestProvider, lifiFixture, lifiSteps } from "./lifi-helpers.js";

// QA 0.5.51 BRIDGE-LIFI-008/009 listed "no eligible route" for Ethereum ETH to Monad MON and to BNB. APN drops no route LI.FI
// returns (every returned route is listed, preparable or gated), so an empty list is LI.FI's own answer; it now says so.
const MONAD_EMPTY = { routes: [], unavailableRoutes: { filteredOut: [], failed: [] } };
/** sha256 of the exact LI.FI body: the `response_hash` the QA captured for both Monad samples (0.001 and 0.01 ETH). */
const QA_MONAD_RESPONSE_HASH = "fadee8ede726896cd8294347660b236e767470485f59a014fff4447794395635";
function argv(path: string[], args: Record<string, string>) { return [...path, ...Object.entries(args).flatMap(([k, v]) => [`--${k.replaceAll("_", "-")}`, v])]; }
const nativeArgs = (to: string) => ({ profile: "lifi-local", from_chain: "eip155:1", to_chain: to, from_token: "native", to_token: "native", amount: "0.01",
  to: LIFI_SYNTHETIC_SENDER, min_output: "0.000001", max_native_debit_wei: "2000000000000000", max_route_fee: "0.002", slippage_bps: "100" });

async function noRoute(t: test.TestContext, pair: "eth-monad" | "eth-bnb", body: unknown, to: string) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date(pair === "eth-bnb" ? "2026-09-20T16:23:00.000Z" : "2026-09-20T10:54:00.000Z");
  const s = await lifiFixture(temporary.root, pair, { provider: new LifiTestProvider(await lifiSteps(pair, now), now, body as never) });
  const options = { stateRoot: temporary.root, bridge: s.dependencies, clock: { now: () => new Date(s.now) }, wrappingSecret: s.wrapping };
  const server = createMcpServer(options), client = new Client({ name: "bridge-no-route", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]); t.after(async () => { await client.close(); await server.close(); });
  const cli = await runCli(argv(["bridge", "routes"], nativeArgs(to)), {}, options);
  const mcp = (await client.callTool({ name: "apn_bridge_routes", arguments: nativeArgs(to) })).structuredContent as unknown as OutputEnvelope;
  assert.equal(cli.ok, true, cli.error?.message); assert.equal(mcp.ok, true, mcp.error?.message); assert.deepEqual(cli.data, mcp.data);
  return { data: cli.data as any, s };
}

test("Monad: LI.FI answered no route and listed nothing filtered or failed for APN's direct Across/Stargate request", async (t) => {
  const { data } = await noRoute(t, "eth-monad", MONAD_EMPTY, "eip155:143");
  assert.equal(data.response_hash, QA_MONAD_RESPONSE_HASH); assert.deepEqual(data.routes, []);
  assert.deepEqual(data.no_route, { reason: "provider_returned_no_route", provider: "lifi", endpoint: "POST https://li.quest/v1/advanced/routes",
    from_chain: "eip155:1", to_chain: "eip155:143", from_token: "0x0000000000000000000000000000000000000000", to_token: "0x0000000000000000000000000000000000000000",
    amount_atomic: "10000000000000000", requested_tools: { bridges: ["across", "stargateV2"], exchanges: [], allow_destination_call: false },
    provider_reported: true, filtered_out: [], failed: [], omitted_rows: 0 });
});

test("BNB composite: LI.FI's failed paths are shown as it reported them, with the tools APN allowed", async (t) => {
  const capture = JSON.parse(await readFile(resolve("tests/core/lifi-fixtures/lifi-eth-bnb-no-route-20261020.json"), "utf8"));
  const { data } = await noRoute(t, "eth-bnb", capture.response, "eip155:56");
  assert.equal(data.response_hash, capture.responseSha256); assert.deepEqual(data.routes, []);
  assert.deepEqual(data.no_route.requested_tools, { bridges: ["across"], exchanges: ["fly"], allow_destination_call: true });
  assert.equal(data.no_route.to_chain, "eip155:56"); assert.equal(data.no_route.provider_reported, true); assert.deepEqual(data.no_route.filtered_out, []);
  assert.deepEqual(data.no_route.failed.map((row: any) => [row.path, row.step, row.tool, row.error_type, row.code, row.message]), [
    ["1:ETH~1:ETH-1:ETH~1:USDT-1:USDT-across-56:USDT-56:USDT~56:BNB", "1:ETH~1:USDT", "fly", "NO_QUOTE", "TOOL_NOT_ALLOWED", "Tool fly not applied."],
    ["1:ETH~1:ETH-1:ETH-across-56:WETH-56:WETH~56:BNB", "56:WETH~56:BNB", "fly", "NO_QUOTE", "TOOL_NOT_ALLOWED", "Tool fly not applied."],
    ["1:ETH~1:ETH-1:ETH~1:WETH-1:WETH-across-56:WETH-56:WETH~56:BNB", "56:WETH~56:BNB", "fly", "NO_QUOTE", "TOOL_NOT_ALLOWED", "Tool fly not applied."]]);
});

test("a listed route keeps the routes output unchanged, without a no-route block", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root, "eth-monad");
  const result = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
  assert.equal(result.ok, true, result.error?.message); assert.equal((result.data as any).routes.length, 1); assert.equal("no_route" in (result.data as any), false);
});

test("provider text is bounded and stripped of control characters; a missing or malformed report is said, not guessed", (t) => {
  const request = { fromChainId: 1, toChainId: 143, fromToken: "0x0000000000000000000000000000000000000000", toToken: "0x0000000000000000000000000000000000000000",
    amountAtomic: "1", recipient: LIFI_SYNTHETIC_SENDER, minOutputAtomic: "1", maxNativeDebitWei: "1", maxRouteFeeAtomic: "1", slippageBps: 100 } as const;
  for (const body of ["not json", "{}", JSON.stringify({ routes: [] }), JSON.stringify({ routes: [], unavailableRoutes: "x" }), JSON.stringify({ routes: [], unavailableRoutes: { failed: [] } })]) {
    const evidence = bridgeNoRouteEvidence(body, request as never);
    assert.equal(evidence.provider_reported, false); assert.deepEqual([evidence.filtered_out, evidence.failed, evidence.omitted_rows], [[], [], 0]);
  }
  const hostile = { routes: [], unavailableRoutes: { filteredOut: Array.from({ length: 10 }, (_, i) => ({ overallPath: `p${i}\u001b[31m‮`, reason: "r".repeat(500) })),
    failed: [{ overallPath: "x", subpaths: { a: [{ tool: 7, message: "m\n" }, "junk"], b: "junk" } }, "junk"] } };
  const evidence = bridgeNoRouteEvidence(JSON.stringify(hostile), request as never);
  assert.equal(evidence.filtered_out.length, 8); assert.equal(evidence.omitted_rows, 2);
  assert.equal(evidence.filtered_out[0]!.path, "p0 [31m "); assert.equal(evidence.filtered_out[0]!.reason.length, 241);
  assert.deepEqual(evidence.failed, [{ path: "x", step: "a", tool: "", error_type: "", code: "", message: "m " },
    { path: "x", step: "a", tool: "", error_type: "", code: "", message: "" }, { path: "", step: "", tool: "", error_type: "", code: "", message: "" }]);
});
