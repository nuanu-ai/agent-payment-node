import { approvalCode } from "../../src/approval-code.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { exactChainConsent } from "../../src/tty-approval.js";
import { metaMaskGaslessApprovalPhrase, metaMaskGaslessApprovalSummary } from "../../src/metamask-gasless/approval.js";
import { TtyMetaMaskGaslessApproval } from "../../src/metamask-gasless/tty.js";
import { makeOperation } from "./metamask-gasless-journal-fixtures/factory.js";

function approvalInput() {
  const op = makeOperation("mm-tty", "mm-tty-1");
  return { operationId: op.operationId, fingerprint: op.fingerprint,
    exactPhrase: metaMaskGaslessApprovalPhrase(op),
    summary: { ...metaMaskGaslessApprovalSummary(op, Date.parse(op.intent.preparedAt)),
      expires_at: new Date(Date.now() + 60_000).toISOString() } };
}

test("MetaMask approval displays exact debit, fee, permission and the six-character code without private UUID", async () => {
  const input = approvalInput(), tty = terminal(`${input.exactPhrase}\n`);
  assert.match(input.exactPhrase, /^[0-9a-f]{6}$/u);
  assert.equal(await new TtyMetaMaskGaslessApproval({ openTerminal: async () => tty.port,
    isTerminal: () => true }).confirm(input), true);
  for (const text of ["Total sender debit: 10 USDC (10000000 atomic)",
    "Recipient receives: 9.95 USDC (9950000 atomic)", "Exact fee: 0.05 USDC (50000 atomic)",
    "Your fee ceiling: 0.05 USDC", "Your minimum receipt: 9.95 USDC", "without an onchain expiry",
    "Timeout, revert or later expiry does not revoke it", "exact address pending independent transaction evidence",
    "Type " + input.exactPhrase + " and press Enter to confirm."]) assert.ok(tty.output().includes(text), text);
  assert.equal(tty.output().includes("12345678-1234-4234-8234-123456789abc"), false);
  assert.equal(tty.closes(), 1);
});

test("MetaMask approval refuses missing identity, altered fingerprint, trailing space and over-bound input", async () => {
  const input = approvalInput();
  for (const supplied of [approvalCode("gasless", input.fingerprint), input.exactPhrase.slice(0, -1) + (input.exactPhrase.endsWith("f") ? "e" : "f"),
    input.exactPhrase + " ", "a".repeat(257), input.exactPhrase + "\r"]) {
    assert.notEqual(supplied, input.exactPhrase);
    const tty = terminal(supplied + "\n");
    assert.equal(await new TtyMetaMaskGaslessApproval({ openTerminal: async () => tty.port,
      isTerminal: () => true }).confirm(input), false);
    assert.equal(tty.closes(), 1);
  }
});

test("shared approval keeps the legacy 128-byte bound unless explicitly widened", async () => {
  const input = approvalInput(), longPhrase = "a".repeat(129), tty = terminal(longPhrase + "\n");
  await assert.rejects(exactChainConsent([], longPhrase, input.summary.expires_at,
    { openTerminal: async () => tty.port, isTerminal: () => true }),
  { code: "APN_NATIVE_REJECTED", details: { nativeCode: "APN_APPROVAL_REFUSED" } });
  assert.equal(tty.closes(), 1);
});

test("MetaMask missing TTY is a bounded approval error", async () => {
  await assert.rejects(new TtyMetaMaskGaslessApproval({ openTerminal: async () => {
    throw new Error("private_terminal_canary");
  } }).confirm(approvalInput()), error => {
    assert.equal(String(error).includes("private_terminal_canary"), false);
    assert.equal((error as { details?: { reason?: string } }).details?.reason, "mm_gasless_approval");
    return true;
  });
});

test("actual macOS PTY accepts the full MetaMask phrase and exits after one line", {
  skip: process.platform !== "darwin",
}, async () => {
  const result = await runPty(approvalInput());
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /MM_APPROVAL_RESULT:true/u);
});

test("actual macOS PTY rejects a shortened MetaMask phrase without requesting another line", {
  skip: process.platform !== "darwin",
}, async () => {
  const input = approvalInput();
  const result = await runPty(input, input.exactPhrase.slice(0, -1));
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /MM_APPROVAL_RESULT:false/u);
});

function terminal(input: string) {
  let output = "", closes = 0;
  return { port: { fd: 42, write: async (text: string) => { output += text; },
    read: async function* () { yield Buffer.from(input, "ascii"); }, close: async () => { closes++; } },
  output: () => output, closes: () => closes };
}

async function runPty(input: ReturnType<typeof approvalInput>, phrase = input.exactPhrase) {
  const source = `import { TtyMetaMaskGaslessApproval } from ${JSON.stringify(new URL(
    "../../src/metamask-gasless/tty.js", import.meta.url).href)};
    const input = ${JSON.stringify(input)};
    input.summary.expires_at = new Date(Date.now() + 60_000).toISOString();
    const result = await new TtyMetaMaskGaslessApproval({ deadlineMs: 3000 }).confirm(input);
    process.stdout.write("\\nMM_APPROVAL_RESULT:" + result + "\\n");`;
  const script = `set timeout 5
    log_user 1
    spawn $env(APN_NODE_EXEC) --input-type=module -e $env(APN_NODE_SOURCE)
    expect {
      -re {press Enter to confirm} { send -- $env(APN_INPUT); send -- "\\r" }
      timeout { exit 124 }
    }
    expect {
      eof { catch wait result; exit [lindex $result 3] }
      timeout { exit 124 }
    }`;
  const child = spawn("/usr/bin/expect", ["-c", script], { detached: true,
    stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", LANG: "C", TERM: "xterm-256color",
      APN_NODE_EXEC: process.execPath, APN_NODE_SOURCE: source, APN_INPUT: phrase } });
  let output = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (text: string) => { output += text; });
  child.stderr.on("data", (text: string) => { output += text; });
  return await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      reject(new Error("MetaMask PTY did not exit within 6 seconds: " + output));
    }, 6000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); resolve({ code, output }); });
  });
}
