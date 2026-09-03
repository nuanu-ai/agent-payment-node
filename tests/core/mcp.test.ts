import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { COMMAND_MANIFEST, type CommandDefinition, type CommandOption } from "../../src/command-catalog.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { runCli } from "../../src/cli.js";
import { PRODUCT_VERSION } from "../../src/constants.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { MCP_LAUNCH_DESCRIPTOR_JSON } from "../../src/mcp-config.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import type { NativePort, NativeRequest } from "../../src/ports.js";
import type { ProfilePolicyApprovalIntent, ProfilePolicyApprovalPort } from "../../src/policy-approval.js";
import { RECIPIENT, TestNative, TestRpc, exactReceipt, temporaryState } from "./helpers.js";

const TOOL_NAMES = [
  "apn_version",
  "apn_doctor_keychain",
  "apn_wallet_ensure",
  "apn_wallet_connect",
  "apn_wallet_permission_list",
  "apn_wallet_permission_sync",
  "apn_wallet_permission_disable",
  "apn_wallet_permission_forget",
  "apn_wallet_status",
  "apn_wallet_balance",
  "apn_wallet_policy_show",
  "apn_wallet_policy_set",
  "apn_x402_inspect",
  "apn_x402_fetch_prepare",
  "apn_x402_fetch_approve",
  "apn_pay_transfer_prepare",
  "apn_pay_transfer_approve",
  "apn_operation_status",
  "apn_operation_resume",
  "apn_operation_recover_provider_request",
  "apn_operation_recover_transaction_settlement",
  "apn_receipt_get",
] as const;
const MASTER = Buffer.from("55".repeat(32), "hex");

class TestWrappingSecret implements WrappingSecretPort {
  async load(): Promise<Buffer> { return Buffer.from(MASTER); }
  async create(): Promise<Buffer> { return Buffer.from(MASTER); }
}

class RecordingPolicyApproval implements ProfilePolicyApprovalPort {
  readonly intents: ProfilePolicyApprovalIntent[] = [];
  async approve(intent: ProfilePolicyApprovalIntent): Promise<void> { this.intents.push(intent); }
}

test("official MCP client proves production stdio descriptor, twenty-two tools, application failures and clean close", async () => {
  const executable = process.env.APN_INSTALLED_BIN ?? resolve("bin/apn.js");
  const config = spawnSync(executable, ["mcp", "config"], { cwd: resolve("."), encoding: "utf8" });
  assert.equal(config.status, 0, config.stderr);
  assert.equal(config.stdout, `${MCP_LAUNCH_DESCRIPTOR_JSON}\n`);
  assert.equal(config.stderr, "");

  const transport = new StdioClientTransport({
    command: executable,
    args: ["mcp", "serve"],
    cwd: resolve("."),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });
  const client = new Client({ name: "apn-mcp-official-client-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.deepEqual(client.getServerVersion(), { name: "agent-payment-node", version: PRODUCT_VERSION });
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), TOOL_NAMES);
    assert.deepEqual(
      listed.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      projectMcpTools().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    );
    assert.deepEqual(listed.tools.map((tool) => {
      const properties = tool.inputSchema.properties as Record<string, { default?: unknown }>;
      return {
        name: tool.name,
        properties: Object.keys(properties),
        required: tool.inputSchema.required ?? [],
        defaults: Object.fromEntries(Object.entries(properties)
          .filter(([, schema]) => schema.default !== undefined)
          .map(([field, schema]) => [field, schema.default])),
      };
    }), [
      { name: "apn_version", properties: [], required: [], defaults: {} },
      { name: "apn_doctor_keychain", properties: [], required: [], defaults: {} },
      { name: "apn_wallet_ensure", properties: ["profile"], required: [], defaults: { profile: "default" } },
      {
        name: "apn_wallet_connect",
        properties: ["profile", "provider", "auth_method", "expected_revision", "permission_cap_usdc_atomic", "permission_expires_at", "idempotency_key"],
        required: ["profile", "provider"],
        defaults: {},
      },
      { name: "apn_wallet_permission_list", properties: ["profile"], required: ["profile"], defaults: {} },
      { name: "apn_wallet_permission_sync", properties: ["profile", "expected_revision"], required: ["profile", "expected_revision"], defaults: {} },
      { name: "apn_wallet_permission_disable", properties: ["profile", "expected_revision"], required: ["profile", "expected_revision"], defaults: {} },
      { name: "apn_wallet_permission_forget", properties: ["profile", "expected_revision"], required: ["profile", "expected_revision"], defaults: {} },
      { name: "apn_wallet_status", properties: ["profile"], required: [], defaults: { profile: "default" } },
      { name: "apn_wallet_balance", properties: ["profile", "rpc_url"], required: ["rpc_url"], defaults: { profile: "default" } },
      { name: "apn_wallet_policy_show", properties: ["profile"], required: ["profile"], defaults: {} },
      {
        name: "apn_wallet_policy_set",
        properties: ["profile", "max_balance_usdc_atomic", "max_x402_amount_atomic", "max_balance_eth_wei"],
        required: ["profile", "max_balance_usdc_atomic", "max_x402_amount_atomic"],
        defaults: {},
      },
      { name: "apn_x402_inspect", properties: ["url"], required: ["url"], defaults: {} },
      { name: "apn_x402_fetch_prepare", properties: ["profile", "url", "idempotency_key", "rpc_url", "max_amount_atomic"], required: ["profile", "url", "idempotency_key", "rpc_url"], defaults: {} },
      { name: "apn_x402_fetch_approve", properties: ["operation", "rpc_url"], required: ["operation", "rpc_url"], defaults: {} },
      { name: "apn_pay_transfer_prepare", properties: ["profile", "idempotency_key", "to", "amount_usdc", "rpc_url"], required: ["profile", "idempotency_key", "to", "amount_usdc", "rpc_url"], defaults: {} },
      { name: "apn_pay_transfer_approve", properties: ["operation", "rpc_url"], required: ["operation", "rpc_url"], defaults: {} },
      { name: "apn_operation_status", properties: ["operation"], required: ["operation"], defaults: {} },
      { name: "apn_operation_resume", properties: ["operation", "rpc_url", "wait_seconds"], required: ["operation", "rpc_url"], defaults: {} },
      {
        name: "apn_operation_recover_provider_request",
        properties: ["operation", "provider_request_id"],
        required: ["operation", "provider_request_id"],
        defaults: {},
      },
      {
        name: "apn_operation_recover_transaction_settlement",
        properties: ["operation", "transaction_hash", "idempotency_key", "rpc_url"],
        required: ["operation", "transaction_hash", "idempotency_key", "rpc_url"],
        defaults: {},
      },
      { name: "apn_receipt_get", properties: ["operation"], required: ["operation"], defaults: {} },
    ]);
    const listedBytes = JSON.stringify(listed);
    assert.equal(listedBytes.includes(MASTER.toString("hex")), false);
    assert.doesNotMatch(listedBytes, /private[_ -]?key|mnemonic|approval[_ -]?phrase|fingerprint|raw[_ -]?signed/iu);

    const version = decodeResult(await client.callTool({ name: "apn_version", arguments: {} }));
    assert.equal(version.ok, true);
    assert.equal((version.data as { product_version: string }).product_version, PRODUCT_VERSION);

    for (const [name, args] of [
      ["apn_wallet_status", { unknown: "value" }],
      ["apn_wallet_balance", {}],
      ["apn_wallet_status", { profile: 17 }],
      ["apn_x402_inspect", { url: "http://seller.example" }],
      ["apn_x402_fetch_prepare", { profile: "default" }],
      ["apn_x402_fetch_approve", { operation: "A".repeat(64), rpc_url: "https://rpc.example" }],
      ["apn_pay_transfer_prepare", { profile: "default", idempotency_key: "payment-001", to: "not-an-address", amount_usdc: "1.0", rpc_url: "https://rpc.example" }],
      ["apn_operation_resume", { operation: "a".repeat(64), rpc_url: "https://rpc.example", wait_seconds: 1 }],
      ["apn_operation_recover_provider_request", { operation: "a".repeat(64), provider_request_id: "bad request id" }],
      ["apn_operation_recover_transaction_settlement", {
        operation: "a".repeat(64), transaction_hash: "invalid", idempotency_key: "recovery-001", rpc_url: "https://rpc.example",
      }],
      ["apn_receipt_get", { operation: "a".repeat(64), extra: "rejected" }],
      ["apn_wallet_policy_set", {
        profile: "default",
        max_balance_usdc_atomic: "100",
        max_x402_amount_atomic: "101",
      }],
    ] as const) {
      const failure = decodeResult(await client.callTool({ name, arguments: args }));
      assert.equal(failure.ok, false, name);
      assert.equal(failure.error?.code, "APN_INVALID_INPUT", name);
    }
    await assert.rejects(client.callTool({ name: "apn_payment_authorize", arguments: {} }));
  } finally {
    await client.close();
  }
  assert.equal(transport.pid, null, "the production stdio child must be reaped on close");
  assert.equal(stderr, "", "stdio server diagnostics must stay quiet on a clean session");
});

test("manifest projection is exact, strict and rejects missing, colliding or unsupported selected metadata", () => {
  const projected = projectMcpTools();
  assert.deepEqual(projected.map((tool) => tool.name), TOOL_NAMES);
  assert.equal(projected.every((tool) => tool.inputSchema.type === "object"), true);
  assert.equal(projected.every((tool) => tool.inputSchema.additionalProperties === false), true);
  assert.equal(projected.every((tool) => Object.values(tool.inputSchema.properties).every((schema) => (
    typeof schema === "object" && schema !== null && !Array.isArray(schema) && schema.type === "string"
  ))), true);
  assert.equal(projected.some((tool) => tool.name.includes("mcp")), false);
  assert.equal(projected.some((tool) => tool.name.includes("mcp") || tool.name.includes("control")), false);

  const absent = cloneManifest();
  absent.commands = absent.commands.filter((command) => command.path.join(" ") !== "wallet status");
  assert.throws(() => projectMcpTools(absent));

  const collision = cloneManifest();
  const balance = collision.commands.find((command) => command.path.join(" ") === "wallet balance")!;
  balance.options.push({
    name: "--rpc_url",
    type: "https_url",
    required: false,
    default: { kind: "none" },
    constraints: ["absolute_canonical_https_url"],
    sensitivity: "operator_input",
  });
  assert.throws(() => projectMcpTools(collision));

  const unsupported = cloneManifest();
  const status = unsupported.commands.find((command) => command.path.join(" ") === "wallet status")!;
  status.options[0]!.type = "string";
  assert.throws(() => projectMcpTools(unsupported));
});

test("MCP runtime preserves wallet lifecycle, reads, balance and one core execution per valid call", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrappingSecret = new TestWrappingSecret();
  const native = new TestNative();
  const rpc = new TestRpc();
  let ids = 0;
  const connection = await connectMcp({
    stateRoot: temporary.root,
    wrappingSecret,
    native,
    rpc,
    ids: { next: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}` },
  });
  t.after(connection.close);

  await assert.rejects(access(temporary.root), isMissing);
  const absent = decodeResult(await connection.client.callTool({
    name: "apn_wallet_status",
    arguments: { profile: "absent" },
  }));
  assert.equal((absent.data as { status: string }).status, "absent");
  assert.equal(ids, 1);
  await assert.rejects(access(temporary.root), isMissing);
  const doctor = decodeResult(await connection.client.callTool({ name: "apn_doctor_keychain", arguments: {} }));
  assert.equal((doctor.data as { status: string }).status, "absent");
  assert.equal(ids, 2);
  await assert.rejects(access(temporary.root), isMissing);

  const ensured = decodeResult(await connection.client.callTool({ name: "apn_wallet_ensure", arguments: {} }));
  const address = (ensured.data as { address: string }).address;
  assert.equal(ensured.command, "wallet.ensure");
  assert.equal(ids, 4, "one envelope id and one native-channel id are allocated by ensure");
  const reused = decodeResult(await connection.client.callTool({ name: "apn_wallet_ensure", arguments: {} }));
  assert.equal((reused.data as { address: string }).address, address);
  assert.equal(ids, 6, "reused ensure keeps the same one-core plus one-native allocation");

  const balance = decodeResult(await connection.client.callTool({
    name: "apn_wallet_balance",
    arguments: { rpc_url: "https://rpc.example" },
  }));
  assert.equal(balance.ok, true);
  assert.equal((balance.data as { funding_address: string }).funding_address, address);
  const cliBalance = await runCli([
    "wallet", "balance", "--rpc-url", "https://rpc.example",
  ], {}, { stateRoot: temporary.root, wrappingSecret, native, rpc });
  assert.deepEqual(cliBalance.data, balance.data);
  assert.equal(rpc.balanceCalls, 2);
  assert.equal(ids, 7);
  const policy = decodeResult(await connection.client.callTool({
    name: "apn_wallet_policy_show",
    arguments: { profile: "default" },
  }));
  assert.equal((policy.data as { configured: boolean }).configured, false);
  const cliPolicy = await runCli([
    "wallet", "policy", "show", "--profile", "default",
  ], {}, { stateRoot: temporary.root, wrappingSecret, native });
  assert.deepEqual(cliPolicy.data, policy.data);
  assert.equal(ids, 8);

  await connection.close();
  const restarted = await connectMcp({ stateRoot: temporary.root, wrappingSecret, native });
  try {
    const status = decodeResult(await restarted.client.callTool({ name: "apn_wallet_status", arguments: {} }));
    assert.equal((status.data as { address: string }).address, address);
    const cli = await runCli(["wallet", "status"], {}, { stateRoot: temporary.root, wrappingSecret, native });
    assert.equal((cli.data as { address: string }).address, address);
  } finally {
    await restarted.close();
  }
});

test("direct MCP approval returns the exact foreground handoff before custody and ignores hostile native injection", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const rpc = new TestRpc();
  const setupNative = new TestNative();
  assert.equal((await runCli(["wallet", "ensure"], {}, {
    stateRoot: temporary.root, native: setupNative,
  })).ok, true);
  let hostileNativeCalls = 0;
  let hostileApprovalCalls = 0;
  let wrappingLoads = 0;
  let wrappingCreates = 0;
  const connection = await connectMcp({
    stateRoot: temporary.root,
    rpc,
    native: { request: async () => { hostileNativeCalls += 1; throw new Error("HOSTILE_NATIVE_CANARY"); } },
    approval: { approve: async () => { hostileApprovalCalls += 1; throw new Error("HOSTILE_TTY_CANARY"); } },
    wrappingSecret: {
      load: async () => { wrappingLoads += 1; throw new Error("KEYCHAIN_LOAD_CANARY"); },
      create: async () => { wrappingCreates += 1; throw new Error("KEYCHAIN_CREATE_CANARY"); },
    },
  });
  t.after(connection.close);
  const prepared = decodeResult(await connection.client.callTool({
    name: "apn_pay_transfer_prepare",
    arguments: {
      profile: "default", idempotency_key: "mcp-direct-001", to: RECIPIENT,
      amount_usdc: "1.25", rpc_url: "https://rpc.example/",
    },
  }));
  const operation = prepared.operation as {
    readonly operation_id?: unknown; readonly state?: unknown; readonly fingerprint?: unknown;
  };
  assert.equal(operation.state, "awaiting_approval");
  assert.equal(typeof operation.operation_id, "string");
  assert.equal(operation.fingerprint, undefined);
  const operationId = operation.operation_id as string;
  assert.equal(hostileNativeCalls, 0);
  assert.equal(hostileApprovalCalls, 0);
  assert.equal(wrappingLoads, 0);
  assert.equal(wrappingCreates, 0);
  assert.equal(rpc.submissions.length, 0);

  const handoff = `apn pay transfer approve --operation ${operationId} --rpc-url https://rpc.example/`;
  const rejected = decodeResult(await connection.client.callTool({
    name: "apn_pay_transfer_approve",
    arguments: { operation: operationId, rpc_url: "https://rpc.example/" },
  }));
  assert.equal(rejected.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.deepEqual(rejected.error?.details, {
    approval_boundary: "foreground_tty", operation_id: operationId, profile: "default", cli_handoff: handoff,
  });
  assert.deepEqual(rejected.next_actions, [handoff]);
  assert.equal(hostileNativeCalls, 0);
  assert.equal(hostileApprovalCalls, 0);
  assert.equal(wrappingLoads, 0);
  assert.equal(wrappingCreates, 0);
  assert.equal(rpc.submissions.length, 0);
  assert.doesNotMatch(JSON.stringify(rejected), /fingerprint|phrase|HOSTILE|KEYCHAIN/iu);

  const status = decodeResult(await connection.client.callTool({
    name: "apn_operation_status", arguments: { operation: operationId },
  }));
  assert.equal((status.operation as { readonly state: string }).state, "awaiting_approval");
  assert.equal(JSON.stringify(status).includes("fingerprint"), false);
  rpc.receipt = exactReceipt();
  const completed = await runCli([
    "pay", "transfer", "approve", "--operation", operationId, "--rpc-url", "https://rpc.example/",
  ], {}, { stateRoot: temporary.root, native: new TestNative(), rpc });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  const receipt = decodeResult(await connection.client.callTool({
    name: "apn_receipt_get", arguments: { operation: operationId },
  }));
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal(hostileNativeCalls, 0);
  assert.equal(wrappingLoads, 0);
});

test("MCP policy creation and increases fail closed before write while a pure decrease is allowed", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrappingSecret = new TestWrappingSecret();
  const native = new TestNative();
  const approval = new RecordingPolicyApproval();
  const setup = await runCli(["wallet", "ensure"], {}, { stateRoot: temporary.root, wrappingSecret, native });
  assert.equal(setup.ok, true, JSON.stringify(setup));
  const created = await runCli([
    "wallet", "policy", "set",
    "--profile", "default",
    "--max-balance-usdc-atomic", "100",
    "--max-x402-amount-atomic", "50",
    "--max-balance-eth-wei", "1000",
  ], {}, { stateRoot: temporary.root, wrappingSecret, policyApproval: approval });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(approval.intents.length, 1);
  const policyPath = join(temporary.root, "policies", "default.json");
  const before = await readFile(policyPath);

  const connection = await connectMcp({ stateRoot: temporary.root, wrappingSecret, native });
  t.after(connection.close);
  const shown = decodeResult(await connection.client.callTool({
    name: "apn_wallet_policy_show",
    arguments: { profile: "default" },
  }));
  const cliShown = await runCli([
    "wallet", "policy", "show", "--profile", "default",
  ], {}, { stateRoot: temporary.root, wrappingSecret, native });
  assert.deepEqual(shown.data, cliShown.data);
  for (const [arguments_, handoff] of [
    [{ profile: "default", max_balance_usdc_atomic: "101", max_x402_amount_atomic: "50" },
      "apn wallet policy set --profile default --max-balance-usdc-atomic 101 --max-x402-amount-atomic 50"],
    [{ profile: "default", max_balance_usdc_atomic: "100", max_x402_amount_atomic: "51" },
      "apn wallet policy set --profile default --max-balance-usdc-atomic 100 --max-x402-amount-atomic 51"],
    [{ profile: "default", max_balance_usdc_atomic: "100", max_x402_amount_atomic: "50", max_balance_eth_wei: "1001" },
      "apn wallet policy set --profile default --max-balance-usdc-atomic 100 --max-x402-amount-atomic 50 --max-balance-eth-wei 1001"],
  ] as const) {
    const increased = decodeResult(await connection.client.callTool({
      name: "apn_wallet_policy_set",
      arguments: arguments_,
    }));
    assert.equal(increased.ok, false);
    assert.equal(increased.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal(increased.error?.details?.approval_boundary, "foreground_tty");
    assert.equal(increased.error?.details?.cli_handoff, handoff);
    assert.deepEqual(increased.next_actions, [handoff]);
    assert.deepEqual(await readFile(policyPath), before, "every increase must fail before policy persistence");
  }

  const decreased = decodeResult(await connection.client.callTool({
    name: "apn_wallet_policy_set",
    arguments: {
      profile: "default",
      max_balance_usdc_atomic: "90",
      max_x402_amount_atomic: "40",
    },
  }));
  assert.equal(decreased.ok, true, JSON.stringify(decreased));
  assert.deepEqual((decreased.data as { limits: unknown }).limits, {
    max_balance_usdc_atomic: "90",
    max_x402_amount_atomic: "40",
    max_balance_eth_wei: "1000",
  });
  const fullyDecreased = decodeResult(await connection.client.callTool({
    name: "apn_wallet_policy_set",
    arguments: {
      profile: "default",
      max_balance_usdc_atomic: "80",
      max_x402_amount_atomic: "30",
      max_balance_eth_wei: "900",
    },
  }));
  assert.equal(fullyDecreased.ok, true, JSON.stringify(fullyDecreased));

  const freshWallet = decodeResult(await connection.client.callTool({
    name: "apn_wallet_ensure",
    arguments: { profile: "fresh" },
  }));
  assert.equal(freshWallet.ok, true);
  const createFailure = decodeResult(await connection.client.callTool({
    name: "apn_wallet_policy_set",
    arguments: {
      profile: "fresh",
      max_balance_usdc_atomic: "10",
      max_x402_amount_atomic: "5",
      max_balance_eth_wei: "100",
    },
  }));
  assert.equal(createFailure.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  const createHandoff = "apn wallet policy set --profile fresh --max-balance-usdc-atomic 10 --max-x402-amount-atomic 5 --max-balance-eth-wei 100";
  assert.equal(createFailure.error?.details?.cli_handoff, createHandoff);
  assert.deepEqual(createFailure.next_actions, [createHandoff]);
  await assert.rejects(access(join(temporary.root, "policies", "fresh.json")), isMissing);
});

test("MCP failures classify raw errors without leaking protected material", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const canary = "PRIVATE_SIGNED_PAYMENT_AUTHORIZATION_CANARY";
  const native: NativePort = { request: async (_request: NativeRequest) => { throw new Error(canary); } };
  const connection = await connectMcp({
    stateRoot: temporary.root,
    wrappingSecret: new TestWrappingSecret(),
    native,
  });
  t.after(connection.close);
  const result = await connection.client.callTool({ name: "apn_wallet_ensure", arguments: {} });
  const envelope = decodeResult(result);
  assert.equal(envelope.error?.code, "APN_INTERNAL");
  assert.equal(JSON.stringify(result).includes(canary), false);
  assert.equal(JSON.stringify(result).includes(MASTER.toString("hex")), false);
  assert.deepEqual(await readdir(join(temporary.root, "wallets")), []);
});

test("MCP dependencies are exact and package lockfiles are byte-identical", async () => {
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(packageJson.dependencies["@modelcontextprotocol/server"], "2.0.0");
  assert.equal(packageJson.devDependencies["@modelcontextprotocol/client"], "2.0.0");
  assert.equal(packageJson.dependencies.zod, "4.4.3");
  const packageLock = await readFile(resolve("package-lock.json"));
  const shrinkwrap = await readFile(resolve("npm-shrinkwrap.json"));
  assert.deepEqual(packageLock, shrinkwrap);
  const lock = JSON.parse(packageLock.toString("utf8")) as { packages: Record<string, { version?: string }> };
  assert.equal(lock.packages["node_modules/@modelcontextprotocol/server"]?.version, "2.0.0");
  assert.equal(lock.packages["node_modules/@modelcontextprotocol/client"]?.version, "2.0.0");
  assert.equal(lock.packages["node_modules/zod"]?.version, "4.4.3");
});

async function connectMcp(options: McpRuntimeOptions): Promise<{
  readonly client: Client;
  close(): Promise<void>;
}> {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-mcp-in-memory-test", version: "1.0.0" });
  await client.connect(clientTransport);
  let closed = false;
  return {
    client,
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
      await server.close();
    },
  };
}

function decodeResult(result: Awaited<ReturnType<Client["callTool"]>>): OutputEnvelope {
  assert.equal(result.content.length, 1);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  if (content?.type !== "text") throw new Error("expected one text MCP result");
  const parsed = JSON.parse(content.text) as OutputEnvelope;
  assert.deepEqual(result.structuredContent, parsed);
  assert.equal(result.isError, !parsed.ok);
  assert.equal(parsed.version, "apn.cli.v1");
  return parsed;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function cloneManifest(): {
  commands: Array<CommandDefinition & { path: string[]; options: Array<CommandOption & { type: CommandOption["type"] }> }>;
  [key: string]: unknown;
} {
  return structuredClone(COMMAND_MANIFEST) as never;
}
