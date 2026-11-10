import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { AwalProcessAdapter, type AwalProcessRunnerPort } from "../../src/awal-process-adapter.js";
import type { ForegroundAuthenticationPort } from "../../src/provider-ports.js";

/** README prose with its line wrapping folded, so a sentence is matched wherever the column limit breaks it. */
async function readme(): Promise<string> {
  return (await readFile(resolve("README.md"), "utf8")).replace(/\s+/gu, " ");
}

// Regression: README said the new wrapping secret reached /usr/bin/security as an argument, while the code (proved in
// macos-keychain.test.ts) writes it to `security -i` on stdin.
test("README states that the Keychain wrapping secret reaches security(1) on stdin, never as an argument", async () => {
  const text = await readme();
  assert.doesNotMatch(text, /wrapping secret to `\/usr\/bin\/security` as an argument/u);
  assert.match(text, /wrapping secret to `\/usr\/bin\/security -i` on stdin, never in its arguments/u);
});

// awal 2.12.1 `auth verify <otp>` has no stdin or environment input, so the code must ride argv; README says so.
test("the awal one-time code reaches awal only as its positional argument, and README states that exposure", async () => {
  const calls: Array<{ readonly argv: readonly string[]; readonly sensitive: boolean }> = [];
  const runner: AwalProcessRunnerPort = {
    run: async (argv, sensitive) => {
      calls.push({ argv: [...argv], sensitive });
      return { exitCode: 0, stdout: Buffer.alloc(0) };
    },
  };
  const foreground: ForegroundAuthenticationPort = {
    readIdentity: async () => "owner@example.invalid",
    readChallengeResponse: async () => "739148",
    confirmRebind: async () => false,
  };
  await new AwalProcessAdapter(runner).connect(foreground);
  assert.deepEqual(calls, [
    { argv: ["auth", "login", "owner@example.invalid", "--json"], sensitive: true },
    { argv: ["auth", "verify", "739148", "--json"], sensitive: true },
  ]);
  const text = await readme();
  assert.match(text, /`awal auth verify <code>`\): `awal` 2\.12\.1 takes them nowhere else, neither on stdin nor from the environment/u);
  assert.match(text, /another process of the same user can read the code with `ps`/u);
});
