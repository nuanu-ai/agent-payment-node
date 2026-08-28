import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import {
  MacOSLoginKeychainSecret,
  loginKeychainPath,
  type SecurityRunner,
} from "../../src/macos-keychain.js";
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

test("create binds both find and add to the exact login Keychain using security's password argument", async () => {
  const calls: { readonly args: readonly string[]; readonly input: Buffer | undefined }[] = [];
  let observedPasswordBytes = 0;
  const runner: SecurityRunner = async (args, input) => {
    const sanitized = [...args];
    if (args[0] === "add-generic-password") {
      const passwordIndex = args.indexOf("-w") + 1;
      const decoded = Buffer.from(args[passwordIndex] ?? "", "base64");
      observedPasswordBytes = decoded.length;
      decoded.fill(0);
      sanitized[passwordIndex] = "<redacted>";
    }
    calls.push({ args: sanitized, input: input === undefined ? undefined : Buffer.from(input) });
    if (args[0] === "find-generic-password") return { code: 44, stdout: Buffer.alloc(0) };
    return { code: 0, stdout: Buffer.alloc(0) };
  };
  const wrapping = new MacOSLoginKeychainSecret({
    identity: { homedir: HOME, username: "apn-test-user" },
    runSecurity: runner,
  });

  const secret = await wrapping.create();
  try {
    assert.equal(secret.length, 32);
    assert.deepEqual(calls.map((call) => call.args), [
      [...FIND_ARGS],
      [
        "add-generic-password", "-a", "default", "-s", "ai.nuanu.apn.wrapping-secret.v1",
        "-l", "Nuanu APN wrapping secret", "-w", "<redacted>", LOGIN_KEYCHAIN,
      ],
    ]);
    assert.equal(calls[1]?.input, undefined);
    assert.equal(observedPasswordBytes, 32);
  } finally {
    secret.fill(0);
    for (const call of calls) call.input?.fill(0);
  }
});
