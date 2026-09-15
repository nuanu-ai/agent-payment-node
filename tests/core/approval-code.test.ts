import assert from "node:assert/strict";
import test from "node:test";
import { approvalCode } from "../../src/approval-code.js";
import { operationAbandonPhrase } from "../../src/operation-abandon-approval.js";
import { profilePolicyApprovalPhrase } from "../../src/policy-approval.js";
import { exactChainConsent, transferApprovalPhrase } from "../../src/tty-approval.js";

const FINGERPRINT = "c".repeat(64);

test("approval codes are six hexadecimal characters bound to the action and the full fingerprint", () => {
  const code = approvalCode("transfer", FINGERPRINT);
  assert.match(code, /^[0-9a-f]{6}$/u);
  assert.equal(approvalCode("transfer", FINGERPRINT), code);
  for (const other of [approvalCode("abandon", FINGERPRINT), approvalCode("policy", FINGERPRINT), approvalCode("bridge", FINGERPRINT),
    approvalCode("transfer", `d${FINGERPRINT.slice(1)}`), approvalCode("gasless", "0".repeat(64), FINGERPRINT)]) assert.notEqual(other, code);
  assert.notEqual(approvalCode("gasless", "0".repeat(64), FINGERPRINT), approvalCode("gasless", FINGERPRINT));
  assert.equal(transferApprovalPhrase(FINGERPRINT), code);
  assert.equal(profilePolicyApprovalPhrase(FINGERPRINT), approvalCode("policy", FINGERPRINT));
  assert.equal(operationAbandonPhrase(FINGERPRINT), approvalCode("abandon", FINGERPRINT));
});

test("the terminal asks for the code and refuses the former long phrase, a prefix and trailing space", async () => {
  const code = transferApprovalPhrase(FINGERPRINT);
  const cases = [[code, true], [`APPROVE APN TRANSFER ${FINGERPRINT.slice(-16)}`, false], [code.slice(0, 5), false], [`${code} `, false]] as const;
  for (const [supplied, accepted] of cases) {
    let printed = "", closed = 0;
    const consent = exactChainConsent(["Agent Payment Node test approval"], code, new Date(Date.now() + 60_000).toISOString(), {
      isTerminal: () => true,
      openTerminal: async () => ({ fd: 11, write: async (text: string) => { printed += text; },
        read: async function* () { yield Buffer.from(`${supplied}\n`); }, close: async () => { closed += 1; } }),
    });
    if (accepted) await consent;
    else await assert.rejects(consent, { code: "APN_NATIVE_REJECTED", details: { nativeCode: "APN_APPROVAL_REFUSED" } });
    assert.ok(printed.includes(`Type ${code} and press Enter to confirm.`), printed);
    assert.equal(printed.includes("Type exactly"), false);
    assert.equal(closed, 1);
  }
});
