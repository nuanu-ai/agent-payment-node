import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { temporaryState } from "./helpers.js";
function run(mode: string, root: string) {
  const worker = fileURLToPath(new URL("./base-native-public-recovery-worker.js", import.meta.url));
  const script = `set timeout 30
log_user 1
spawn $env(APN_NODE_EXEC) $env(APN_WORKER) $env(APN_MODE) $env(APN_TEST_ROOT)
expect {
  -re {Type ([a-f0-9]{6}) and press Enter to confirm} {
    if {$env(APN_MODE) eq "genuine-decline"} {send -- "decline\r"} else {send -- "$expect_out(1,string)\r"}
    exp_continue
  }
  eof {catch wait result; exit [lindex $result 3]}
  timeout {exit 124}
}`;
  return spawnSync("/usr/bin/expect", ["-c", script], { encoding: "utf8", timeout: 40000,
    env: { PATH: "/usr/bin:/bin", LANG: "C", TERM: "xterm-256color", APN_NODE_EXEC: process.execPath, APN_WORKER: worker, APN_MODE: mode, APN_TEST_ROOT: root } });
}
for (const mode of ["fresh", "old-attempt-signed", "old-intent-mutation", "signed", "unknown", "lost-response", "generic-started", "receipt-mismatch", "missing-old", "tamper", "custody-change", "before-public", "dispatch-custody-change", "forged-attestation", "clone-wrong-op", "clone-wrong-wallet", "verification-race", "old-awaiting", "old-awaiting-generic", "dispatch-verification-race", "attempt-awaiting-generic"]) test(`genuine TTY ${mode}: recovery cannot decrypt, sign or send and retains nonce`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const result = run(mode, temp.root);
  assert.equal(result.status, 0, result.stdout+result.stderr); assert.match(result.stdout, /RESULT:/);
});
for (const [mode, exit] of [["crash-marked", 77], ["crash-signed", 78], ["crash-approval-started", 79]] as const) test(`${mode}: actual process loss retains effect or marker and restart observes only`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const crashed = run(mode, temp.root);
  assert.equal(crashed.status, exit, crashed.stdout+crashed.stderr);
  const resumed = run(`restart-${mode}`, temp.root); assert.equal(resumed.status, 0, resumed.stdout+resumed.stderr); assert.match(resumed.stdout, /"recoveryKeyLoads":0/);
});

test("genuine TTY decline persists Native no-private-entry outcome and reopens as one safe terminal recovery", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); const result = run("genuine-decline", temp.root);
  assert.equal(result.status, 0, result.stdout+result.stderr);
  assert.match(result.stdout, /"recoveryKeyLoads":0/); assert.match(result.stdout, /"state":"failed_before_effect"/);
});
