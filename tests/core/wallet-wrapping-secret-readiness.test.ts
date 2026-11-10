/**
 * QA on 0.5.101: `wallet ensure` / `wallet status` answered `ready` for a local wallet whose login-Keychain wrapping
 * secret was gone, and `doctor keychain` without a wallet did not say whether the secret exists. Review of that fix:
 * any create path then minted a replacement secret that orphaned what the old one sealed, and the status check left a
 * cached copy of the secret behind. The Keychain is faked at the `/usr/bin/security` boundary through the runner seam
 * (exit 0 with the secret, 44 for no item, 36 for a locked or refused Keychain); the real Keychain is never touched.
 */
import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { privateKeyToAccount } from "viem/accounts";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { MacOSLoginKeychainSecret, type SecurityRunner, type WrappingSecretPort } from "../../src/macos-keychain.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { StateStore } from "../../src/state.js";
import { holdsSealedCustody, loadOrCreateWrappingSecret } from "../../src/wrapping-secret-custody.js";
import { temporaryState } from "./helpers.js";

const MASTER = Buffer.from("11".repeat(32), "hex");
const WRONG_MASTER = Buffer.from("22".repeat(32), "hex");
const IMPORT_KEY = `0x${"5".repeat(63)}1` as const;
const IDENTITY = { homedir: "/Users/apn-test-user", username: "apn-test-user" };
type Answer = "present" | "missing" | "unavailable";
type Data = { readonly status?: unknown; readonly wrapping_secret?: unknown };

/** The login Keychain at the `security` boundary: one item that an `-i` add stores and a find reads back. */
class FakeKeychain {
  item: string | null;
  readonly calls: string[][] = [];
  constructor(secret: Buffer | null) { this.item = secret === null ? null : secret.toString("base64"); }

  /** A fresh port per command, as production builds one, so no cached copy crosses commands. */
  port(): MacOSLoginKeychainSecret {
    const runSecurity: SecurityRunner = async (args, input) => {
      this.calls.push([...args]);
      if (args[0] === "-i") {
        const added = /-w (\S+) /u.exec(input?.toString("utf8") ?? "")?.[1];
        if (this.item === null && added !== undefined) this.item = added;
      } else if (this.item === null) return { code: 44, stdout: Buffer.alloc(0) };
      return { code: 0, stdout: Buffer.from(`${this.item ?? ""}\n`, "utf8") };
    };
    return new MacOSLoginKeychainSecret({ identity: IDENTITY, runSecurity });
  }
}

/** One command's login Keychain as `security` answers it; `calls` keeps every argv it was asked. */
function keychain(answer: Answer): { readonly wrapping: MacOSLoginKeychainSecret; readonly calls: string[][] } {
  const calls: string[][] = [];
  const runSecurity: SecurityRunner = async (args) => {
    calls.push([...args]);
    if (answer === "present") return { code: 0, stdout: Buffer.from(`${MASTER.toString("base64")}\n`, "utf8") };
    return { code: answer === "missing" ? 44 : 36, stdout: Buffer.alloc(0) };
  };
  return { wrapping: new MacOSLoginKeychainSecret({ identity: IDENTITY, runSecurity }), calls };
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
    assert.deepEqual(result.next_actions, ["apn wallet ensure --profile default"], "nothing is sealed yet: a first wallet");
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

test("a missing wrapping secret is never replaced while anything sealed under it exists", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const login = new FakeKeychain(MASTER);
  const run = async (argv: readonly string[]) =>
    await runCli(argv, {}, { stateRoot: temporary.root, wrappingSecret: login.port() });
  const created = await run(["wallet", "ensure", "--profile", "default"]);
  assert.equal(created.ok, true, JSON.stringify(created.error));
  login.item = null; // the owner's login Keychain lost the item
  assertSecretMissing(await run(["wallet", "status", "--profile", "default"]), "status once the item is gone");

  const keyFile = join(temporary.base, "import.env");
  await writeFile(keyFile, `IMPORT_KEY=${IMPORT_KEY}\n`, { mode: 0o600 });
  const creators: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["ensure on another profile", ["wallet", "ensure", "--profile", "other"]],
    ["import into another profile", ["wallet", "import", "--profile", "imported", "--key-file", keyFile,
      "--key-name", "IMPORT_KEY", "--expected-address", privateKeyToAccount(IMPORT_KEY).address]],
    ["ensure-tron on the same profile", ["wallet", "ensure-tron", "--profile", "default", "--provider", "local", "--accept-risk", "true"]],
  ];
  for (const [label, argv] of creators) assertSecretMissing(await run(argv), label);
  assert.equal(login.item, null, "no replacement secret was minted");
  assert.deepEqual(login.calls.filter((args) => args[0] !== "find-generic-password"), [], "no Keychain add was attempted");
  assertSecretMissing(await run(["wallet", "status", "--profile", "default"]), "status after every create attempt");

  const doctor = await run(["doctor", "keychain", "--profile", "fresh"]);
  assert.equal(doctor.ok, true, JSON.stringify(doctor.error));
  assert.equal((doctor.data as Data).wrapping_secret, "missing");
  assert.equal(doctor.next_actions.length, 1);
  assert.match(doctor.next_actions[0] ?? "", /^Restore the login Keychain item ai\.nuanu\.apn\.wrapping-secret\.v1 /u);
});

test("only a state root that holds nothing sealed mints a first wrapping secret", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  await state.initialize();
  const login = new FakeKeychain(null);
  const first = await loadOrCreateWrappingSecret(state, login.port());
  assert.equal(first.toString("base64"), login.item);
  first.fill(0);
  assert.equal(login.calls.filter((args) => args[0] === "-i").length, 1);
});

test("empty store directories and dotfiles are not sealed state; a record, a link or an unlistable store is", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  await state.initialize();
  const at = (...parts: string[]) => join(temporary.root, ...parts), hash = "a".repeat(64);
  // Left by effect retention or by a first seal that failed before writing, and by Finder: nothing here was sealed.
  // Before 0.5.103 any entry counted, so this root refused a first secret for good, naming a Keychain item that never existed.
  for (const directory of [at("gasless-effects", hash), at("bridge-effects", hash), at("smart-account-effects"), at("wallets", hash)]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  for (const file of [at("policies", ".DS_Store"), at("gasless-effects", hash, ".DS_Store")]) await writeFile(file, "", { mode: 0o600 });
  assert.equal(await holdsSealedCustody(state), false);
  const login = new FakeKeychain(null);
  (await loadOrCreateWrappingSecret(state, login.port())).fill(0);
  assert.notEqual(login.item, null, "a first secret is minted over leftovers that hold nothing sealed");
  // Fail closed: one record in a per-profile directory, a link in a store, or a store directory that cannot be listed.
  const record = at("gasless-effects", hash, `${"1".repeat(64)}-bootstrap.json`);
  await writeFile(record, "{}", { mode: 0o600 });
  assert.equal(await holdsSealedCustody(state), true, "a record in a per-profile directory");
  await unlink(record);
  await mkdir(at("merchant-material"), { mode: 0o700 });
  await symlink(at("nowhere"), at("merchant-material", "entry"));
  assert.equal(await holdsSealedCustody(state), true, "a link");
  await unlink(at("merchant-material", "entry"));
  assert.equal(await holdsSealedCustody(state), false);
  await chmod(at("bridge-effects", hash), 0o750);
  assert.equal(await holdsSealedCustody(state), true, "a store directory the state reader refuses to list");
});

test("wallet status keeps no cached copy of the wrapping secret it checked", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await createWallet(temporary.root);
  const login = new FakeKeychain(MASTER), wrapping = login.port();
  const status = await runCli(["wallet", "status", "--profile", "default"], {}, { stateRoot: temporary.root, wrappingSecret: wrapping });
  assert.equal(status.ok, true, JSON.stringify(status.error));
  assert.equal(login.calls.length, 1);
  (await wrapping.load())?.fill(0);
  assert.equal(login.calls.length, 2, "the status check left no cached copy to serve this read");
});

test("no source mints a wrapping secret except through the sealed-state guard", async () => {
  const sources = (await readdir(resolve("src"), { recursive: true })).filter((path) => path.endsWith(".ts"));
  assert.ok(sources.length > 100);
  const direct: string[] = [];
  for (const path of sources) {
    if (/[wW]rapping\w*\??\.create\(/u.test(await readFile(resolve("src", path), "utf8"))) direct.push(path);
  }
  assert.deepEqual(direct, []);
});
