import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { AllowlistPolicyStore } from "../../src/allowlist-policy.js";
import { loadActiveAssetPolicyRegistry } from "../../src/allowlist-active-policy.js";
import { GLOBAL_POLICY_FILE_ENV } from "../../src/allowlist-global-policy.js";
import { BASE_USDC } from "../../src/constants.js";
import { FileWrappingSecret } from "../../src/file-wrapping-secret.js";
import { openAiTools } from "../../src/http-server.js";
import { LinuxFlockLock } from "../../src/linux-advisory-lock.js";
import type { LockfSpawn } from "../../src/macos-advisory-lock.js";
import { MCP_TOOLS, serverMcpTools } from "../../src/mcp-projection.js";
import { isServerMode, SERVER_MODE_ENV } from "../../src/server-mode.js";
import { exactChainConsent } from "../../src/tty-approval.js";
import { ensureWallet, makeCore, temporaryState, TestNative, WALLET } from "./helpers.js";

async function withEnv<T>(values: Record<string, string | undefined>, work: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { return await work(); }
  finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("server mode is on only for APN_SERVER_MODE=1 and refuses other spellings", async () => {
  await withEnv({ [SERVER_MODE_ENV]: undefined }, async () => assert.equal(isServerMode(), false));
  await withEnv({ [SERVER_MODE_ENV]: "0" }, async () => assert.equal(isServerMode(), false));
  await withEnv({ [SERVER_MODE_ENV]: "1" }, async () => assert.equal(isServerMode(), true));
  await withEnv({ [SERVER_MODE_ENV]: "yes" }, async () => assert.throws(() => isServerMode(), { code: "APN_INVALID_INPUT" }));
});

test("the file wrapping secret is created once with mode 0600 and read back; loose modes are refused", async () => {
  const temporary = await temporaryState();
  try {
    await mkdir(temporary.root, { mode: 0o700 });
    const path = join(temporary.root, "wrapping-secret");
    const created = await new FileWrappingSecret(path).create();
    assert.equal(created.length, 32);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await new FileWrappingSecret(path).load(), created);
    assert.deepEqual(await new FileWrappingSecret(path).create(), created);
    await chmod(path, 0o640);
    await assert.rejects(new FileWrappingSecret(path).load(), { code: "APN_NATIVE_REJECTED" });
    await writeFile(join(temporary.root, "short"), "c2hvcnQ=\n", { mode: 0o600 });
    await assert.rejects(new FileWrappingSecret(join(temporary.root, "short")).load(), { code: "APN_NATIVE_REJECTED" });
    assert.equal(await new FileWrappingSecret(join(temporary.root, "absent")).load(), null);
  } finally { await temporary.cleanup(); }
});

test("the Linux flock lock maps exit 0 to held, 75 to busy and anything else to a security failure", async () => {
  const spawnWith = (code: number): LockfSpawn => (executable, args, options) => {
    assert.equal(executable, "/usr/bin/flock");
    assert.deepEqual(args, ["--nonblock", "--conflict-exit-code", "75", "3"]);
    assert.equal(options.stdio[3], 9);
    const child = new EventEmitter() as EventEmitter & { kill(): boolean };
    child.kill = () => true;
    setImmediate(() => child.emit("close", code, null));
    return child as unknown as ReturnType<LockfSpawn>;
  };
  assert.equal(await new LinuxFlockLock(spawnWith(0)).tryAcquire(9), true);
  assert.equal(await new LinuxFlockLock(spawnWith(75)).tryAcquire(9), false);
  await assert.rejects(new LinuxFlockLock(spawnWith(1)).tryAcquire(9), { code: "APN_STATE_SECURITY" });
});

test("server-mode consent never opens a terminal and still refuses an expired screen", async () => {
  const never = async () => { throw new Error("terminal opened"); };
  await withEnv({ [SERVER_MODE_ENV]: "1" }, async () => {
    await exactChainConsent(["Agent Payment Node test"], "CODE", new Date(Date.now() + 60_000).toISOString(), { openTerminal: never });
    await assert.rejects(exactChainConsent(["x"], "CODE", new Date(Date.now() - 1).toISOString(), { openTerminal: never }),
      { code: "APN_NATIVE_REJECTED" });
  });
  await withEnv({ [SERVER_MODE_ENV]: undefined }, async () => {
    await assert.rejects(exactChainConsent(["x"], "CODE", new Date(Date.now() + 60_000).toISOString(), { openTerminal: never }),
      (error: { details?: { nativeCode?: string } }) => error.details?.nativeCode === "APN_TTY_UNAVAILABLE");
  });
});

test("one global policy file binds every profile to its own account with stable digests and refuses per-profile staging", async () => {
  const temporary = await temporaryState();
  try {
    await ensureWallet(makeCore({ root: temporary.root, native: new TestNative() }));
    const file = join(temporary.base, "global-policy.json");
    await writeFile(file, JSON.stringify({ schemaVersion: "apn.global-allowlist-policy.v1", overlayVersion: "server.1",
      effectiveAt: "2026-08-01T00:00:00.000Z", admissions: [{ chain: "eip155:8453", kind: "token", identifier: BASE_USDC, rail: "direct",
        maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "10000000" }] }), { mode: 0o600 });
    await withEnv({ [GLOBAL_POLICY_FILE_ENV]: file }, async () => {
      const first = await loadActiveAssetPolicyRegistry(temporary.root, "default", new Date("2026-11-09T00:00:00.000Z"));
      const second = await loadActiveAssetPolicyRegistry(temporary.root, "default", new Date("2026-11-09T00:00:00.000Z"));
      assert.ok(first !== null && second !== null);
      assert.equal(first.accounts.evm, WALLET);
      assert.equal(first.digest, second.digest);
      assert.equal(first.activationDigest, second.activationDigest);
      assert.equal(await loadActiveAssetPolicyRegistry(temporary.root, "no-wallet", new Date("2026-11-09T00:00:00.000Z")), null);
      await assert.rejects(new AllowlistPolicyStore(temporary.root).appendDecision("default", null, {} as never),
        { code: "APN_INVALID_INPUT" });
    });
  } finally { await temporary.cleanup(); }
});

test("server mode projects every command as a tool, and the OpenAI export drops the top-level oneOf", () => {
  const server = serverMcpTools();
  const names = new Set(server.map((tool) => tool.name));
  assert.ok(names.has("apn_pay_transfer_approve") && names.has("apn_bridge_approve") && names.has("apn_swap_solana_jupiter_execute"));
  for (const ownerOnly of ["apn_wallet_connect", "apn_allowlist_policy_activate", "apn_allowlist_policy_stage", "apn_wallet_policy_set",
    "apn_policy_admit_solana", "apn_policy_admit_tron"]) assert.equal(names.has(ownerOnly), false, ownerOnly);
  assert.equal(MCP_TOOLS.some((tool) => tool.name === "apn_pay_transfer_approve"), false);
  for (const tool of openAiTools(server)) {
    assert.equal(tool.type, "function");
    assert.equal("oneOf" in tool.function.parameters, false);
    assert.ok(tool.function.name.length <= 64);
  }
});
