import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import {
  MacOSLoginKeychainSecret,
  loginKeychainPath,
  type SecurityRunner,
} from "../../src/macos-keychain.js";
import { privateKeyToAccount } from "viem/accounts";
import { domainHash } from "../../src/canonical.js";
import { EncryptedProfilePolicy } from "../../src/encrypted-profile-policy.js";
import { EncryptedProviderAuthorizationStore } from "../../src/encrypted-provider-authorization-store.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const HOME = "/Users/apn-test-user";
const LOGIN_KEYCHAIN = `${HOME}/Library/Keychains/login.keychain-db`;
const FIND_ARGS = [
  "find-generic-password", "-a", "default", "-s", "ai.nuanu.apn.wrapping-secret.v1", "-w", LOGIN_KEYCHAIN,
] as const;

test("login Keychain path is exact and rejects non-canonical homes", () => {
  assert.equal(loginKeychainPath(HOME), LOGIN_KEYCHAIN);
  assert.throws(() => loginKeychainPath("relative/home"));
  assert.throws(() => loginKeychainPath("/Users/apn-test-user/../other"));
  assert.throws(() => loginKeychainPath("/"));
});

test("doctor probe targets the exact login Keychain without creating a secret", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const calls: string[][] = [];
  const runner: SecurityRunner = async (args) => {
    calls.push([...args]);
    return { code: 44, stdout: Buffer.alloc(0) };
  };
  const wrapping = new MacOSLoginKeychainSecret({
    identity: { homedir: HOME, username: "apn-test-user" },
    runSecurity: runner,
  });

  const result = await runCli(["doctor", "keychain"], {}, {
    stateRoot: temporary.root,
    wrappingSecret: wrapping,
  });
  assert.equal(result.ok, true);
  assert.equal((result.data as { readonly status: string }).status, "absent");
  assert.deepEqual(calls, [[...FIND_ARGS]]);
  await assert.rejects(stat(temporary.root), { code: "ENOENT" });
});

test("create sends the new secret on security -i stdin, never argv, and proves the add by reading it back", async () => {
  const calls: { readonly args: readonly string[]; readonly input: string | undefined; readonly buffer: Buffer | undefined }[] = [];
  let stored: string | undefined;
  const runner: SecurityRunner = async (args, input) => {
    calls.push({ args: [...args], input: input?.toString("utf8"), buffer: input });
    if (args[0] === "find-generic-password") return { code: 44, stdout: Buffer.alloc(0) };
    stored = /-w (\S+) /u.exec(input?.toString("utf8") ?? "")?.[1];
    return { code: 0, stdout: Buffer.from(`${stored}\n`) };
  };
  const wrapping = new MacOSLoginKeychainSecret({
    identity: { homedir: HOME, username: "apn-test-user" },
    runSecurity: runner,
  });

  const secret = await wrapping.create();
  try {
    assert.equal(secret.length, 32);
    const encoded = secret.toString("base64");
    assert.equal(stored, encoded);
    assert.deepEqual(calls.map((call) => call.args), [[...FIND_ARGS], ["-i"]]);
    assert.equal(calls[1]?.input, `add-generic-password -a default -s ai.nuanu.apn.wrapping-secret.v1 -l "Nuanu APN wrapping secret" ` +
      `-w ${encoded} ${LOGIN_KEYCHAIN}\n${FIND_ARGS.join(" ")}\n`);
    for (const call of calls) assert.ok(call.args.every((arg) => !arg.includes(encoded)), "the secret never reaches argv");
    assert.ok(calls[1]?.buffer?.every((byte) => byte === 0), "the stdin script is zeroed after the session");
    assert.equal(calls.length, 2, "creation still spawns security twice");
  } finally {
    secret.fill(0);
  }
});

test("a lost creation race or a failed add returns whatever the Keychain holds, and nothing reaches argv", async () => {
  const winner = Buffer.alloc(32, 9).toString("base64");
  for (const outcome of ["raced", "failed"] as const) {
    const argv: string[] = []; let present = false;
    const runner: SecurityRunner = async (args, input) => {
      argv.push(...args);
      if (args[0] === "-i") {
        present = outcome === "raced";
        assert.match(input?.toString("utf8") ?? "", /^add-generic-password .* -w [A-Za-z0-9+/=]{44} /u);
        return { code: outcome === "raced" ? 0 : 1, stdout: Buffer.from(outcome === "raced" ? `${winner}\n` : "") };
      }
      return present ? { code: 0, stdout: Buffer.from(`${winner}\n`) } : { code: 44, stdout: Buffer.alloc(0) };
    };
    const wrapping = new MacOSLoginKeychainSecret({ identity: { homedir: HOME, username: "apn-test-user" }, runSecurity: runner });
    if (outcome === "raced") assert.equal((await wrapping.create()).toString("base64"), winner);
    else await assert.rejects(wrapping.create(), { code: "APN_NATIVE_REJECTED" });
    assert.ok(argv.every((arg) => !/^[A-Za-z0-9+/]{43}=$/u.test(arg)), "no 32-byte secret on argv");
  }
});

test("a home path that security -i could not read back exactly is refused, and no add is attempted", async () => {
  const calls: string[][] = [];
  const runner: SecurityRunner = async (args) => { calls.push([...args]); return { code: 44, stdout: Buffer.alloc(0) }; };
  const wrapping = new MacOSLoginKeychainSecret({ identity: { homedir: "/Users/o\"brien", username: "obrien" }, runSecurity: runner });
  await assert.rejects(wrapping.create(), { code: "APN_NATIVE_REJECTED" });
  assert.deepEqual(calls.map((call) => call[0]), ["find-generic-password"]);
});

test("one command instance spawns security once and hands every caller its own zeroable copy", async () => {
  const secret = Buffer.alloc(32, 7).toString("base64");
  let spawns = 0, present = false;
  const runner: SecurityRunner = async (args) => {
    spawns += 1;
    if (args[0] === "add-generic-password") { present = true; return { code: 0, stdout: Buffer.alloc(0) }; }
    return present ? { code: 0, stdout: Buffer.from(`${secret}\n`) } : { code: 44, stdout: Buffer.alloc(0) };
  };
  const absent = new MacOSLoginKeychainSecret({ identity: { homedir: HOME, username: "apn-test-user" }, runSecurity: runner });
  assert.equal(await absent.load(), null);
  assert.equal(await absent.load(), null, "an absent secret is never cached");
  assert.equal(spawns, 2);
  present = true; spawns = 0;
  const wrapping = new MacOSLoginKeychainSecret({ identity: { homedir: HOME, username: "apn-test-user" }, runSecurity: runner });
  const first = await wrapping.load(); assert.ok(first);
  first.fill(0);
  const second = await wrapping.load(); assert.ok(second);
  assert.equal(second.toString("base64"), secret, "zeroing a caller's copy leaves the cached secret intact");
  assert.notEqual(first.buffer === second.buffer && first.byteOffset === second.byteOffset, true);
  assert.equal(spawns, 1, "later reads in the same command spawn no security process");
  assert.equal((await new MacOSLoginKeychainSecret({ identity: { homedir: HOME, username: "apn-test-user" }, runSecurity: runner }).load())?.toString("base64"), secret);
  assert.equal(spawns, 2, "a new command instance reads the Keychain again");
});

test("one command opens and seals across custody stores with a single security spawn", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const secret = Buffer.alloc(32, 5).toString("base64");
  const spawned: string[][] = [];
  const runner: SecurityRunner = async (args) => { spawned.push([...args]); return { code: 0, stdout: Buffer.from(`${secret}\n`) }; };
  const wrapping = new MacOSLoginKeychainSecret({ identity: { homedir: HOME, username: "apn-test-user" }, runSecurity: runner });
  const state = new StateStore(temporary.root); await state.initialize();
  const key = `0x${"6".repeat(64)}` as const, address = privateKeyToAccount(key).address, profileHash = state.profileHash("single");
  const wallets = new EncryptedWalletStore(state, wrapping);
  await wallets.importNew("single", key, address);
  assert.equal((await wallets.describe("single"))?.identity.address, address);
  const binding = { profile: "single", profileHash, walletAddress: address, walletBindingHash: "a".repeat(64) };
  const policy = new EncryptedProfilePolicy(state, wrapping, { approve: async () => undefined });
  await policy.set(binding, { maxBalanceUsdcAtomic: "1000000", maxX402AmountAtomic: "1000" });
  assert.equal((await policy.load(binding))?.maxX402AmountAtomic, "1000");
  const authorizations = new EncryptedProviderAuthorizationStore(state, wrapping), signature = `0x${"12".repeat(65)}` as const;
  const authorization = { profile: "single", profileHash, operationId: "1".repeat(64), fingerprint: "2".repeat(64), wallet: address.toLowerCase() as `0x${string}`,
    providerId: "provider", profileRevision: 1, capabilityHash: "3".repeat(64), accountBindingHash: "4".repeat(64) };
  await authorizations.save(authorization, { schemaVersion: "apn.provider-authorization.v1", requestHash: "5".repeat(64), phase: "signed",
    updatedAt: "2026-10-17T10:00:00.000Z", signature, signatureHash: domainHash("apn.x402.signature.v1", Buffer.from(signature.slice(2), "hex")) });
  assert.equal((await authorizations.load(authorization))?.phase, "signed");
  assert.deepEqual(spawned, [[...FIND_ARGS]], "every later store read reuses the command's cached secret");
});
