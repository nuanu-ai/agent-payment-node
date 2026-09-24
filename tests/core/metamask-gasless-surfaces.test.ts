import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bindMcpInput } from "../../src/command-binder.js";
import { COMMANDS } from "../../src/command-catalog.js";
import { parseArgv, runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { gaslessCapabilities } from "../../src/gasless/catalog.js";
import type { GaslessDependencies } from "../../src/gasless/service.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { MetaMaskGaslessDependencies } from "../../src/metamask-gasless/service.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { projectMcpTools, type ProjectedMcpTool } from "../../src/mcp-projection.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";
import { MM_TEST_RECIPIENT, mmFixture } from "./metamask-gasless-helpers.js";

const LOCAL_CHAINS = [1, 10, 130, 137, 8453, 42161, 43114] as const;
const METAMASK_CHAINS = [1, 10, 137, 143, 1329, 8453, 42161, 59144] as const;
const GASLESS_PATHS = [
  "gasless usdt prepare",
  "gasless usdt status",
  "gasless usdt resume",
  "gasless capabilities",
  "gasless balance",
  "gasless transfer prepare",
  "gasless transfer approve",
] as const;
const GASLESS_TOOLS = [
  "apn_gasless_usdt_prepare",
  "apn_gasless_usdt_status",
  "apn_gasless_usdt_resume",
  "apn_gasless_capabilities",
  "apn_gasless_balance",
  "apn_gasless_transfer_prepare",
  "apn_gasless_transfer_approve",
] as const;
const OPERATION_ID = "a".repeat(64);

test("the combined gasless surface preserves common commands and exposes implemented provider rows", () => {
  const capabilities = gaslessCapabilities("surface-profile") as {
    profile: string;
    profile_binding_inspected: boolean;
    networks: Array<{ chain_id: number; executable_adapter: boolean; mainnet_acceptance: string }>;
    profiles: Array<{ provider: string; custody: string; adapter: string; mainnet_acceptance: string }>;
    provider_networks: {
      local: number[];
      "metamask-agent-wallet": Array<{
        chain_id: number;
        executable_adapter: boolean;
        action_time_verification_required: boolean;
        mainnet_acceptance: string;
      }>;
    };
  };
  assert.equal(capabilities.profile, "surface-profile");
  assert.equal(capabilities.profile_binding_inspected, false);
  assert.deepEqual(capabilities.networks.map(row => row.chain_id), LOCAL_CHAINS);
  assert.equal(capabilities.networks.every(row => row.executable_adapter === (row.chain_id !== 43114) &&
    row.mainnet_acceptance === "open"), true);
  assert.deepEqual(capabilities.provider_networks.local, [1, 10, 130, 137, 8453, 42161]);
  assert.deepEqual(capabilities.provider_networks["metamask-agent-wallet"].map(row => row.chain_id), METAMASK_CHAINS);
  assert.equal(capabilities.provider_networks["metamask-agent-wallet"].every(row =>
    row.executable_adapter && row.action_time_verification_required && row.mainnet_acceptance === "open"), true);
  assert.deepEqual(capabilities.profiles.map(row => [row.provider, row.custody, row.adapter, row.mainnet_acceptance]), [
    ["local", "local_software", "implemented", "open"],
    ["metamask-agent-wallet", "provider_managed_server_wallet", "implemented", "open"],
    ["metamask-smart-account", "provider_owned_session_grant", "implemented", "open"],
    ["coinbase-agentic-wallet", "provider_owned", "implemented", "open"],
  ]);

  const commands = COMMANDS.filter(command => command.path[0] === "gasless");
  assert.deepEqual(commands.map(command => command.path.join(" ")), GASLESS_PATHS);
  const chain = requiredCommand(commands, "gasless balance").options.find(option => option.name === "--chain");
  assert.deepEqual(chain?.constraints, [
    "numeric_mainnet_id_1_10_130_137_143_1329_8453_42161_43114_59144",
    "provider_specific_chain_admission",
  ]);
  assert.deepEqual(projectMcpTools().filter(tool => tool.name.startsWith("apn_gasless_")).map(tool => tool.name), GASLESS_TOOLS);
});

test("CLI and MCP share strict ten-chain input while the local adapter rejects its two MetaMask-only chains before RPC", async (t) => {
  const tools = projectMcpTools().filter(tool => tool.name.startsWith("apn_gasless_"));
  const balance = requiredTool(tools, "apn_gasless_balance");
  const prepare = requiredTool(tools, "apn_gasless_transfer_prepare");
  assert.deepEqual({
    properties: Object.keys(prepare.inputSchema.properties),
    required: prepare.inputSchema.required,
    additionalProperties: prepare.inputSchema.additionalProperties,
  }, {
    properties: ["profile", "chain", "to", "amount", "max_fee", "min_received", "idempotency_key"],
    required: ["profile", "chain", "to", "amount", "max_fee", "min_received", "idempotency_key"],
    additionalProperties: false,
  });

  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const local = await gaslessFixture(temporary.root);
  for (const chain of [143, 59144] as const) {
    const cliBalance = parseArgv(["gasless", "balance", "--profile", local.profile, "--chain", String(chain)]);
    assert.deepEqual(bindMcpInput(balance.command, { profile: local.profile, chain: String(chain) }), cliBalance);
    assert.deepEqual(cliBalance.request, { command: "gasless.balance", profile: local.profile, chainId: chain });

    const input = { profile: local.profile, chain: String(chain), to: MM_TEST_RECIPIENT, amount: "10",
      max_fee: "0.05", min_received: "9.95", idempotency_key: `mm-only-chain-${chain}` };
    const argv = ["gasless", "transfer", "prepare", "--profile", input.profile, "--chain", input.chain,
      "--to", input.to, "--amount", input.amount, "--max-fee", input.max_fee,
      "--min-received", input.min_received, "--idempotency-key", input.idempotency_key];
    assert.deepEqual(bindMcpInput(prepare.command, input), parseArgv(argv));

    const before = [...local.rpc.calls];
    const deniedBalance = await local.core.execute(cliBalance.request);
    assert.equal(deniedBalance.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    const deniedPrepare = await local.core.execute(parseArgv(argv).request);
    assert.equal(deniedPrepare.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    assert.deepEqual(local.rpc.calls, before);
  }
});

test("MCP gasless approval returns the exact foreground handoff before state, Keychain, provider, approval, or RPC access", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const effects = forbiddenDependencies();
  const wrapping = new ThrowingWrappingSecret();
  const connection = await connectMcp({ stateRoot: temporary.root, wrappingSecret: wrapping,
    gasless: effects.local, metaMaskGasless: effects.metamask });
  t.after(connection.close);

  const envelope = decode(await connection.client.callTool({
    name: "apn_gasless_transfer_approve",
    arguments: { operation: OPERATION_ID },
  }));
  const handoff = `apn gasless transfer approve --operation ${OPERATION_ID}`;
  assert.equal(envelope.command, "gasless.transfer.approve");
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.deepEqual(envelope.error?.details, {
    cli_handoff: handoff,
    cli_handoff_argv: ["apn", "gasless", "transfer", "approve", "--operation", OPERATION_ID],
    foreground_auth: true,
  });
  assert.deepEqual(envelope.next_actions, [handoff]);
  assert.deepEqual(effects.calls, { localRpc: 0, localCustody: 0, localApproval: 0,
    metamaskRpc: 0, metamaskProvider: 0, metamaskApproval: 0 });
  assert.deepEqual({ loads: wrapping.loads, creates: wrapping.creates }, { loads: 0, creates: 0 });
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
});

test("generic MCP transfer approval redirects a stored MetaMask operation without provider, approval, or RPC effects", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const fixture = await mmFixture(temporary.root, 143);
  const { id } = await fixture.prepare("mm-generic-handoff-0001");
  const calls = effectSnapshot(fixture);
  const connection = await connectMcp({ stateRoot: temporary.root, metaMaskGasless: fixture.dependencies,
    clock: fixture.clock });
  t.after(connection.close);

  const envelope = decode(await connection.client.callTool({
    name: "apn_pay_transfer_approve",
    arguments: { operation: id, rpc_url: "https://rpc.example" },
  }));
  assert.equal(envelope.command, "transfer.approve");
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.deepEqual(envelope.error?.details, {
    reason: "mm_gasless_approval",
    nextActions: [`apn gasless transfer approve --operation ${id}`],
  });
  assert.deepEqual(envelope.next_actions, [`apn gasless transfer approve --operation ${id}`]);
  assert.deepEqual(effectSnapshot(fixture), calls);
});

test("MetaMask prepare replay, status, and receipt have exact public CLI and MCP parity", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const fixture = await mmFixture(temporary.root, 59144);
  const options = { stateRoot: temporary.root, metaMaskGasless: fixture.dependencies, clock: fixture.clock };
  const connection = await connectMcp(options);
  t.after(connection.close);
  const input = { profile: fixture.profile, chain: "59144", to: MM_TEST_RECIPIENT, amount: "10",
    max_fee: "0.05", min_received: "9.95", idempotency_key: "mm-public-parity-0001" };

  const prepared = decode(await connection.client.callTool({ name: "apn_gasless_transfer_prepare", arguments: input }));
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = (prepared.operation as { operation_id: string }).operation_id;
  const prepareCalls = effectSnapshot(fixture);
  const replay = await runCli(["gasless", "transfer", "prepare", "--profile", input.profile,
    "--chain", input.chain, "--to", input.to, "--amount", input.amount, "--max-fee", input.max_fee,
    "--min-received", input.min_received, "--idempotency-key", input.idempotency_key], {}, options);
  assert.equal(replay.ok, true, JSON.stringify(replay.error));
  assert.deepEqual(replay.operation, prepared.operation);
  assert.deepEqual(effectSnapshot(fixture), prepareCalls);

  const completed = await fixture.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(completed.ok, true, JSON.stringify(completed.error));
  assert.equal((completed.operation as { state: string }).state, "completed");
  const completedCalls = effectSnapshot(fixture);
  const cliStatus = await runCli(["operation", "status", "--operation", id], {}, options);
  const mcpStatus = decode(await connection.client.callTool({ name: "apn_operation_status", arguments: { operation: id } }));
  assert.equal(cliStatus.ok, true, JSON.stringify(cliStatus.error));
  assert.equal(mcpStatus.ok, true, JSON.stringify(mcpStatus.error));
  assert.deepEqual(mcpStatus.operation, cliStatus.operation);

  const cliReceipt = await runCli(["receipt", "get", "--operation", id], {}, options);
  const mcpReceipt = decode(await connection.client.callTool({ name: "apn_receipt_get", arguments: { operation: id } }));
  assert.equal(cliReceipt.ok, true, JSON.stringify(cliReceipt.error));
  assert.equal(mcpReceipt.ok, true, JSON.stringify(mcpReceipt.error));
  assert.deepEqual(mcpReceipt.receipt, cliReceipt.receipt);
  assert.deepEqual(effectSnapshot(fixture), completedCalls);
  const publicJson = JSON.stringify([replay.operation, cliStatus.operation, cliReceipt.receipt]);
  for (const forbidden of ["private_rpc_canary", "private_identity_canary", "unsignedDelegation", "requestId"]) {
    assert.equal(publicJson.includes(forbidden), false, forbidden);
  }
});

function requiredCommand(commands: readonly (typeof COMMANDS)[number][], path: string) {
  const command = commands.find(candidate => candidate.path.join(" ") === path);
  assert.ok(command, `missing ${path}`);
  return command;
}

function requiredTool(tools: readonly ProjectedMcpTool[], name: string): ProjectedMcpTool {
  const tool = tools.find(candidate => candidate.name === name);
  assert.ok(tool, `missing ${name}`);
  return tool;
}

function forbiddenDependencies(): {
  calls: { localRpc: number; localCustody: number; localApproval: number;
    metamaskRpc: number; metamaskProvider: number; metamaskApproval: number };
  local: GaslessDependencies;
  metamask: MetaMaskGaslessDependencies;
} {
  const calls = { localRpc: 0, localCustody: 0, localApproval: 0,
    metamaskRpc: 0, metamaskProvider: 0, metamaskApproval: 0 };
  const local: GaslessDependencies = {
    rpcFor: () => { calls.localRpc++; throw new Error("unexpected local RPC access"); },
    custody: {
      load: async () => { calls.localCustody++; throw new Error("unexpected local custody load"); },
      seal: async () => { calls.localCustody++; throw new Error("unexpected local custody seal"); },
    },
    approval: { confirm: async () => { calls.localApproval++; return true; } },
  };
  const metamask: MetaMaskGaslessDependencies = {
    rpcFor: () => { calls.metamaskRpc++; throw new Error("unexpected MetaMask RPC access"); },
    provider: {
      inspect: async () => { calls.metamaskProvider++; throw new Error("unexpected provider inspect"); },
      quote: async () => { calls.metamaskProvider++; throw new Error("unexpected provider quote"); },
      buildUnsigned: async () => { calls.metamaskProvider++; throw new Error("unexpected provider unsigned build"); },
      submit: async () => { calls.metamaskProvider++; throw new Error("unexpected provider submit"); },
      observe: async () => { calls.metamaskProvider++; throw new Error("unexpected provider observation"); },
    },
    approval: { confirm: async () => { calls.metamaskApproval++; return true; } },
  };
  return { calls, local, metamask };
}

class ThrowingWrappingSecret implements WrappingSecretPort {
  loads = 0;
  creates = 0;
  async load(): Promise<Buffer> { this.loads++; throw new Error("unexpected wrapping load"); }
  async create(): Promise<Buffer> { this.creates++; throw new Error("unexpected wrapping create"); }
}

function effectSnapshot(fixture: Awaited<ReturnType<typeof mmFixture>>) {
  return { provider: [...fixture.provider.calls], rpc: [...fixture.rpc.calls], approvals: fixture.approval.calls.length,
    submissions: fixture.provider.submissions.length };
}

async function connectMcp(options: McpRuntimeOptions) {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-metamask-gasless-surface-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function decode(result: Awaited<ReturnType<Client["callTool"]>>): OutputEnvelope {
  assert.equal(result.content.length, 1);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  if (content?.type !== "text") throw new Error("expected one text MCP result");
  const parsed = JSON.parse(content.text) as OutputEnvelope;
  assert.deepEqual(result.structuredContent, parsed);
  assert.equal(result.isError, !parsed.ok);
  return parsed;
}
