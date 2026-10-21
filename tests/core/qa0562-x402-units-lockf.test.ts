import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { COMMAND_MANIFEST } from "../../src/command-catalog.js";
import { renderHelp } from "../../src/command-help.js";
import { MacosAdvisoryLock, type LockfChild } from "../../src/macos-advisory-lock.js";

/** QA 0.5.62: generic x402 caps are the selected asset's atomic units; a slow lockf helper on a loaded Mac still locks. */
test("generic x402 caps say atomic in Usage, in their own Options line and in the manifest type", () => {
  const cases: Array<[readonly string[], string]> = [
    [["x402", "fetch", "prepare"], "--max-amount-atomic"],
    [["wallet", "policy", "set"], "--max-balance-usdc-atomic"],
    [["wallet", "policy", "set"], "--max-x402-amount-atomic"],
  ];
  for (const [path, name] of cases) {
    const help = renderHelp(path), usage = help.split("\n").find(line => line.includes(`apn ${path.join(" ")} `)) ?? "";
    assert.match(usage, new RegExp(`${name} <atomic>`, "u"), `${path.join(" ")} usage`);
    const optionLine = help.split("\n").find(line => line.trimStart().startsWith(`${name} <`));
    assert.match(optionLine ?? "", new RegExp(`^\\s+${name} <atomic>`, "u"), `${path.join(" ")} ${name} options line`);
    const command = COMMAND_MANIFEST.commands.find(entry => entry.path.join(" ") === path.join(" "));
    assert.equal(command?.options.find(option => option.name === name)?.type, "atomic", `${path.join(" ")} ${name} manifest`);
  }
  // USDC-only amounts keep their USDC unit.
  const stargate = COMMAND_MANIFEST.commands.find(entry => entry.path.join(" ") === "stargate token prepare");
  assert.equal(stargate?.options.find(option => option.name === "--amount-atomic")?.type, "atomic_usdc");
});

test("a lockf helper that answers after more than a second still takes the lock; one that never answers still fails closed", async () => {
  const slow = new MacosAdvisoryLock({ spawnLockf: () => child(1_500, 0) });
  assert.equal(await slow.tryAcquire(7), true);
  let killed = false;
  const silent = new MacosAdvisoryLock({ spawnLockf: () => child(null, null, () => { killed = true; }), timeoutMs: 20 });
  await assert.rejects(silent.tryAcquire(7), /could not be acquired safely/u);
  assert.equal(killed, true);
  assert.throws(() => new MacosAdvisoryLock({ timeoutMs: 5_001 }), /could not be acquired safely/u, "the bound itself stays capped");
});

function child(afterMs: number | null, code: number | null, onKill: () => void = () => undefined): LockfChild {
  const emitter = new EventEmitter() as EventEmitter & { kill(signal: "SIGKILL"): boolean };
  emitter.kill = () => { onKill(); return true; };
  if (afterMs !== null) setTimeout(() => emitter.emit("close", code, null), afterMs);
  return emitter as unknown as LockfChild;
}
