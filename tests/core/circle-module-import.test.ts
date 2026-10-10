import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each child imports its requested internal module first: a normal-core pre-import
// would conceal the CircleRpc initialization cycle rather than test it.
for (const [path, symbol] of [
  ["circle-v2-evm/rpc.js", "CircleRpc"],
  ["circle-cleanup85-native-cancellation.js", "Cleanup85NativeCancellation"],
  ["cli.js", "runCli"],
  ["circle-v2-evm/cleanup85-recovery-runtime.js", "Cleanup85RecoveryRuntime"],
  ["circle-v2-evm/cleanup86-store.js", "Cleanup86Store"],
  ["circle-v2-evm/cleanup86-snapshot.js", "Cleanup86SnapshotStore"],
] as const) test(`fresh normal Node imports ${path} without a core-first shim`, async t => {
  const root = await mkdtemp(join(tmpdir(), "apn-circle-import-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const url = new URL("../../src/" + path, import.meta.url).href;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e",
    `const module = await import(${JSON.stringify(url)}); if (typeof module[${JSON.stringify(symbol)}] !== "function") throw new Error("expected export missing"); console.log("imported:" + ${JSON.stringify(symbol)});`,
  ], { cwd: root, env: { ...process.env, HOME: root }, encoding: "utf8", timeout: 15_000 });
  assert.equal(stdout.trim(), "imported:" + symbol);
  assert.deepEqual(await readdir(root), [], "module loading must not initialize local state");
});
