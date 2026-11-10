/**
 * QA on 0.5.101: `wallet ensure` / `wallet status` answered `ready` for a local wallet whose login-Keychain wrapping
 * secret was gone, and `doctor keychain` without a wallet did not say whether the secret exists. The Keychain is faked
 * at the `/usr/bin/security` boundary through the runner seam (exit 0 with the secret, 44 for no item, 36 for a locked
 * or refused Keychain); the real Keychain is never touched.
 */
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { MacOSLoginKeychainSecret, type SecurityRunner, type WrappingSecretPort } from "../../src/macos-keychain.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { temporaryState } from "./helpers.js";

const MASTER = Buffer.from("11".repeat(32), "hex");
const WRONG_MASTER = Buffer.from("22".repeat(32), "hex");
type Answer = "present" | "missing" | "unavailable";
type Data = { readonly status?: unknown; readonly wrapping_secret?: unknown };

/** One command's login Keychain as `security` answers it; `calls` keeps every argv it was asked. */
function keychain(answer: Answer): { readonly wrapping: MacOSLoginKeychainSecret; readonly calls: string[][] } {
  const calls: string[][] = [];
  const runSecurity: SecurityRunner = async (args) => {
    calls.push([...args]);
    if (answer === "present") return { code: 0, stdout: Buffer.from(`${MASTER.toString("base64")}\n`, "utf8") };
    return { code: answer === "missing" ? 44 : 36, stdout: Buffer.alloc(0) };
  };
  const identity = { homedir: "/Users/apn-test-user", username: "apn-test-user" };
  return { wrapping: new MacOSLoginKeychainSecret({ identity, runSecurity }), calls };
}

async function createWallet(root: string): Promise<void> {
  const fixed: WrappingSecretPort = { load: async () => Buffer.from(MASTER), create: async () => Buffer.from(MASTER) };
  const created = await runCli(["wallet", "ensure", "--profile", "default"], {}, { stateRoot: root, wrappingSecret: fixed });
  assert.equal(created.ok, true, JSON.stringify(created.error));
}

async function mcpCall(options: McpRuntimeOptions, name: string): Promise<OutputEnvelope> {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-wrapping-secret-readiness-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name, arguments: { profile: "default" } });
    const block = result.content.find((item) => item.type === "text");
    if (block?.type !== "text") throw new Error("Missing MCP text response");
    return JSON.parse(block.text) as OutputEnvelope;
  } finally {
    await client.close();
    await server.close();
  }
}

function assertSecretMissing(envelope: OutputEnvelope, label: string): void {
  assert.equal(envelope.ok, false, `${label}: ${JSON.stringify(envelope.data)}`);
  assert.equal(envelope.error?.code, "APN_STATE_CORRUPT", label);
  assert.equal(envelope.error?.details?.reason, "wrapping_secret_missing", label);
  assert.equal(envelope.next_actions.length, 1, label);
}

function assertKeychainUnavailable(envelope: OutputEnvelope, label: string): void {
  assert.equal(envelope.ok, false, `${label}: ${JSON.stringify(envelope.data)}`);
  assert.equal(envelope.error?.code, "APN_NATIVE_REJECTED", label);
  assert.equal(envelope.error?.details?.nativeCode, "APN_KEYCHAIN_UNAVAILABLE", label);
}

test("wallet ensure and wallet status, CLI and MCP, refuse a wallet whose wrapping secret is gone and never replace it", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await createWallet(temporary.root);
  const envelopePath = join(temporary.root, "wallets", "default.json");
  const before = await readFile(envelopePath);
  const options = (wrapping: WrappingSecretPort) => ({ stateRoot: temporary.root, wrappingSecret: wrapping });
  const surfaces: ReadonlyArray<readonly [string, (wrapping: WrappingSecretPort) => Promise<OutputEnvelope>]> = [
    ["cli wallet ensure", async (wrapping) => await runCli(["wallet", "ensure", "--profile", "default"], {}, options(wrapping))],
    ["cli wallet status", async (wrapping) => await runCli(["wallet", "status", "--profile", "default"], {}, options(wrapping))],
    ["mcp apn_wallet_ensure", async (wrapping) => await mcpCall(options(wrapping), "apn_wallet_ensure")],
    ["mcp apn_wallet_status", async (wrapping) => await mcpCall(options(wrapping), "apn_wallet_status")],
  ];
  for (const [label, run] of surfaces) {
    const missing = keychain("missing");
    assertSecretMissing(await run(missing.wrapping), label);
    assert.ok(missing.calls.length > 0, `${label}: the Keychain was asked`);
    assert.deepEqual(missing.calls.filter((args) => args[0] !== "find-generic-password"), [], `${label}: nothing is created`);
    assertKeychainUnavailable(await run(keychain("unavailable").wrapping), label);
    const present = await run(keychain("present").wrapping);
    assert.equal(present.ok, true, `${label}: ${JSON.stringify(present.error)}`);
    assert.equal((present.data as Data).status, "ready", label);
  }
  assert.deepEqual(await readFile(envelopePath), before, "the wallet envelope is never rewritten");
});

test("doctor keychain tells an unavailable Keychain from a missing wrapping secret, without and with a wallet", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const doctor = async (wrapping: WrappingSecretPort) =>
    await runCli(["doctor", "keychain", "--profile", "default"], {}, { stateRoot: temporary.root, wrappingSecret: wrapping });

  for (const answer of ["missing", "present"] as const) {
    const result = await doctor(keychain(answer).wrapping);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.deepEqual([(result.data as Data).status, (result.data as Data).wrapping_secret], ["absent", answer]);
  }
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
  assertKeychainUnavailable(await doctor(keychain("unavailable").wrapping), "doctor without a wallet");

  await createWallet(temporary.root);
  const ready = await doctor(keychain("present").wrapping);
  assert.equal(ready.ok, true, JSON.stringify(ready.error));
  assert.deepEqual([(ready.data as Data).status, (ready.data as Data).wrapping_secret], ["ready", "present"]);
  assertSecretMissing(await doctor(keychain("missing").wrapping), "doctor with a wallet");
  assertKeychainUnavailable(await doctor(keychain("unavailable").wrapping), "doctor with a wallet");
  // A secret that exists but does not unwrap this wallet is a decryption failure, not a missing secret.
  const wrong = await doctor({ load: async () => Buffer.from(WRONG_MASTER), create: async () => { throw new Error("unexpected create"); } });
  assert.equal(wrong.error?.code, "APN_STATE_CORRUPT");
  assert.equal(wrong.error?.details?.reason, undefined);
});
