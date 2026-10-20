/**
 * OUTPUT-RECOVERY-GUIDANCE-001: recovery advice addresses the operation that failed. An anonymous LI.FI inventory read is
 * retried as a read, never repaired by a wallet connect; wallet-provider advice stays only on commands an external wallet
 * profile can run; a profile without a permission lifecycle and a local gasless endpoint error name their own next step.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { GaslessRpc } from "../../src/gasless/rpc.js";
import { LifiProvider } from "../../src/lifi/provider.js";
import type { BridgeDependencies } from "../../src/lifi/service.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { failureEnvelope } from "../../src/output.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import type { ProviderAdapterBundle } from "../../src/provider-ports.js";
import { metamaskDirectCapabilitySnapshot } from "../../src/provider-profile.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { temporaryState, TestNative, TestRpc } from "./helpers.js";
import { mmFixture } from "./metamask-gasless-helpers.js";
import { TestHttp } from "./x402-helpers.js";

const WALLET_ADVICE = /wallet connect|pinned provider client|local profile/u;
const trap = new Proxy({}, { get: () => { throw new Error("bridge inventory must not touch wallets, RPC or custody"); } });

test("an aborted anonymous bridge inventory read is retried as a read in CLI and MCP; no wallet step is suggested", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let requests = 0;
  // The captured 0.5.51 transport refusal: APN_PROVIDER_UNAVAILABLE, response_aborted, no wallet or profile involved.
  const provider = new LifiProvider({ request: async () => { requests += 1;
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Bridge transport failed: response_aborted.", { transportReason: "response_aborted" }); } });
  const options = { stateRoot: temporary.root, bridge: { provider, rpcFor: trap, custody: trap } as unknown as BridgeDependencies,
    wrappingSecret: { load: async () => Buffer.alloc(32), create: async () => Buffer.alloc(32) } };
  const cli = await runCli(["bridge", "inventory"], {}, options);
  const server = createMcpServer(options), client = new Client({ name: "recovery-guidance", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]);
  t.after(async () => { await client.close(); await server.close(); });
  const mcp = (await client.callTool({ name: "apn_bridge_inventory", arguments: {} })).structuredContent as unknown as OutputEnvelope;
  for (const envelope of [cli, mcp]) {
    assert.deepEqual([envelope.ok, envelope.error?.code, envelope.error?.message, envelope.error?.details?.transportReason],
      [false, "APN_PROVIDER_UNAVAILABLE", "Bridge transport failed: response_aborted.", "response_aborted"]);
    assert.deepEqual(envelope.next_actions, ["Check network access to the LI.FI public API (https://li.quest/v1); this anonymous read uses no wallet or profile. Then rerun:",
      "apn bridge inventory"]);
    assert.equal(envelope.next_actions.some(action => WALLET_ADVICE.test(action)), false);
  }
  assert.ok(requests >= 2);
});

test("wallet-provider advice follows only commands an external wallet profile can run; session handoff is unchanged", () => {
  const provider = (code: "APN_PROVIDER_UNAVAILABLE" | "APN_PROVIDER_PROTOCOL" | "APN_PROVIDER_EFFECT_UNAVAILABLE") => new ApnError(code, "x");
  for (const command of ["bridge.inventory", "bridge.prepare", "circle.source.submit", "relay.observe", "swap.uniswap.quote", "mega.funding.status",
    "gasless.usdt.prepare", "allowlist.inventory", "invalid"]) {
    for (const code of ["APN_PROVIDER_UNAVAILABLE", "APN_PROVIDER_PROTOCOL", "APN_PROVIDER_EFFECT_UNAVAILABLE"] as const) {
      assert.deepEqual(failureEnvelope(command, "r", provider(code)).next_actions, [], `${command} ${code}`);
    }
  }
  assert.deepEqual(failureEnvelope("wallet.connect", "r", provider("APN_PROVIDER_UNAVAILABLE")).next_actions,
    ["Verify the exact pinned provider client, then retry foreground wallet connect."]);
  assert.deepEqual(failureEnvelope("x402.fetch.prepare", "r", provider("APN_PROVIDER_EFFECT_UNAVAILABLE")).next_actions,
    ["Use a local profile for payment effects in this APN version."]);
  assert.deepEqual(failureEnvelope("gasless.transfer.prepare", "r", new ApnError("APN_PROVIDER_SESSION_REQUIRED", "x")).next_actions,
    ["Run the foreground wallet connect handoff again."]);
  assert.deepEqual(failureEnvelope("bridge.inventory", "r", new ApnError("APN_PROVIDER_UNAVAILABLE", "x", { nextActions: ["apn bridge inventory"] })).next_actions,
    ["apn bridge inventory"]);
});

test("permission list on an Agent Wallet profile says permissions belong to a Smart Account and names the profile's own status", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root);
  const adapter: ProviderAdapterBundle = { provider_id: "metamask-agent-wallet", trust_class: f.publicProfile.trust_class,
    capabilities: metamaskDirectCapabilitySnapshot(),
    lifecycle: { async connect() { throw new Error("forbidden connect"); }, async probeStatus() {} },
    reads: { async observeBalance() { throw new Error("forbidden balance"); }, async crossCheckAddress() {} } };
  const core = new ApnCore({ state: f.state, profileRepository: new StateProfileRepository(f.state), native: new TestNative(), rpc: new TestRpc(),
    http: new TestHttp(), clock: f.clock, providerRegistry: new ProviderRegistry([{ provider_id: "metamask-agent-wallet", create: () => adapter }]) });
  const listed = await core.execute({ command: "wallet.permission.list", profile: f.profile });
  assert.deepEqual([listed.ok, listed.error?.code, listed.error?.message],
    [false, "APN_PROVIDER_EFFECT_UNAVAILABLE", "This provider profile has no permission lifecycle."]);
  assert.deepEqual(listed.next_actions, ["Permission commands apply only to a MetaMask Smart Account profile (provider metamask-smart-account) and its ERC-7715 grant; this profile has none to list or change.",
    `apn wallet status --profile ${f.profile}`]);
});

test("a JSON-RPC error from a local gasless endpoint names that endpoint's setting, not a wallet or profile change", async () => {
  const deployment = gaslessDeployment(8453), seen: string[] = [];
  const transport: GaslessTransport = { async request(endpoint, _verb, body) {
    const parsed = JSON.parse(body ?? "null") as { id: string; method: string } | { id: string; method: string }[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    seen.push(...rows.map(row => `${endpoint.startsWith("https://base-rpc.example") ? "rpc" : "bundler"}:${row.method}`));
    const answer = (row: { id: string; method: string }) => endpoint.startsWith("https://base-rpc.example")
      ? { jsonrpc: "2.0", id: row.id, error: { code: -32601, message: "method not supported" } }
      : { jsonrpc: "2.0", id: row.id, result: row.method === "eth_chainId" ? "0x2105" : [deployment.entryPoint] };
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? rows.map(answer) : answer(rows[0]!)) };
  } };
  const rpc = new GaslessRpc(8453, "https://base-rpc.example/v1", undefined, transport);
  const refused = await rpc.assertChain().then(() => null, (error: unknown) => error as ApnError);
  assert.ok(refused instanceof ApnError);
  assert.deepEqual([refused.code, refused.message, refused.details?.endpoint],
    ["APN_PROVIDER_EFFECT_UNAVAILABLE", "Gasless validation failed: gasless_provider_response.", "rpc"]);
  const envelope = failureEnvelope("gasless.transfer.prepare", "r", refused);
  assert.equal(envelope.next_actions.length, 1);
  assert.match(envelope.next_actions[0]!, new RegExp(`Set ${deployment.rpcEnv} to a public HTTPS ${deployment.network} RPC endpoint that serves it`, "u"));
  assert.equal(envelope.next_actions.some(action => WALLET_ADVICE.test(action)), false);
  assert.ok(seen.includes("rpc:eth_chainId"));
});
