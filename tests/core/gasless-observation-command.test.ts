import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bindMcpInput } from "../../src/command-binder.js";
import { parseArgv, runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { gaslessObservationRpcEnv } from "../../src/gasless/observation-source.js";
import type { GaslessDependencies } from "../../src/gasless/service.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { ensureWallet, makeCore, prepareTransfer, temporaryState, TestNative, TestRpc } from "./helpers.js";

const OPERATION_ID = "a".repeat(64);
const OBSERVATION_ENV = "APN_ETHEREUM_ARCHIVE_RPC_URL";
const SECRET_CANARY = "OBSERVATION_RPC_SECRET_CANARY_7d91";

test("operation resume projects one optional observation RPC environment through CLI and MCP", () => {
  const cli = parseArgv([
    "operation", "resume", "--operation", OPERATION_ID,
    "--observation-rpc-env", OBSERVATION_ENV,
  ]);
  const tool = requiredResumeTool();
  const mcp = bindMcpInput(tool.command, {
    operation: OPERATION_ID,
    observation_rpc_env: OBSERVATION_ENV,
  });

  assert.deepEqual(cli, {
    request: {
      command: "operation.resume",
      operationId: OPERATION_ID,
      observationRpcEnv: OBSERVATION_ENV,
    },
  });
  assert.deepEqual(mcp, cli);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.inputSchema.required.includes("observation_rpc_env"), false);
  assert.deepEqual(tool.inputSchema.properties.observation_rpc_env, {
    type: "string",
    description: "Catalog type string; constraints explicit_APN_environment_variable_for_Local_readonly_observation, cannot_combine_with_rpc_url_or_wait_seconds; sensitivity operator_input.",
  });
});

test("observation RPC environment validation is bounded and never reflects rejected input", () => {
  assert.equal(gaslessObservationRpcEnv(OBSERVATION_ENV), OBSERVATION_ENV);
  const rejected: unknown[] = [
    undefined,
    7,
    "",
    "APN_ETHEREUM_ARCHIVE_RPC",
    "apn_ETHEREUM_ARCHIVE_RPC_URL",
    "ETHEREUM_ARCHIVE_RPC_URL",
    `APN_${"A".repeat(117)}_RPC_URL`,
    `https://${SECRET_CANARY}@archive.example/path`,
    `APN_ETHEREUM_${SECRET_CANARY.toLowerCase()}_RPC_URL`,
  ];
  for (const value of rejected) {
    let caught: unknown;
    try { gaslessObservationRpcEnv(value); } catch (error) { caught = error; }
    assert.notEqual(caught, undefined, String(value));
    const serialized = JSON.stringify(caught);
    assert.equal((caught as { code?: unknown }).code, "APN_INVALID_INPUT");
    assert.match((caught as Error).message, /gasless_observation_rpc_env/u);
    assert.equal(serialized.includes(SECRET_CANARY), false);
    if (String(value).length > 0) assert.equal(serialized.includes(String(value)), false);
  }
});

test("CLI and MCP reject invalid or conflicting observation options before runtime effects", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const effects = effectCounters();
  const wrapping = new ThrowingWrappingSecret();
  const options = { stateRoot: temporary.root, wrappingSecret: wrapping, gasless: effects.dependencies };
  const cases = [
    {
      cli: ["--observation-rpc-env", `APN_${SECRET_CANARY}_rpc_url`],
      mcp: { observation_rpc_env: `APN_${SECRET_CANARY}_rpc_url` },
      reason: "gasless_observation_rpc_env",
    },
    {
      cli: ["--observation-rpc-env", OBSERVATION_ENV, "--rpc-url", "https://rpc.example"],
      mcp: { observation_rpc_env: OBSERVATION_ENV, rpc_url: "https://rpc.example" },
      reason: "gasless_observation_rpc_options",
    },
    {
      cli: ["--observation-rpc-env", OBSERVATION_ENV, "--wait-seconds", "1"],
      mcp: { observation_rpc_env: OBSERVATION_ENV, wait_seconds: "1" },
      reason: "gasless_observation_rpc_options",
    },
  ] as const;

  const connection = await connectMcp(options);
  t.after(connection.close);
  for (const row of cases) {
    const cli = await runCli([
      "operation", "resume", "--operation", OPERATION_ID, ...row.cli,
    ], {}, options);
    const mcp = decode(await connection.client.callTool({
      name: "apn_operation_resume",
      arguments: { operation: OPERATION_ID, ...row.mcp },
    }));
    for (const envelope of [cli, mcp]) {
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error?.code, "APN_INVALID_INPUT");
      assert.equal(JSON.stringify(envelope).includes(row.reason), true);
      assert.equal(JSON.stringify(envelope).includes(SECRET_CANARY), false);
    }
  }

  assert.deepEqual(effects.calls, { rpc: 0, observation: 0, load: 0, seal: 0 });
  assert.deepEqual({ loads: wrapping.loads, creates: wrapping.creates }, { loads: 0, creates: 0 });
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
});

test("core rejects observation RPC mode for a non-Local operation before recovery effects", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const native = new TestNative();
  const rpc = new TestRpc();
  const core = makeCore({ root: temporary.root, native, rpc });
  await ensureWallet(core);
  const operationId = await prepareTransfer(core, "observation-rpc-non-local-0001");
  const before = { native: native.calls.length, balance: rpc.balanceCalls, nonce: rpc.nonceCalls,
    submissions: rpc.submissions.length };

  const result = await core.execute({
    command: "operation.resume",
    operationId,
    observationRpcEnv: OBSERVATION_ENV,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "APN_INVALID_INPUT");
  assert.deepEqual({ native: native.calls.length, balance: rpc.balanceCalls, nonce: rpc.nonceCalls,
    submissions: rpc.submissions.length }, before);
});

test("ambient APN_BASE_RPC_URL does not conflict with explicit Local observation recovery", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const previousBase = process.env.APN_BASE_RPC_URL;
  process.env.APN_BASE_RPC_URL = "http://127.0.0.1/invalid-ambient-base";
  t.after(() => { if (previousBase === undefined) delete process.env.APN_BASE_RPC_URL;
    else process.env.APN_BASE_RPC_URL = previousBase; });
  const result = await runCli(["operation", "resume", "--operation", OPERATION_ID,
    "--observation-rpc-env", OBSERVATION_ENV], {}, { stateRoot: temporary.root,
    wrappingSecret: new ThrowingWrappingSecret(), gasless: effectCounters().dependencies });
  assert.equal(result.error?.code, "APN_OPERATION_NOT_FOUND");
  assert.notEqual(result.error?.details?.reason, "gasless_observation_rpc_options");
});

function requiredResumeTool() {
  const tool = projectMcpTools().find((item) => item.name === "apn_operation_resume");
  assert.notEqual(tool, undefined);
  return tool!;
}

function effectCounters() {
  const calls = { rpc: 0, observation: 0, load: 0, seal: 0 };
  const fail = (key: keyof typeof calls): never => {
    calls[key] += 1;
    throw new Error(`${SECRET_CANARY}_${key}`);
  };
  const dependencies: GaslessDependencies = {
    rpcFor: () => fail("rpc"),
    observationRpcFor: () => fail("observation"),
    custody: {
      load: async () => fail("load"),
      seal: async () => fail("seal"),
    },
  };
  return { calls, dependencies };
}

class ThrowingWrappingSecret implements WrappingSecretPort {
  loads = 0;
  creates = 0;
  async load(): Promise<Buffer> { this.loads += 1; throw new Error(`${SECRET_CANARY}_load`); }
  async create(): Promise<Buffer> { this.creates += 1; throw new Error(`${SECRET_CANARY}_create`); }
}

async function connectMcp(options: McpRuntimeOptions): Promise<{
  readonly client: Client;
  close(): Promise<void>;
}> {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-gasless-observation-command-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function decode(result: Awaited<ReturnType<Client["callTool"]>>): OutputEnvelope {
  const block = result.content.find((item) => item.type === "text");
  if (block?.type !== "text") throw new Error("Missing MCP text response");
  return JSON.parse(block.text) as OutputEnvelope;
}
