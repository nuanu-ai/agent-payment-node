import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { renderHelp } from "../../src/command-catalog.js";
import { runCli } from "../../src/cli.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { BRIDGE_COMMANDS } from "../../src/lifi/command-catalog.js";
import { BridgeHttps } from "../../src/lifi/https.js";
import { LIFI_INVENTORY_RESPONSE_BYTES, LifiProvider, normalizeLifiStatus, type LifiTransport } from "../../src/lifi/provider.js";
import { validateBridgeQuote } from "../../src/lifi/quote-repository.js";
import { bridgeRpcFactory } from "../../src/lifi/rpc.js";
import { bridgeInventory } from "../../src/lifi/catalog.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";
import { BASE_SOLANA_USDC_CANDIDATE, BASE_TRON_USDT_CANDIDATE } from "../../src/lifi/discovery-candidates.js";

const BRIDGE_USDC = { 1: BRIDGE_ASSET_REGISTRY[1].tokens[0]!.address, 8453: BRIDGE_ASSET_REGISTRY[8453].tokens[0]!.address,
  42161: BRIDGE_ASSET_REGISTRY[42161].tokens[0]!.address } as const;
import { temporaryState } from "./helpers.js";
import { LIFI_RECIPIENT, LIFI_SYNTHETIC_SENDER, lifiFixture } from "./lifi-helpers.js";

const routeArgs = { profile: "lifi-local", from_chain: "eip155:1", to_chain: "eip155:8453", from_token: BRIDGE_USDC[1],
  to_token: BRIDGE_USDC[8453], amount: "10", to: LIFI_RECIPIENT, min_output: "9", max_native_debit_wei: "20000000000000000", max_route_fee: "1", slippage_bps: "50" };
function argv(path: string[], args: Record<string, string>) { return [...path, ...Object.entries(args).flatMap(([k, v]) => [`--${k.replaceAll("_", "-")}`, v])]; }

test("LI.FI all five CLI and MCP commands bind identically, without a generic RPC fallback", () => {
  const argumentsByPath: Record<string, Record<string, string>> = {
    "bridge capabilities": { profile: "lifi-local" }, "bridge inventory": {}, "bridge routes": routeArgs,
    "bridge prepare": { profile: "lifi-local", quote: "a".repeat(64), route: "route-across", idempotency_key: "bridge-key-0001" },
    "bridge approve": { operation: "b".repeat(64) },
  };
  for (const c of BRIDGE_COMMANDS) {
    const args = argumentsByPath[c.path.join(" ")]!;
    assert.deepEqual(bindArgv(argv([...c.path], args)), bindMcpInput(c, args));
    assert.throws(() => bindArgv(argv([...c.path], { ...args, rpc_url: "https://rpc.example" })), { code: "APN_INVALID_INPUT" });
    assert.throws(() => bindMcpInput(c, { ...args, secret: "unaccepted" }), { code: "APN_INVALID_INPUT" });
    assert.match(renderHelp([...c.path]), /apn bridge/u);
  }
  assert.deepEqual(projectMcpTools().filter((t) => t.name.startsWith("apn_bridge_")).map((t) => t.name),
    ["apn_bridge_capabilities", "apn_bridge_inventory", "apn_bridge_routes", "apn_bridge_prepare", "apn_bridge_approve"]);
  for (const changed of [{ amount: "1e2" }, { min_output: "0" }, { slippage_bps: "1001" }, { to_chain: "eip155:1" },
    { from_token: LIFI_RECIPIENT }, { max_route_fee: "0.0000001" }, { from_chain: "eip155:10" },
    { to_chain: String(BASE_SOLANA_USDC_CANDIDATE.toChainId), to_token: BASE_SOLANA_USDC_CANDIDATE.toToken },
    { to_chain: String(BASE_TRON_USDT_CANDIDATE.toChainId), to_token: BASE_TRON_USDT_CANDIDATE.toToken }]) {
    assert.throws(() => bindArgv(argv(["bridge", "routes"], { ...routeArgs, ...changed })), { code: "APN_INVALID_INPUT" });
  }
});

test("LI.FI offline capability and MCP approval handoff do not inspect invalid state or enter injected effect ports", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); await writeFile(temporary.root, "not a state directory");
  let touched = 0; const trap = new Proxy({}, { get() { touched++; throw new Error("forbidden effect or read"); } });
  const options = { stateRoot: temporary.root, bridge: trap as any, wrappingSecret: trap as any, native: trap as any };
  const result = await runCli(["bridge", "capabilities", "--profile", "unbound"], {}, options);
  assert.equal(result.ok, true, result.error?.message); const data = result.data as any;
  assert.equal(data.profile_binding_inspected, false); assert.equal(data.profiles.length, 4); assert.equal(data.mainnet_acceptance.passed, 0);
  assert.deepEqual(data.candidate_lanes, [{ from_chain: "eip155:8453", from_token: BASE_SOLANA_USDC_CANDIDATE.fromToken,
    to_lifi_chain_id: BASE_SOLANA_USDC_CANDIDATE.toChainId, to_token: BASE_SOLANA_USDC_CANDIDATE.toToken,
    provider_route_state: "unverified_by_static_capabilities", executable: false,
    missing_proof: ["selected_route_and_source_call", "solana_destination_delivery_and_finality", "fee_and_recovery_contract"] },
    { from_chain: "eip155:8453", from_token: BASE_TRON_USDT_CANDIDATE.fromToken,
      to_lifi_chain_id: BASE_TRON_USDT_CANDIDATE.toChainId, to_token: BASE_TRON_USDT_CANDIDATE.toToken,
      tool: "allbridge", provider_route_state: "unverified_by_static_capabilities", executable: false,
      missing_proof: ["selected_allbridge_route_and_source_call", "tron_solidified_destination_delivery_and_correlation", "fee_refund_and_recovery_contract"] }]);
  const server = createMcpServer(options), client = new Client({ name: "bridge-contract", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]); t.after(async () => { await client.close(); await server.close(); });
  const capability = await client.callTool({ name: "apn_bridge_capabilities", arguments: { profile: "unbound" } });
  assert.deepEqual((capability.structuredContent as unknown as OutputEnvelope).data, result.data);
  const op = "a".repeat(64), handoff = (await client.callTool({ name: "apn_bridge_approve", arguments: { operation: op } })).structuredContent as unknown as OutputEnvelope;
  assert.equal(handoff.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.match(JSON.stringify(handoff), new RegExp(`apn bridge approve --operation ${op}`, "u"));
  assert.equal(touched, 0); assert.equal(await readFile(temporary.root, "utf8"), "not a state directory");
});

test("LI.FI routes and prepare have CLI/MCP parity and prepare replay survives missing quote and unavailable ports", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const options = { stateRoot: temporary.root, bridge: s.dependencies, clock: { now: () => new Date(s.now) }, wrappingSecret: s.wrapping };
  const server = createMcpServer(options), client = new Client({ name: "bridge-flow", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]); t.after(async () => { await client.close(); await server.close(); });
  const cliInventory = await runCli(["bridge", "inventory"], {}, options);
  const mcpInventory = (await client.callTool({ name: "apn_bridge_inventory", arguments: {} })).structuredContent as unknown as OutputEnvelope;
  assert.equal(cliInventory.ok, true, cliInventory.error?.message); assert.deepEqual(cliInventory.data, mcpInventory.data);
  assert.equal((cliInventory.data as any).capability.candidate_lanes[1].executable, false);
  const cli = await runCli(argv(["bridge", "routes"], routeArgs), {}, options);
  const mcp = (await client.callTool({ name: "apn_bridge_routes", arguments: routeArgs })).structuredContent as unknown as OutputEnvelope;
  assert.equal(cli.ok, true, cli.error?.message); assert.equal(mcp.ok, true, mcp.error?.message); assert.deepEqual(cli.data, mcp.data);
  const args = { profile: s.profile, quote: (cli.data as any).quote_hash as string, route: "route-across", idempotency_key: "bridge-parity-0001" };
  const first = await runCli(argv(["bridge", "prepare"], args), {}, options); assert.equal(first.ok, true, first.error?.message);
  const count = s.provider.materializeCalls, rpcCount = s.source.calls.length;
  const second = (await client.callTool({ name: "apn_bridge_prepare", arguments: args })).structuredContent as unknown as OutputEnvelope;
  assert.equal(second.ok, true, second.error?.message); assert.deepEqual(first.operation, second.operation);
  assert.equal(s.provider.materializeCalls, count); assert.equal(s.source.calls.length, rpcCount); assert.equal(s.wrapping.loads, 0);
  const profileHash = s.state.profileHash(s.profile), quotePath = join(temporary.root, "bridge-quotes", profileHash, `${args.quote}.json`);
  await writeFile(quotePath, "corrupted quote after authoritative prepare", { mode: 0o600 });
  s.provider.materialize = async () => { throw new Error("network forbidden on replay"); };
  const replay = await runCli(argv(["bridge", "prepare"], args), {}, options); assert.equal(replay.ok, true, replay.error?.message);
  assert.deepEqual(first.operation, replay.operation); assert.equal(s.source.submissions.length, 0);
});

test("LI.FI quote route and owner tampering is rejected even when outer checksums are recomputed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const result = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request }); assert.equal(result.ok, true);
  const hash = (result.data as any).quote_hash as string, path = join(temporary.root, "bridge-quotes", s.state.profileHash(s.profile), `${hash}.json`);
  const original = JSON.parse(await readFile(path, "utf8"));
  for (const mutate of [(r: any) => { r.routes[0].routeId = "different"; }, (r: any) => { r.owner.profile = "other"; }, (r: any) => { r.rawResponse = "{}"; }]) {
    const value = structuredClone(original); mutate(value); const { snapshotHash: _h, ...body } = value; value.snapshotHash = hashObject(body);
    assert.throws(() => validateBridgeQuote(value), { code: "APN_STATE_CORRUPT" });
  }
  const foreign = await s.core.execute({ command: "bridge.prepare", profile: "another", quote: hash, route: "route-across", idempotencyKey: "foreign-quote-0001" });
  assert.equal(foreign.error?.code, "APN_INVALID_INPUT"); assert.equal(s.provider.materializeCalls, 0); assert.equal(s.source.calls.length, 0);
});

test("LI.FI RPC environment requires each exact admitted chain endpoint and rejects public-network ambiguities", () => {
  for (const chain of [1, 8453, 42161] as const) assert.throws(() => bridgeRpcFactory({ APN_RPC_URL: "https://rpc.example" })(chain), { code: "APN_RPC_CONFIG" });
  for (const url of ["http://rpc.example", "https://127.0.0.1", "https://user:secret@rpc.example", "https://rpc.example/?token=x", "https://rpc.example/#x"]) {
    assert.throws(() => bridgeRpcFactory({ APN_BASE_RPC_URL: url })(8453), { code: "APN_RPC_CONFIG" });
  }
  const rpc = bridgeRpcFactory({ APN_BASE_RPC_URL: "https://base.example/rpc", APN_ETHEREUM_RPC_URL: "https://ethereum.example/rpc" });
  assert.equal(rpc(8453).origin, "https://base.example"); assert.equal(rpc(1).origin, "https://ethereum.example"); assert.equal(rpc(8453), rpc(8453));
});

test("LI.FI public provider API contract uses fixed endpoints, finite tools, one inventory per admitted asset pair and bounded status normalization", async () => {
  const calls: Parameters<LifiTransport["request"]>[] = [], provider = new LifiProvider({ async request(...args) { calls.push(args); return { status: 200, body: "{}" }; } });
  // One connection probe per admitted (asset, peer) row, so the count follows the registry rather than a constant.
  const admittedPairs = ([1, 8453, 42161] as const).reduce((sum, id) =>
    sum + BRIDGE_ASSET_REGISTRY[id].tokens.reduce((rows, asset) => rows + asset.peers.length, 0), 0);
  assert.equal(admittedPairs, 8);
  const responses = await provider.inventory(); assert.equal(calls.length, 3 + admittedPairs + 1 + 4);
  const pairs = JSON.parse(responses.connections.body).pairs as Array<Record<string, unknown>>;
  assert.equal(pairs.length, admittedPairs + 2);
  assert.deepEqual(pairs.at(-2), { fromChainId: BASE_SOLANA_USDC_CANDIDATE.fromChainId,
    toChainId: BASE_SOLANA_USDC_CANDIDATE.toChainId, fromToken: BASE_SOLANA_USDC_CANDIDATE.fromToken,
    toToken: BASE_SOLANA_USDC_CANDIDATE.toToken, status: 200,
    responseHash: pairs.at(-2)!.responseHash, response: {} });
  assert.deepEqual(pairs.at(-1), { fromChainId: BASE_TRON_USDT_CANDIDATE.fromChainId,
    toChainId: BASE_TRON_USDT_CANDIDATE.toChainId, fromToken: BASE_TRON_USDT_CANDIDATE.fromToken,
    toToken: BASE_TRON_USDT_CANDIDATE.toToken, tool: "allbridge", status: "unavailable", responseHash: null, response: null });
  const publicInventory = bridgeInventory(responses) as any;
  assert.equal(publicInventory.observed.connections.executable_capability, false);
  assert.deepEqual(publicInventory.observed.connections.provider_inventory.pairs.at(-1), pairs.at(-1));
  assert.deepEqual(new URL(calls.find((c) => c[0].includes("/tools?"))![0]).searchParams.getAll("chains"), ["1", "8453", "42161"]);
  const connectionCalls = calls.filter((c) => c[0].includes("/connections?"));
  assert.equal(connectionCalls.length, admittedPairs + 2);
  const candidate = connectionCalls.map((c) => new URL(c[0])).find((url) => url.searchParams.get("toChain") === String(BASE_SOLANA_USDC_CANDIDATE.toChainId));
  assert.ok(candidate);
  assert.equal(candidate.searchParams.get("fromChain"), String(BASE_SOLANA_USDC_CANDIDATE.fromChainId));
  assert.equal(candidate.searchParams.get("fromToken"), BASE_SOLANA_USDC_CANDIDATE.fromToken);
  assert.equal(candidate.searchParams.get("toToken"), BASE_SOLANA_USDC_CANDIDATE.toToken);
  assert.equal(candidate.searchParams.get("allowSwitchChain"), "false");
  assert.equal(candidate.searchParams.get("allowDestinationCall"), "false");
  const tron = connectionCalls.map((c) => new URL(c[0])).find((url) => url.searchParams.get("toChain") === String(BASE_TRON_USDT_CANDIDATE.toChainId));
  assert.ok(tron);
  assert.equal(tron.searchParams.get("fromChain"), String(BASE_TRON_USDT_CANDIDATE.fromChainId));
  assert.equal(tron.searchParams.get("fromToken"), BASE_TRON_USDT_CANDIDATE.fromToken);
  assert.equal(tron.searchParams.get("toToken"), BASE_TRON_USDT_CANDIDATE.toToken);
  assert.equal(tron.searchParams.get("allowBridges"), "allbridge");
  assert.equal(tron.searchParams.get("allowSwitchChain"), "false");
  assert.equal(tron.searchParams.get("allowDestinationCall"), "false");
  assert.ok(calls.some((c) => c[0] === "https://li.quest/v1/chains?chainTypes=TVM"));
  assert.ok(calls.some((c) => c[0] === "https://li.quest/v1/tokens?chains=728126428"));
  assert.ok(calls.some((c) => c[0] === "https://li.quest/v1/tools?chains=8453&chains=728126428"));
  const request = { fromChainId: 1 as const, toChainId: 8453 as const, fromToken: BRIDGE_USDC[1], toToken: BRIDGE_USDC[8453], recipient: LIFI_RECIPIENT,
    amountAtomic: "10000000", minOutputAtomic: "9000000", maxNativeDebitWei: routeArgs.max_native_debit_wei, maxRouteFeeAtomic: "1000000", slippageBps: 50 };
  await provider.routes(request, LIFI_SYNTHETIC_SENDER); const last = calls.at(-1)!; assert.equal(last[0], "https://li.quest/v1/advanced/routes");
  assert.equal(last[1], "POST"); assert.equal(last[3], 512 * 1024); const body = JSON.parse(last[2]!);
  assert.deepEqual(body.options.bridges.allow, ["across", "stargateV2"]); assert.deepEqual(body.options.exchanges.allow, []);
  assert.equal(body.options.gasless, false); assert.equal(body.options.allowDestinationCall, false); assert.equal(body.options.integrator, "lifi-api");
  const at = "2026-09-08T12:00:00.000Z";
  for (const [body, expected] of [[{ status: "NOT_FOUND" }, "not_found"], [{ code: 1003 }, "not_found"], [{ status: "PENDING" }, "pending"],
    [{ status: "DONE", substatus: "COMPLETED" }, "completed_observed"], [{ status: "DONE", substatus: "PARTIAL" }, "partial_observed"],
    [{ status: "DONE", substatus: "REFUNDED" }, "refund_observed"], [{ status: "FAILED" }, "failed_observed"], [{ status: "DONE", substatus: "NEW" }, "unknown"]] as const) {
    assert.equal(normalizeLifiStatus({ status: 200, body: JSON.stringify(body) }, at).status, expected);
  }
  assert.equal(normalizeLifiStatus({ status: 404, body: "not JSON" }, at).status, "not_found");
  assert.equal(normalizeLifiStatus({ status: 200, body: JSON.stringify({ status: "DONE", substatus: "COMPLETED", receiving: { txHash: "broken" } }) }, at).status, "unknown");
  const inventory = bridgeInventory(Object.fromEntries(["chains", "tokens", "tools", "connections"].map((key) => [key, {
    status: 200, body: JSON.stringify({ chains: [{ id: 1, name: "Ethereum", rpcUrls: ["https://credential.example"], description: "SECRET_PROVIDER_TEXT" }] }),
  }])) as any);
  assert.doesNotMatch(JSON.stringify(inventory), /SECRET_PROVIDER_TEXT|credential/u); assert.equal(inventory.observed.chains!.executable_capability, false);
  assert.equal(inventory.observed.connections!.executable_capability, false);
  await assert.rejects(new BridgeHttps().request("https://li.quest/v1/advanced/routes", "POST", "x".repeat(256 * 1024 + 1), 512 * 1024, "APN_HTTP_CONFIG"), { code: "APN_PROVIDER_UNAVAILABLE" });
});

test("a failed discovery-only Solana probe remains unavailable while admitted EVM inventory succeeds", async (t) => {
  for (const failure of ["transport", "malformed", "non-200", "combined-size", "deep", "large-array"] as const) await t.test(failure, async () => {
    const provider = new LifiProvider({ async request(endpoint) {
      const candidate = endpoint.includes("/connections?") && new URL(endpoint).searchParams.get("toChain") === String(BASE_SOLANA_USDC_CANDIDATE.toChainId);
      if (candidate && failure === "transport") throw new Error("candidate transport unavailable");
      if (candidate && failure === "malformed") return { status: 200, body: "not JSON" };
      if (candidate && failure === "non-200") return { status: 503, body: "{}" };
      if (candidate && failure === "combined-size") return { status: 200, body: JSON.stringify({ name: "x".repeat(LIFI_INVENTORY_RESPONSE_BYTES - 256) }) };
      if (candidate && failure === "large-array") return { status: 200, body: JSON.stringify({ pairs: Array(20_001).fill(0) }) };
      if (candidate && failure === "deep") {
        let value: Record<string, unknown> = { status: "PENDING" };
        for (let index = 0; index < 6; index += 1) value = { response: value };
        return { status: 200, body: JSON.stringify(value) };
      }
      return { status: 200, body: "{}" };
    } });
    const responses = await provider.inventory();
    const pairs = JSON.parse(responses.connections.body).pairs as Array<Record<string, unknown>>;
    assert.equal(pairs.length, 10);
    assert.ok(pairs.slice(0, -2).every((pair) => pair.status === 200 && pair.responseHash !== null));
    assert.deepEqual(pairs.at(-2), { fromChainId: BASE_SOLANA_USDC_CANDIDATE.fromChainId,
      toChainId: BASE_SOLANA_USDC_CANDIDATE.toChainId, fromToken: BASE_SOLANA_USDC_CANDIDATE.fromToken,
      toToken: BASE_SOLANA_USDC_CANDIDATE.toToken, status: "unavailable", responseHash: null, response: null });
    assert.equal(pairs.at(-1)?.status, "unavailable");
    const publicInventory = bridgeInventory(responses) as any;
    assert.deepEqual(publicInventory.observed.connections.provider_inventory.pairs.at(-2), pairs.at(-2));
    assert.equal(publicInventory.observed.connections.executable_capability, false);
  });
  const admittedFailure = new LifiProvider({ async request(endpoint) {
    if (endpoint.includes("/connections?") && new URL(endpoint).searchParams.get("toChain") === "8453") throw new Error("admitted lane unavailable");
    return { status: 200, body: "{}" };
  } });
  await assert.rejects(admittedFailure.inventory(), /admitted lane unavailable/u);
});

test("TRON Allbridge candidate needs matching TVM chain, canonical token, tool and connection inventory", async (t) => {
  const tron = BASE_TRON_USDT_CANDIDATE;
  for (const failure of ["none", "chain", "token", "tool", "connection", "transport", "deep", "oversized"] as const) await t.test(failure, async () => {
    const provider = new LifiProvider({ async request(endpoint) {
      if (endpoint.includes("chainTypes=TVM")) return { status: 200, body: JSON.stringify({ chains: [{ id: failure === "chain" ? 1 : tron.toChainId,
        key: "trn", chainType: "TVM", mainnet: true }] }) };
      if (endpoint.includes(`/tokens?chains=${tron.toChainId}`)) return { status: 200, body: JSON.stringify({ tokens: { [tron.toChainId]: [
        { chainId: tron.toChainId, address: failure === "token" ? "wrong" : tron.toToken, symbol: "USDT", decimals: 6 }] } }) };
      if (endpoint.includes("/tools?chains=8453&chains=728126428")) return { status: 200, body: JSON.stringify({ bridges: [
        { key: failure === "tool" ? "wrong" : tron.tool, supportedChains: [{ fromChainId: tron.fromChainId, toChainId: tron.toChainId }] }] }) };
      if (endpoint.includes("/connections?") && new URL(endpoint).searchParams.get("toChain") === String(tron.toChainId)) {
        if (failure === "transport") throw new Error("TRON inventory unavailable");
        if (failure === "oversized") return { status: 200, body: "x".repeat(LIFI_INVENTORY_RESPONSE_BYTES + 1) };
        if (failure === "deep") { let value: Record<string, unknown> = { connections: [] };
          for (let i = 0; i < 7; i++) value = { response: value }; return { status: 200, body: JSON.stringify(value) }; }
        return { status: 200, body: JSON.stringify({ connections: [{ fromChainId: tron.fromChainId, toChainId: tron.toChainId,
          fromTokens: [{ address: tron.fromToken, chainId: tron.fromChainId }],
          toTokens: [{ address: failure === "connection" ? "wrong" : tron.toToken, chainId: tron.toChainId }] }] }) };
      }
      return { status: 200, body: "{}" };
    } });
    const pairs = JSON.parse((await provider.inventory()).connections.body).pairs as Array<Record<string, unknown>>;
    assert.equal(pairs.length, 10);
    assert.equal(pairs.at(-1)?.status, failure === "none" ? 200 : "unavailable");
    assert.equal(pairs.at(-1)?.tool, "allbridge");
    assert.ok(pairs.slice(0, -2).every((pair) => pair.status === 200));
  });
});

test("an optional unavailable marker is omitted when admitted-only inventory fits but the marker exceeds the bound", async () => {
  let filler = "";
  const provider = new LifiProvider({ async request(endpoint) {
    if (!endpoint.includes("/connections?")) return { status: 200, body: "{}" };
    const query = new URL(endpoint).searchParams;
    if (query.get("toChain") === String(BASE_SOLANA_USDC_CANDIDATE.toChainId)) throw new Error("candidate unavailable");
    return { status: 200, body: query.get("fromChain") === "1" && query.get("toChain") === "8453"
      && query.get("fromToken") === BRIDGE_USDC[1] ? JSON.stringify({ name: filler }) : "{}" };
  } });
  const baseline = JSON.parse((await provider.inventory()).connections.body).pairs as Array<Record<string, unknown>>;
  assert.equal(baseline.length, 10);
  const admitted = baseline.slice(0, -2);
  const admittedBytes = Buffer.byteLength(canonicalJson({ pairs: admitted }));
  const markerBytes = Buffer.byteLength(canonicalJson({ pairs: [...admitted, baseline.at(-2)] })) - admittedBytes;
  filler = "x".repeat(LIFI_INVENTORY_RESPONSE_BYTES - admittedBytes - Math.floor(markerBytes / 2));
  const responses = await provider.inventory();
  const bodyBytes = Buffer.byteLength(responses.connections.body);
  const pairs = JSON.parse(responses.connections.body).pairs as Array<Record<string, unknown>>;
  assert.equal(pairs.length, 8);
  assert.ok(bodyBytes <= LIFI_INVENTORY_RESPONSE_BYTES);
  assert.ok(bodyBytes + markerBytes > LIFI_INVENTORY_RESPONSE_BYTES);
  assert.equal((bridgeInventory(responses) as any).observed.connections.executable_capability, false);
});
