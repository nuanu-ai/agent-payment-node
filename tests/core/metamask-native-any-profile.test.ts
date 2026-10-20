import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * MM-NATIVE-001..005 for any profile (OWNR-23): a profile that is not the owner's, with its own MetaMask Agent Wallet,
 * recipient and amount, through the real `runCli` path in a pseudo-terminal. The driver fakes only the vendor child
 * process and the JSON-RPC chain; consent is typed at the real foreground prompt. `mfa`: QA 0.5.52
 * METAMASK-NATIVE-MFA-GUIDANCE-001, a Guard that waits for the owner's approval (the driver documents the vendor bytes).
 */
const SCENARIOS: Readonly<Record<string, number>> = { positive: 2, pinned: 1, "guard-refused": 0, refusals: 0, mfa: 2 };
const PTY = `import os, pty, select, signal, sys
pid, master = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
def stop(signum, frame):
    os.kill(pid, signal.SIGHUP)
signal.signal(signal.SIGTERM, stop)
while True:
    ready, _, _ = select.select([master, 0], [], [])
    if master in ready:
        try: data = os.read(master, 65536)
        except OSError: break
        if not data: break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if data: os.write(master, data)
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;
for (const [scenario, prompts] of Object.entries(SCENARIOS)) test(`any profile ${scenario}: CLI argv to vendor hand-off, receipt and ledger`, { timeout: 60000 }, async () => {
  const driver = fileURLToPath(new URL("../fixtures/metamask-native-owner/any-profile-driver.mjs", import.meta.url));
  const source = fileURLToPath(new URL("../../src/", import.meta.url));
  const child = spawn("python3", ["-c", PTY, process.execPath, "--experimental-test-module-mocks", driver, source, scenario], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  const answered = new Set<string>();
  const done = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  const collect = (data: Buffer) => {
    output += data.toString();
    for (const match of output.matchAll(/Type ([^\r\n]+) and press Enter to confirm\./gu)) {
      if (!answered.has(match[1]!)) { answered.add(match[1]!); child.stdin.write(`${match[1]}\n`); }
    }
  };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  const deadline = setTimeout(() => child.kill("SIGTERM"), 55000);
  try {
    assert.equal(await done, 0, output);
    assert.match(output, new RegExp(`TEST_ANY_PROFILE_${scenario.toUpperCase()}_OK`, "u"));
    assert.equal(answered.size, prompts, output);
    if (prompts > 0) assert.match(output, /Recipient: 0x[0-9a-fA-F]{40}\r?\nAmount: [0-9]+ atomic USDC \([0-9.]+ USDC\)/u);
  } finally { clearTimeout(deadline); child.stdin.destroy(); }
});
