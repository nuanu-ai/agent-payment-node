/**
 * Regression (QA 0.5.101): `gasless usdt execute` had neither an MCP tool nor a handoff although its prepare, status and
 * resume are MCP tools, and `x402 permit2 approve` was documented as "Handoff only" next to the `x402 permit2 status`
 * tool while the handoff tool refused it. Every foreground command of the catalog is now handed off, run over MCP for
 * its consent-free part, or CLI only together with its whole family.
 */
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { COMMAND_MANIFEST } from "../../src/command-catalog.js";
import type { OutputEnvelope } from "../../src/commands.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { CLI_ONLY_FOREGROUND, projectMcpForegroundHandoff, projectMcpTools } from "../../src/mcp-projection.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { temporaryState } from "./helpers.js";

const PROFILE_HASH = "c".repeat(64), OPERATION = "d".repeat(64);
const pathOf = (command: { readonly path: readonly string[] }): string => command.path.join(" ");

test("every catalog foreground command is handed off, run over MCP for a decrease, or CLI only with its whole family", () => {
  const foreground = COMMAND_MANIFEST.commands.filter((command) => command.approval.class === "foreground_tty").map(pathOf);
  const tools = projectMcpTools(), handedOff = projectMcpForegroundHandoff().commands;
  const run = tools.filter((tool) => tool.command.approval.class === "foreground_tty").map((tool) => pathOf(tool.command));
  assert.deepEqual(run, ["wallet policy set"]);
  assert.deepEqual([...handedOff.map(pathOf), ...run, ...CLI_ONLY_FOREGROUND].sort(), [...foreground].sort());
  for (const path of ["gasless usdt execute", "x402 permit2 approve"]) {
    assert.equal(handedOff.some((command) => pathOf(command) === path), true, path);
    assert.equal(tools.some((tool) => pathOf(tool.command) === path), false, path);
  }
  const surfaced = [...tools.map((tool) => pathOf(tool.command)), ...handedOff.map(pathOf)];
  for (const cliOnly of CLI_ONLY_FOREGROUND) {
    const family = `${cliOnly.split(" ").slice(0, -1).join(" ")} `;
    assert.deepEqual(surfaced.filter((path) => path.startsWith(family)), [], cliOnly);
  }
});

test("MCP discovery leads from gasless USDT prepare to the foreground execute handoff", () => {
  const prepare = projectMcpTools().find((tool) => tool.name === "apn_gasless_usdt_prepare");
  assert.ok(prepare);
  assert.match(prepare.description, /\nNext: apn gasless usdt execute \(The owner approves and sends the saved operation in a foreground terminal\.\)$/u);
  const description = projectMcpForegroundHandoff().description;
  assert.ok(description.includes("\n- gasless usdt execute --profile-hash <hash> --operation <operation-id>"));
  assert.ok(description.includes("\n- x402 permit2 approve --url <https-url> --rpc-url <https-rpc> [--profile <profile>] --idempotency-key <key>"));
});

test("the handoff names the exact gasless USDT execute and Permit2 approve commands without entering any runtime", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  let entries = 0;
  const wrapping = new ThrowingWrappingSecret();
  const connection = await connectMcp({
    stateRoot: temporary.root, wrappingSecret: wrapping,
    gaslessUsdtExecute: new Proxy({}, { get: () => async () => { entries++; } }) as never,
    native: { request: async () => { entries++; throw new Error("native must stay untouched"); } },
  });
  t.after(connection.close);
  const permit2 = ["apn", "x402", "permit2", "approve", "--profile", "owner", "--url", "https://seller.example/resource",
    "--rpc-url", "https://rpc.example/", "--idempotency-key", "permit2-handoff-0001"];
  for (const [command, args, request, argv] of [
    ["gasless usdt execute", { profile_hash: PROFILE_HASH, operation: OPERATION }, "gasless.usdt.execute",
      ["apn", "gasless", "usdt", "execute", "--profile-hash", PROFILE_HASH, "--operation", OPERATION]],
    ["x402 permit2 approve", { profile: "owner", url: "https://seller.example/resource", rpc_url: "https://rpc.example/",
      idempotency_key: "permit2-handoff-0001" }, "x402.permit2.approve", permit2],
  ] as const) {
    const envelope = decode(await connection.client.callTool({ name: "apn_foreground_handoff", arguments: { command, arguments: args } }));
    assert.equal(envelope.command, request, command);
    assert.equal(envelope.ok, false, command);
    assert.equal(envelope.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED", command);
    assert.deepEqual(envelope.error?.details, {
      approval_boundary: "foreground_tty", foreground_auth: true, cli_handoff: argv.join(" "), cli_handoff_argv: argv,
    }, command);
    assert.deepEqual(envelope.next_actions, [argv.join(" ")], command);
  }
  // The arguments are validated exactly as the CLI validates them.
  for (const [command, args] of [
    ["gasless usdt execute", { profile_hash: "default", operation: OPERATION }],
    ["gasless usdt execute", { operation: OPERATION }],
    ["x402 permit2 approve", { url: "https://seller.example", rpc_url: "https://rpc.example/", idempotency_key: "permit2-handoff-0001" }],
    ["x402 permit2 approve", { url: "https://seller.example/resource", rpc_url: "https://rpc.example/" }],
  ] as const) {
    const refused = decode(await connection.client.callTool({ name: "apn_foreground_handoff", arguments: { command, arguments: args } }));
    assert.equal(refused.error?.code, "APN_INVALID_INPUT", JSON.stringify(args));
  }
  assert.equal(entries, 0);
  assert.deepEqual({ loads: wrapping.loads, creates: wrapping.creates }, { loads: 0, creates: 0 });
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
});

class ThrowingWrappingSecret implements WrappingSecretPort {
  loads = 0;
  creates = 0;
  async load(): Promise<Buffer> { this.loads++; throw new Error("unexpected wrapping load"); }
  async create(): Promise<Buffer> { this.creates++; throw new Error("unexpected wrapping create"); }
}

async function connectMcp(options: McpRuntimeOptions) {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-mcp-foreground-coverage-test", version: "1.0.0" });
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
