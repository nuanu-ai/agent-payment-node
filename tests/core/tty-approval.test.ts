import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import type { Address } from "../../src/model.js";
import {
  TTY_APPROVAL_DEADLINE_MS,
  TtyTransferApproval,
  type TransferApprovalIntent,
} from "../../src/tty-approval.js";

const INTENT: TransferApprovalIntent = {
  profile: "default",
  operationId: "a".repeat(64),
  fingerprint: "b".repeat(64),
  walletAddress: "0x1111111111111111111111111111111111111111" as Address,
  recipient: "0x2222222222222222222222222222222222222222" as Address,
  amountAtomic: "10000",
  amountDecimal: "0.01",
  nonceAtomic: "1",
  gasLimitAtomic: "65000",
  maxFeePerGasAtomic: "2000000000",
  maxPriorityFeePerGasAtomic: "1000000000",
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
};

test("TTY approval has an explicit 60-second production deadline", () => {
  assert.equal(TTY_APPROVAL_DEADLINE_MS, 60_000);
});

test("TTY approval timeout aborts pending input and closes the terminal", async () => {
  let closed = 0;
  const approval = new TtyTransferApproval({
    deadlineMs: 5,
    isTerminal: () => true,
    openTerminal: async () => ({
      fd: 123,
      write: async () => undefined,
      read: waitForAbort,
      close: async () => { closed += 1; },
    }),
  });

  await assert.rejects(approval.approve(INTENT), (error: unknown) => {
    assert.equal((error as ApnError).details?.nativeCode, "APN_APPROVAL_TIMEOUT");
    return true;
  });
  assert.equal(closed, 1);
});

test("TTY approval external abort unwinds normally and closes the terminal", async () => {
  const controller = new AbortController();
  let closed = 0;
  const approval = new TtyTransferApproval({
    signal: controller.signal,
    isTerminal: () => true,
    openTerminal: async () => ({
      fd: 123,
      write: async () => undefined,
      read: waitForAbort,
      close: async () => { closed += 1; },
    }),
  });
  setTimeout(() => controller.abort(), 0);

  await assert.rejects(approval.approve(INTENT), (error: unknown) => {
    assert.equal((error as ApnError).details?.nativeCode, "APN_APPROVAL_ABORTED");
    return true;
  });
  assert.equal(closed, 1);
});

test("TTY input errors fail closed and close the terminal", async () => {
  let closed = 0;
  const approval = new TtyTransferApproval({
    isTerminal: () => true,
    openTerminal: async () => ({
      fd: 123,
      write: async () => undefined,
      read: async function* () { throw new Error("terminal input failed"); },
      close: async () => { closed += 1; },
    }),
  });

  await assert.rejects(approval.approve(INTENT), (error: unknown) => {
    assert.equal((error as ApnError).details?.nativeCode, "APN_APPROVAL_ABORTED");
    assert.equal(String(error).includes("terminal input failed"), false);
    return true;
  });
  assert.equal(closed, 1);
});

async function* waitForAbort(signal: AbortSignal): AsyncGenerator<Uint8Array> {
  await new Promise<void>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}
