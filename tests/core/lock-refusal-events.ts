import type { TestContext } from "node:test";
import { MacosAdvisoryLock } from "../../src/macos-advisory-lock.js";
import { SecureStateStore } from "../../src/secure-state-store.js";

/**
 * Events, not sleeps, for lock-order tests (a fixed pause once failed a BRDG-35 test under a loaded full suite): the kernel
 * advisory lock reports each attempt it refused while a state lock of a key was being acquired, so a test waits until the
 * contender is seen blocked by the very lock its holder keeps, then acts. Register `refused` before starting the contender.
 */
export function lockRefusals(t: TestContext): { refused(key?: string): Promise<void> } {
  const acquiring = new Map<string, number>(), waiters: Array<{ readonly key: string | undefined; readonly resolve: () => void }> = [];
  const prototype = SecureStateStore.prototype as unknown as { acquireLock(key: string, ...rest: unknown[]): Promise<unknown> };
  const acquire = prototype.acquireLock, attempt = MacosAdvisoryLock.prototype.tryAcquire;
  t.mock.method(prototype, "acquireLock", async function (this: unknown, key: string, ...rest: unknown[]) {
    acquiring.set(key, (acquiring.get(key) ?? 0) + 1);
    try { return await acquire.call(this, key, ...rest); } finally { acquiring.set(key, acquiring.get(key)! - 1); }
  });
  t.mock.method(MacosAdvisoryLock.prototype, "tryAcquire", async function (this: MacosAdvisoryLock, ...args: Parameters<MacosAdvisoryLock["tryAcquire"]>) {
    const acquired = await attempt.apply(this, args);
    if (!acquired) for (const waiter of [...waiters]) {
      if (waiter.key !== undefined && (acquiring.get(waiter.key) ?? 0) === 0) continue;
      waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve();
    }
    return acquired;
  });
  return { refused: (key) => new Promise<void>((resolve) => { waiters.push({ key, resolve }); }) };
}
