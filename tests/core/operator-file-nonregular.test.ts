/**
 * QA on 0.5.106 (F23): `wallet import --key-file <FIFO>` blocked in open() until some writer appeared instead of
 * refusing at once; 0.5.104 showed the same for `allowlist policy stage --file` over CLI and MCP. A file an operator
 * names is now refused from its lstat when it is not a regular file, and the open is non-blocking, so no reader waits.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { privateKeyToAccount } from "viem/accounts";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { temporaryState, UUID } from "./helpers.js";

const KEY = `0x${"1".padStart(64, "0")}` as const;
const ADDRESS = privateKeyToAccount(KEY).address;
const BLOCKED = Symbol("blocked");
const wrapping: WrappingSecretPort = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };

function mkfifo(path: string): void {
  const made = spawnSync("mkfifo", ["-m", "600", path], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
}

/**
 * The command must answer while nothing ever writes to the FIFO. If it blocks instead, a writer is opened after the
 * bound so the stuck open returns and the test fails rather than hanging the run.
 */
async function answersWithoutWriter(fifo: string, run: () => Promise<OutputEnvelope>): Promise<OutputEnvelope> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<typeof BLOCKED>((resolve) => { timer = setTimeout(() => resolve(BLOCKED), 5_000); });
  const pending = run();
  const first = await Promise.race([pending, bound]);
  clearTimeout(timer);
  if (first !== BLOCKED) return first;
  const writer = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK).catch(() => null);
  await writer?.close();
  await pending.catch(() => undefined);
  assert.fail("the command blocked in open() waiting for a FIFO writer");
}

function assertNotRegular(envelope: OutputEnvelope, reason: string, type: string, label: string): void {
  assert.equal(envelope.ok, false, label);
  assert.equal(envelope.error?.code, "APN_STATE_SECURITY", label);
  assert.equal(envelope.error?.details?.reason, reason, label);
  assert.equal(envelope.error?.details?.file_type, type, label);
}

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, () => resolve()); });
}

test("wallet import refuses a FIFO, directory, device or socket key file at once and leaves the profile free", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const fifo = join(temporary.base, "key.fifo"), directory = join(temporary.base, "key.dir"), socket = join(temporary.base, "k.sock");
  mkfifo(fifo);
  await mkdir(directory, { mode: 0o700 });
  const server = createServer();
  await listen(server, socket);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const cli = async (argv: readonly string[]) => await runCli(argv, {}, { stateRoot: temporary.root, wrappingSecret: wrapping });
  const importing = (keyFile: string) => async () => await cli(["wallet", "import", "--profile", "imported", "--key-file", keyFile,
    "--key-name", "TEST_EVM_KEY", "--expected-address", ADDRESS]);

  assertNotRegular(await answersWithoutWriter(fifo, importing(fifo)), "key_file_not_regular", "fifo", "fifo");
  for (const [path, type] of [[directory, "directory"], ["/dev/null", "device"], [socket, "socket"]] as const) {
    assertNotRegular(await importing(path)(), "key_file_not_regular", type, type);
  }
  const status = await cli(["wallet", "status", "--profile", "imported"]);
  assert.equal((status.data as { status: string }).status, "absent", "no key was written");
  await assert.rejects(stat(join(temporary.root, "wallets", "imported.json")), { code: "ENOENT" });
});

test("allowlist policy stage refuses a FIFO policy file at once over CLI and MCP", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const fifo = join(temporary.base, "policy.fifo");
  mkfifo(fifo);
  const options = { stateRoot: temporary.root, ids: { next: () => UUID } };
  const cli = await answersWithoutWriter(fifo, async () =>
    await runCli(["allowlist", "policy", "stage", "--profile", "owner", "--file", fifo], {}, options));
  assertNotRegular(cli, "policy_file_not_regular", "fifo", "cli");

  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "operator-file-nonregular", version: "1" });
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const mcp = await answersWithoutWriter(fifo, async () => {
    const result = await client.callTool({ name: "apn_allowlist_policy_stage", arguments: { profile: "owner", file: fifo } });
    const content = result.content[0];
    if (content?.type !== "text") throw new Error("expected MCP text");
    return JSON.parse(content.text) as OutputEnvelope;
  });
  assertNotRegular(mcp, "policy_file_not_regular", "fifo", "mcp");
  assert.deepEqual(mcp.error, cli.error, "MCP and CLI refuse it the same way");
});
