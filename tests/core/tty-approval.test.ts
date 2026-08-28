import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

test("real macOS PTY approval returns after one exact line without waiting for another byte", {
  skip: process.platform !== "darwin",
}, async () => {
  const result = await runPtyApproval({ input: `APPROVE APN TRANSFER ${"b".repeat(16)}\n` });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /APPROVAL_DONE/);
});

test("real macOS PTY timeout closes without a blocking character-device read", {
  skip: process.platform !== "darwin",
}, async () => {
  const result = await runPtyApproval({ deadlineMs: 25 });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /APPROVAL_ERROR:APN_APPROVAL_TIMEOUT/);
});

test("repeated real PTY approvals do not leak the original character-device descriptor", {
  skip: process.platform !== "darwin",
}, async () => {
  const result = await runPtyApproval({
    input: `APPROVE APN TRANSFER ${"b".repeat(16)}\n`,
    count: 8,
    warmup: true,
  });
  assert.equal(result.code, 0, result.stderr);
  const match = /FD_DELTA:(-?\d+)/.exec(result.stdout);
  assert.notEqual(match, null, result.stdout);
  assert.equal(Number(match?.[1]), 0, result.stdout);
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

async function runPtyApproval(options: {
  readonly input?: string;
  readonly deadlineMs?: number;
  readonly count?: number;
  readonly warmup?: boolean;
}): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const moduleUrl = new URL("../../src/tty-approval.js", import.meta.url).href;
  const source = `
    import { fstatSync } from "node:fs";
    import { TtyTransferApproval } from ${JSON.stringify(moduleUrl)};
    const openFdCount = () => {
      let count = 0;
      for (let fd = 0; fd < 256; fd += 1) {
        try { fstatSync(fd); count += 1; } catch { /* not open */ }
      }
      return count;
    };
    const intent = ${JSON.stringify(INTENT)};
    intent.expiresAt = new Date(Date.now() + 60_000).toISOString();
    if (${options.warmup === true}) {
      await new TtyTransferApproval({ deadlineMs: ${options.deadlineMs ?? 2_000} }).approve(intent);
    }
    const before = openFdCount();
    let outcome;
    try {
      for (let index = 0; index < ${options.count ?? 1}; index += 1) {
        await new TtyTransferApproval({ deadlineMs: ${options.deadlineMs ?? 2_000} }).approve(intent);
      }
      outcome = "\\nAPPROVAL_DONE\\n";
    } catch (error) {
      outcome = "\\nAPPROVAL_ERROR:" + String(error?.details?.nativeCode ?? "UNKNOWN") + "\\n";
    }
    const after = openFdCount();
    process.stdout.write(outcome + "FD_DELTA:" + String(after - before) + "\\n");
  `;
  const expectSource = `
    set timeout 3
    log_user 1
    spawn $env(APN_NODE_EXEC) --input-type=module -e $env(APN_NODE_SOURCE)
    if {$env(APN_SEND_INPUT) == "1"} {
      for {set index 0} {$index < $env(APN_APPROVAL_COUNT)} {incr index} {
        expect {
          -re {Type exactly:} { send -- $env(APN_INPUT); send -- "\\r" }
          timeout { exit 124 }
        }
      }
    }
    expect {
      eof { catch wait result; exit [lindex $result 3] }
      timeout { exit 124 }
    }
  `;
  const child = spawn("/usr/bin/expect", ["-c", expectSource], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      TERM: "xterm-256color",
      APN_NODE_EXEC: process.execPath,
      APN_NODE_SOURCE: source,
      APN_SEND_INPUT: options.input === undefined ? "0" : "1",
      APN_INPUT: options.input?.replace(/[\r\n]+$/, "") ?? "",
      APN_APPROVAL_COUNT: String((options.count ?? 1) + (options.warmup === true ? 1 : 0)),
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });

  const timeoutMs = 3_000;
  let timeout: NodeJS.Timeout | undefined;
  try {
    const [code] = await Promise.race([
      new Promise<[number | null]>((resolve, reject) => {
        child.once("close", (exitCode) => resolve([exitCode]));
        child.once("error", reject);
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
          reject(new Error(`PTY approval did not exit within ${timeoutMs}ms. stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`));
        }, timeoutMs);
      }),
    ]);
    return { code, stdout, stderr };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
