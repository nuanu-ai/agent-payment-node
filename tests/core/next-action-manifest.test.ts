/**
 * MANIFEST-V2-RECOVERY-COMMAND-001 and GASZIP-MANIFEST-STATES-001: every command APN names to a caller exists in the
 * published manifest v2, and the published state lists are the journals' own lists.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import { COMMAND_MANIFEST, renderHelp } from "../../src/command-catalog.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { GASZIP_STATES, GASZIP_TERMINAL_STATES } from "../../src/lifi/gaszip-outcome.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { TestNative, temporaryState } from "./helpers.js";

const COMMAND_PATHS = new Set(COMMAND_MANIFEST.commands.map(command => command.path.join(" ")));
const GROUP_PATHS = new Set(COMMAND_MANIFEST.groups.map(group => group.path.join(" ")));
const REMOVED_PATHS = COMMAND_MANIFEST.removed_v1_commands.map(command => command.path.join(" "));
const TOP_LEVEL = new Set([...COMMAND_PATHS, ...GROUP_PATHS].map(path => path.split(" ")[0]!));

/** The manifest path an `apn ...` command line names: its longest prefix of words that is a command or group. */
function namedPath(commandLine: string): string | null {
  const words = commandLine.replace(/^apn /u, "").split(" ");
  for (let length = words.length; length > 0; length -= 1) {
    const path = words.slice(0, length).join(" ");
    if (COMMAND_PATHS.has(path) || GROUP_PATHS.has(path)) return path;
  }
  return null;
}
function assertCurrentCommand(commandLine: string, where: string): void {
  const words = commandLine.replace(/^apn /u, "");
  assert.ok(namedPath(commandLine) !== null || words === "help" || words.startsWith("help "), `${where}: ${commandLine} is not in manifest v2`);
  for (const removed of REMOVED_PATHS) {
    assert.ok(words !== removed && !words.startsWith(`${removed} `), `${where}: ${commandLine} names the retired v1 command ${removed}`);
  }
}

async function sourceFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await sourceFiles(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

test("every literal apn command the source names for a caller exists in manifest v2 and none is a retired v1 path", async () => {
  let checked = 0;
  for (const file of await sourceFiles("src")) {
    const text = await readFile(file, "utf8");
    // Only command lines: `apn` then a manifest top-level word (prose such as "apn keeps" is not a command).
    for (const match of text.matchAll(/(?<![A-Za-z0-9_$-])apn ([a-z0-9][a-z0-9-]*(?: [a-z0-9][a-z0-9-]*)*)/gu)) {
      if (!TOP_LEVEL.has(match[1]!.split(" ")[0]!)) continue;
      assertCurrentCommand(`apn ${match[1]}`, `${file}:${text.slice(0, match.index).split("\n").length}`);
      checked += 1;
    }
  }
  assert.ok(checked > 300, `only ${checked} command lines were found`);
});

test("manifest v2 recovery targets and examples name current commands", () => {
  for (const command of COMMAND_MANIFEST.commands) {
    for (const recovery of command.recovery) assert.ok(COMMAND_PATHS.has(recovery.command_path.join(" ")), command.path.join(" "));
    for (const example of command.examples) assertCurrentCommand(example, `example of ${command.path.join(" ")}`);
  }
});

const MASTER = Buffer.alloc(32, 7);
const wrappingSecret: WrappingSecretPort = { load: async () => Buffer.from(MASTER), create: async () => Buffer.from(MASTER) };

test("policy show of an unconfigured Base or non-Base policy names manifest v2 policy set for the selected profile and chain in CLI and MCP", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const options = { stateRoot: temporary.root, wrappingSecret, native: new TestNative() };
  const ensured = await runCli(["wallet", "ensure", "--profile", "qa-policy"], {}, options);
  assert.equal(ensured.ok, true, JSON.stringify(ensured.error));
  const server = createMcpServer(options), client = new Client({ name: "next-action-manifest", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]);
  t.after(async () => { await client.close(); await server.close(); });
  const limits = "--max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>";
  for (const [chain, expected] of [[undefined, `apn wallet policy set --profile qa-policy ${limits}`],
    ["eip155:42161", `apn wallet policy set --profile qa-policy --chain eip155:42161 ${limits}`],
    ["eip155:8453", `apn wallet policy set --profile qa-policy --chain eip155:8453 ${limits}`]] as const) {
    const cli = await runCli(["wallet", "policy", "show", "--profile", "qa-policy", ...chain === undefined ? [] : ["--chain", chain]], {}, options);
    const mcp = (await client.callTool({ name: "apn_wallet_policy_show",
      arguments: { profile: "qa-policy", ...chain === undefined ? {} : { chain } } })).structuredContent as unknown as OutputEnvelope;
    for (const envelope of [cli, mcp]) {
      assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
      assert.equal((envelope.data as { configured: boolean }).configured, false);
      assert.deepEqual(envelope.next_actions, [expected]);
      assert.deepEqual((envelope.data as { next_actions: readonly string[] }).next_actions, [expected]);
      assertCurrentCommand(expected, "policy show");
      assert.equal(namedPath(expected), "wallet policy set");
    }
    assert.deepEqual(cli.data, mcp.data);
  }
  const set = await runCli(["wallet", "policy", "set", "--profile", "qa-policy", "--chain", "eip155:42161", "--max-balance-usdc-atomic", "1000",
    "--max-x402-amount-atomic", "100"], {}, { ...options, policyApproval: { approve: async () => undefined } });
  assert.equal(set.ok, true, JSON.stringify(set.error));
  const configured = await runCli(["wallet", "policy", "show", "--profile", "qa-policy", "--chain", "eip155:42161"], {}, options);
  assert.equal((configured.data as { configured: boolean }).configured, true);
  assert.deepEqual(configured.next_actions, []);
  const retired = await runCli(["wallet", "policy", "set-network", "--chain", "eip155:42161"], {}, options);
  assert.equal(retired.error?.code, "APN_UNSUPPORTED_COMMAND");
});

test("GasZip funding commands publish every state the journal admits, destination_failed among the terminal ones", () => {
  for (const lane of ["mega", "sei"]) {
    for (const action of ["prepare", "approve", "status"]) {
      const command = COMMAND_MANIFEST.commands.find(entry => entry.path.join(" ") === `${lane} funding ${action}`);
      assert.ok(command !== undefined);
      assert.deepEqual(command.states.terminal, [...GASZIP_TERMINAL_STATES]);
      assert.ok(command.states.terminal.includes("destination_failed"));
      assert.deepEqual([...command.states.non_terminal, ...command.states.terminal].sort(), [...GASZIP_STATES].sort());
    }
    assert.match(renderHelp([lane, "funding", "status"]), /destination_failed/u);
  }
});
