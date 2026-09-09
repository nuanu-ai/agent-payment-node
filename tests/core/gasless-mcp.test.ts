import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { formatUnits } from "viem";
import { bindMcpInput } from "../../src/command-binder.js";
import { parseArgv, runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { ApnError } from "../../src/errors.js";
import { publicGaslessOperation } from "../../src/gasless/receipt.js";
import type { GaslessCustodyPort } from "../../src/gasless/ports.js";
import type { GaslessDependencies } from "../../src/gasless/service.js";
import { TtyGaslessApproval } from "../../src/gasless/tty.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { projectMcpTools, type ProjectedMcpTool } from "../../src/mcp-projection.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { GASLESS_TEST_RECIPIENT, gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

const GASLESS_TOOL_NAMES = [
  "apn_gasless_capabilities",
  "apn_gasless_balance",
  "apn_gasless_transfer_prepare",
  "apn_gasless_transfer_approve",
] as const;
const OPERATION_ID = "a".repeat(64);

test("gasless CLI and MCP project the same four strict tools and canonical inputs", () => {
  const tools = projectMcpTools().filter((item) => item.name.startsWith("apn_gasless_"));
  assert.deepEqual(tools.map((item) => item.name), GASLESS_TOOL_NAMES);
  assert.deepEqual(tools.map((item) => ({
    name: item.name,
    properties: Object.keys(item.inputSchema.properties),
    required: item.inputSchema.required,
    additionalProperties: item.inputSchema.additionalProperties,
  })), [
    { name: "apn_gasless_capabilities", properties: ["profile"], required: [], additionalProperties: false },
    { name: "apn_gasless_balance", properties: ["profile", "chain"], required: ["profile", "chain"], additionalProperties: false },
    { name: "apn_gasless_transfer_prepare", properties: ["profile", "chain", "to", "amount", "max_fee", "min_received", "idempotency_key"],
      required: ["profile", "chain", "to", "amount", "max_fee", "min_received", "idempotency_key"], additionalProperties: false },
    { name: "apn_gasless_transfer_approve", properties: ["operation"], required: ["operation"], additionalProperties: false },
  ]);
  assert.match(requiredTool(tools, "apn_gasless_transfer_approve").description, /MCP always returns a CLI handoff/u);

  const input = prepareInput({ max_fee: "0", min_received: "10" });
  const cli = parseArgv(prepareArgv(input));
  const mcp = bindMcpInput(requiredTool(tools, "apn_gasless_transfer_prepare").command, input);
  assert.deepEqual(mcp, cli);
  assert.deepEqual((cli.request as { request: unknown }).request, {
    chainId: 8453,
    recipient: GASLESS_TEST_RECIPIENT,
    grossAtomic: "10000000",
    maxFeeAtomic: "0",
    minReceivedAtomic: "10000000",
  });

  const balance = requiredTool(tools, "apn_gasless_balance");
  for (const chain of ["1", "10", "130", "137", "8453", "42161", "43114"]) {
    assert.deepEqual(
      bindMcpInput(balance.command, { profile: "gasless-local", chain }),
      parseArgv(["gasless", "balance", "--profile", "gasless-local", "--chain", chain]),
    );
  }
  for (const chain of ["0", "01", "56", "8453.0", "eip155:8453"]) {
    invalid(() => parseArgv(["gasless", "balance", "--profile", "gasless-local", "--chain", chain]));
    invalid(() => bindMcpInput(balance.command, { profile: "gasless-local", chain }));
  }
  invalid(() => bindMcpInput(balance.command, { profile: "gasless-local", chain: 8453 }));

  const prepare = requiredTool(tools, "apn_gasless_transfer_prepare");
  for (const override of [
    { amount: "0" }, { amount: "01" }, { amount: "1.0000000" }, { amount: "1e0" },
    { max_fee: "-1" }, { max_fee: "0.0000001" }, { min_received: "0" },
  ]) {
    const candidate = prepareInput(override);
    invalid(() => parseArgv(prepareArgv(candidate)));
    invalid(() => bindMcpInput(prepare.command, candidate));
  }
  for (const [flag, field, value] of [
    ["--asset", "asset", "native"],
    ["--native", "native", "true"],
    ["--rpc-url", "rpc_url", "https://rpc.example"],
    ["--unknown", "unknown", "value"],
  ] as const) {
    invalid(() => parseArgv([...prepareArgv(prepareInput()), flag, value]));
    invalid(() => bindMcpInput(prepare.command, { ...prepareInput(), [field]: value }));
  }
});

test("live MCP gasless approval returns only the exact foreground CLI handoff", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const effects = effectCounters();
  const wrapping = new ThrowingWrappingSecret();
  const connection = await connectMcp({ stateRoot: temporary.root, wrappingSecret: wrapping, gasless: effects.dependencies });
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
  assert.deepEqual(effects.calls, { rpc: 0, load: 0, seal: 0, approval: 0 });
  assert.deepEqual({ loads: wrapping.loads, creates: wrapping.creates }, { loads: 0, creates: 0 });
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
});

test("gasless capabilities are identical static CLI and MCP discovery with no local or network access", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const effects = effectCounters();
  const wrapping = new ThrowingWrappingSecret();
  const options = { stateRoot: temporary.root, wrappingSecret: wrapping, gasless: effects.dependencies };
  const cli = await runCli(["gasless", "capabilities", "--profile", "gasless-local"], {}, options);
  const connection = await connectMcp(options);
  t.after(connection.close);
  const mcp = decode(await connection.client.callTool({
    name: "apn_gasless_capabilities",
    arguments: { profile: "gasless-local" },
  }));
  assert.equal(cli.ok, true);
  assert.equal(mcp.ok, true);
  assert.equal(cli.proof_class, "static_gasless_capabilities");
  assert.deepEqual(mcp.data, cli.data);
  const data = cli.data as {
    profile_binding_inspected: boolean;
    networks: Array<{ chain_id: number; executable_adapter: boolean; mainnet_acceptance: string }>;
    profiles: Array<{ provider: string; adapter: string; mainnet_acceptance: string }>;
    semantics: { sender_native_gas_required: boolean; automatic_native_fallback: boolean };
  };
  assert.equal(data.profile_binding_inspected, false);
  assert.deepEqual(data.networks.map((row) => row.chain_id), [1, 10, 130, 137, 8453, 42161, 43114]);
  assert.equal(data.networks.every((row) => row.executable_adapter && row.mainnet_acceptance === "open"), true);
  assert.deepEqual(data.profiles.map((profile) => [profile.provider, profile.adapter, profile.mainnet_acceptance]), [
    ["local", "implemented", "open"],
    ["metamask-agent-wallet", "unavailable", "open"],
    ["metamask-smart-account", "unavailable", "open"],
    ["coinbase-agentic-wallet", "unavailable", "open"],
  ]);
  assert.deepEqual(data.semantics, { ...data.semantics, sender_native_gas_required: false, automatic_native_fallback: false });
  assert.deepEqual(effects.calls, { rpc: 0, load: 0, seal: 0, approval: 0 });
  assert.deepEqual({ loads: wrapping.loads, creates: wrapping.creates }, { loads: 0, creates: 0 });
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
});

test("gasless terminal approval renders exact USDC authority and rejects any inexact phrase", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const fixture = await gaslessFixture(temporary.root, 8453, { now: new Date() });
  const prepared = await fixture.prepare("gasless-tty-0001");
  const summary = publicGaslessOperation(prepared.operation);
  const phrase = `APPROVE GASLESS ${prepared.operation.fingerprint}`;
  const acceptedTerminal = terminal(`${phrase}\n`);
  const approval = new TtyGaslessApproval({ isTerminal: () => true, openTerminal: async () => acceptedTerminal.port });
  assert.equal(await approval.confirm({ operationId: prepared.id, fingerprint: prepared.operation.fingerprint,
    exactPhrase: phrase, summary }), true);
  const shown = acceptedTerminal.output();
  assert.match(shown, new RegExp(`Total budget: ${escape(formatUnits(BigInt(summary.transfer.gross_atomic), 6))} USDC`, "u"));
  assert.match(shown, new RegExp(`Recipient receives: ${escape(formatUnits(BigInt(summary.transfer.recipient_atomic), 6))} USDC`, "u"));
  assert.match(shown, new RegExp(`Frozen maximum fee: ${escape(formatUnits(BigInt(summary.transfer.quoted_fee_budget_atomic), 6))} USDC`, "u"));
  assert.match(shown, /The sender pays no native gas\./u);
  assert.match(shown, /Persistent account delegation: .*; current state: empty/u);
  assert.match(shown, /Paymaster permission: .* up to .* USDC/u);
  assert.match(shown, /The signed permit and operation have no on-chain expiry\. Delegation persists after this payment\./u);
  assert.match(shown, new RegExp(`Type exactly: ${phrase}`, "u"));
  assert.equal(acceptedTerminal.closes(), 1);

  const refusedTerminal = terminal(`${phrase} \n`);
  const refused = new TtyGaslessApproval({ isTerminal: () => true, openTerminal: async () => refusedTerminal.port });
  assert.equal(await refused.confirm({ operationId: prepared.id, fingerprint: prepared.operation.fingerprint,
    exactPhrase: phrase, summary }), false);
  assert.equal(refusedTerminal.closes(), 1);
});

test("CLI and MCP reject waitSeconds for a stored gasless operation before any effect", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const custodyCalls: string[] = [];
  const custody: GaslessCustodyPort = {
    load: async () => { custodyCalls.push("load"); throw new Error("unexpected custody load"); },
    seal: async () => { custodyCalls.push("seal"); throw new Error("unexpected custody seal"); },
  };
  const now = new Date();
  const fixture = await gaslessFixture(temporary.root, 8453, { now, custody });
  const prepared = await fixture.prepare("gasless-resume-wait-0001");
  fixture.rpc.calls.length = 0;
  const options = { stateRoot: temporary.root, wrappingSecret: fixture.wrapping,
    gasless: fixture.dependencies, clock: { now: () => new Date(now) } };
  const cli = await runCli(["operation", "resume", "--operation", prepared.id, "--wait-seconds", "1"], {}, options);
  assert.equal(cli.ok, false);
  assert.equal(cli.error?.code, "APN_INVALID_INPUT");
  const connection = await connectMcp(options);
  t.after(connection.close);
  const mcp = decode(await connection.client.callTool({ name: "apn_operation_resume",
    arguments: { operation: prepared.id, wait_seconds: "1" } }));
  assert.equal(mcp.ok, false);
  assert.equal(mcp.error?.code, "APN_INVALID_INPUT");
  assert.deepEqual(fixture.rpc.calls, []);
  assert.deepEqual(custodyCalls, []);
});

function prepareInput(overrides: Readonly<Record<string, unknown>> = {}) {
  return { profile: "gasless-local", chain: "8453", to: GASLESS_TEST_RECIPIENT, amount: "10",
    max_fee: "0.2", min_received: "9.8", idempotency_key: "gasless-mcp-0001", ...overrides };
}

function prepareArgv(input: ReturnType<typeof prepareInput>): string[] {
  return ["gasless", "transfer", "prepare", "--profile", String(input.profile), "--chain", String(input.chain),
    "--to", String(input.to), "--amount", String(input.amount), "--max-fee", String(input.max_fee),
    "--min-received", String(input.min_received), "--idempotency-key", String(input.idempotency_key)];
}

function requiredTool(tools: readonly ProjectedMcpTool[], name: string): ProjectedMcpTool {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `missing ${name}`);
  return tool;
}

function invalid(action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.equal((error as ApnError).code, "APN_INVALID_INPUT");
    return true;
  });
}

function effectCounters(): { calls: { rpc: number; load: number; seal: number; approval: number }; dependencies: GaslessDependencies } {
  const calls = { rpc: 0, load: 0, seal: 0, approval: 0 };
  return { calls, dependencies: {
    rpcFor: () => { calls.rpc++; throw new Error("unexpected network access"); },
    custody: {
      load: async () => { calls.load++; throw new Error("unexpected effect load"); },
      seal: async () => { calls.seal++; throw new Error("unexpected effect seal"); },
    },
    approval: { confirm: async () => { calls.approval++; return true; } },
  } };
}

class ThrowingWrappingSecret implements WrappingSecretPort {
  loads = 0;
  creates = 0;
  async load(): Promise<Buffer> { this.loads++; throw new Error("unexpected wrapping load"); }
  async create(): Promise<Buffer> { this.creates++; throw new Error("unexpected wrapping create"); }
}

function terminal(input: string) {
  let output = "", closes = 0;
  return {
    port: { fd: 42,
      write: async (value: string) => { output += value; },
      read: async function* () { yield Buffer.from(input, "ascii"); },
      close: async () => { closes++; } },
    output: () => output,
    closes: () => closes,
  };
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function connectMcp(options: McpRuntimeOptions) {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-gasless-mcp-test", version: "1.0.0" });
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
