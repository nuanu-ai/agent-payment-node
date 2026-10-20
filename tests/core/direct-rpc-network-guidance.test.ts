import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import type { CommandRequest, OutputEnvelope } from "../../src/commands.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { createSpecialApnCore } from "../../src/runtime-factory-special.js";
import { executeBoundCommand } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { encodeCanonicalBase64Json } from "../../src/x402-codec.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";
import { NoSecret } from "./operation-commands-families.js";

/**
 * QA 0.5.52 DIRECT-RPC-CONFIG-NETWORK-GUIDANCE-052-001: `apn pay transfer approve --operation 5732d51e…` (and the second
 * reproduction d66d3c92…) on a prepared Ethereum native transfer without --rpc-url answered "This command requires an
 * explicit HTTPS Base RPC endpoint." before any prompt. The refusal must name the operation's own chain and setting.
 */
const NETWORKS = { 1: "Ethereum", 42161: "Arbitrum One" } as const;

for (const chainId of [1, 42161] as const) test(`${NETWORKS[chainId]}: approve and resume without --rpc-url name the operation's own chain; the same operation then sends once`, async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  setup.rpc.chainId = chainId; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { ...EVM_REQUEST.asset, chainId } }) as { operation_id: string };
  const id = prepared.operation_id, before = await setup.state.findOperation(id);
  assert.equal(before?.state, "awaiting_approval");
  const network = `${NETWORKS[chainId]} (chain ${chainId})`;
  const next = [`Rerun the same command with --rpc-url set to a public HTTPS RPC endpoint of ${network}.`];
  const options: McpRuntimeOptions = { stateRoot: temporary.root, wrappingSecret: new NoSecret(), approval: setup.approval, clock: setup.clock };
  const connection = await connectMcp(options); t.after(connection.close);
  const approve = await runCli(["pay", "transfer", "approve", "--operation", id], {}, options);
  const cliResume = await runCli(["operation", "resume", "--operation", id], {}, options);
  const mcpResume = decode(await connection.client.callTool({ name: "apn_operation_resume", arguments: { operation: id } }));
  assert.deepEqual({ ...mcpResume, request_id: null }, { ...cliResume, request_id: null });
  for (const refused of [approve, cliResume]) {
    assert.equal(refused.ok, false);
    assert.equal(refused.error?.code, "APN_RPC_CONFIG");
    assert.equal(refused.error?.message, `This command reads ${network}: pass --rpc-url with a public HTTPS RPC endpoint of chain ${chainId}.`);
    assert.deepEqual(refused.error?.details, { reason: "rpc_url_required", chain_id: chainId, network: NETWORKS[chainId], nextActions: next });
    assert.deepEqual(refused.next_actions, next);
    assert.equal(JSON.stringify(refused).includes("Base"), false);
  }
  assert.deepEqual(await setup.state.findOperation(id), before, "no prompt, signature or state change before the RPC is named");
  assert.equal(setup.approval.intents.length, 0); assert.equal(setup.rpc.submissions.length, 0);

  // The same frozen operation with its own chain's RPC: one consent, one submission, no second transfer.
  const approved = await runCli(["pay", "transfer", "approve", "--operation", id, "--rpc-url", "https://rpc.example"], {}, {
    stateRoot: temporary.root, rpc: setup.rpc, wrappingSecret: setup.wrapping, approval: setup.approval, native: setup.local, clock: setup.clock });
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  assert.equal((approved.operation as { operation_id: string }).operation_id, id);
  assert.equal(setup.approval.intents.length, 1); assert.equal(setup.rpc.submissions.length, 1);
});

test("a Permit2 preflight without an RPC names the chain its expected terms select, not Avalanche", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const request = (expectedTerms: string): CommandRequest => ({ command: "x402.permit2.preflight", profile: "owner", paymentRequired: "e30=",
    expectedChallengeHash: "a".repeat(64), expectedIndex: "0", expectedTerms });
  for (const chain of ["8453", "43114"]) {
    const refused = await executeBoundCommand({ request: request(encodeCanonicalBase64Json({ scheme: "exact", network: `eip155:${chain}` })) },
      { stateRoot: temporary.root });
    assert.equal(refused.error?.code, "APN_RPC_CONFIG");
    assert.equal(refused.error?.message, `This command reads eip155:${chain}: pass --rpc-url with a public HTTPS RPC endpoint of chain ${chain}.`);
    assert.deepEqual(refused.next_actions, [`Rerun the same command with --rpc-url set to a public HTTPS RPC endpoint of eip155:${chain}.`]);
  }
  for (const terms of ["bm90LWpzb24=", encodeCanonicalBase64Json({ network: "solana:mainnet" }), encodeCanonicalBase64Json([])]) {
    const invalid = await executeBoundCommand({ request: request(terms) }, { stateRoot: temporary.root });
    assert.deepEqual([invalid.error?.code, invalid.error?.message], ["APN_INVALID_INPUT", "Expected Permit2 selection is invalid."]);
  }
});

test("a gasless quote for another chain is refused as Ethereum-only before any Ethereum RPC is asked for", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const request: CommandRequest = { command: "gasless.transfer.quote", profile: "guidance",
    owner: "0x1111111111111111111111111111111111111111", request: { chainId: 8453,
      recipient: "0x2222222222222222222222222222222222222222", grossAtomic: "5000", maxFeeAtomic: "4000", minReceivedAtomic: "1000" } };
  const core = createSpecialApnCore({ request }, {}, state);
  assert.ok(core !== null);
  const refused = await core.execute(request);
  assert.deepEqual([refused.error?.code, refused.error?.message],
    ["APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Gasless validation failed: gasless_quote_ethereum_only."]);
});

async function connectMcp(options: McpRuntimeOptions) {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-direct-rpc-guidance-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
function decode(result: Awaited<ReturnType<Client["callTool"]>>): OutputEnvelope {
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("expected one text MCP result");
  const parsed = JSON.parse(content.text) as OutputEnvelope;
  assert.deepEqual(result.structuredContent, parsed);
  return parsed;
}
