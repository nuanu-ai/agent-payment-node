/**
 * QA 0.5.52 METAMASK-NATIVE-MFA-GUIDANCE-001: live native transfer 189186… is UNKNOWN with effectAttempts 1, provider
 * request 8cc50f3c… and the hand-off diagnostic `sdk_send`/`ok`, while MetaMask waits for the owner's email approval of
 * that request. The journal keeps the verified approval as an MFA task beside (never instead of) the financial state, the
 * public view names it and the no-send observer, and every binding of the task to the record is checked on load.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MetaMaskNativeJournal, metaMaskNativeMfaTask, patchMetaMaskNativeOperation as patch, publicMetaMaskNativeOperation as publicView,
  type MetaMaskNativeOperation } from "../../src/metamask-native-journal.js";
import { temporaryState } from "./helpers.js";

const RID = "8cc50f3c-ca4e-41d1-98bb-b30f7bcaa3aa", EXPIRES = "2026-10-20T09:51:13.922Z";
const EVIDENCE = "8aeaabee731ce6e603fddc324702a37abb45dd59d434101acabfab015027d46a";
// The diagnostic the live hand-off stored (QA evidence mm-ethereum-native-usdc-transfer01).
const DIAGNOSTIC = { stage: "sdk_send", code: "ok", exitCode: 0, signal: null, durationMs: 3860, remainingMs: 25349, stderrClass: "unclassified", providerCode: "other" };
const legacy = JSON.parse(await readFile("tests/fixtures/legacy-corpus/44-v0543-metamask-native-driver-no-rid/metamask-native-operations/" +
  "dc9b7d038f702ce64c1a155d9649fc6f9d413410dce4946e7f6807f70f28c133.json", "utf8")) as MetaMaskNativeOperation;

test("the live shape keeps its MFA task beside UNKNOWN and shows the owner's approval and the no-send observer", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = new MetaMaskNativeJournal(temporary.root); await journal.initialize();
  const id = legacy.operationId, observe = `apn wallet metamask native-transfer-observe --operation ${id}`;
  // As 0.5.52 left it: UNKNOWN, the request id, no task. The observer is named; nothing else is claimed.
  const live = await journal.persist(patch(legacy, { providerRequestId: RID, diagnostic: DIAGNOSTIC as NonNullable<MetaMaskNativeOperation["diagnostic"]> }));
  const before = publicView(live, new Date("2026-10-20T09:45:00.000Z"));
  assert.equal(before.state, "unknown"); assert.equal(before.transaction_hash, null); assert.equal("mfa_task" in before, false); assert.deepEqual(before.next_actions, [observe]);
  const task = metaMaskNativeMfaTask(RID, { expiresAt: EXPIRES, authMethod: "social", evidenceHash: EVIDENCE }, "watch", new Date("2026-10-20T09:44:42.135Z"));
  const held = await journal.persist(patch(live, { mfaTask: task }));
  assert.deepEqual(await journal.read(id), held);
  const open = publicView(held, new Date("2026-10-20T09:45:00.000Z"));
  assert.equal(open.state, "unknown"); assert.equal(open.proof_class, "durable_public_state"); assert.equal(open.transaction_hash, null); assert.equal(open.effect_attempts, 1);
  assert.deepEqual(open.mfa_task, { status: "awaiting_owner", provider: "metamask-agent-wallet", provider_state: "AWAITING_MFA", request_id: RID, auth_method: "social",
    expires_at: EXPIRES, observed_at: "2026-10-20T09:44:42.135Z", source: "watch", evidence_hash: EVIDENCE,
    owner_action: `Approve MetaMask request ${RID} from the email registered to your MetaMask dashboard before ${EXPIRES}. APN never approves it for you and never sends again; then observe.`,
    observe_command: observe });
  assert.deepEqual(open.next_actions, [observe]);
  const late = publicView(held, new Date("2026-10-20T10:00:00.000Z"));
  assert.equal(late.mfa_task?.status, "expired"); assert.match(late.mfa_task!.owner_action, /stays UNKNOWN until the chain proves it/u); assert.equal(late.state, "unknown");
  // Gone once the provider's record is past the approval; kept, but not shown, after the owner's abandon.
  const cleared = await journal.persist(patch(held, { mfaTask: undefined }));
  assert.equal("mfaTask" in cleared, false); assert.deepEqual(await journal.read(id), cleared);
  const abandoned = await journal.persist(patch(held, { state: "abandoned_unknown" }));
  const resolved = publicView(abandoned);
  assert.equal("mfa_task" in resolved, false); assert.deepEqual(resolved.next_actions, []);
});

test("a task that is not this record's own pending approval never loads", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = new MetaMaskNativeJournal(temporary.root); await journal.initialize();
  const live = await journal.persist(patch(legacy, { providerRequestId: RID }));
  const task = metaMaskNativeMfaTask(RID, { expiresAt: EXPIRES, authMethod: "social", evidenceHash: EVIDENCE }, "send", new Date("2026-10-20T09:40:30.000Z"));
  const bad: Parameters<typeof patch>[1][] = [
    { mfaTask: { ...task, requestId: "another-request" } },
    { mfaTask: task, transactionHash: `0x${"e".repeat(64)}` },
    { mfaTask: task, state: "effect_started" },
    { mfaTask: task, providerRequestId: null },
    { mfaTask: { ...task, expiresAt: "tomorrow" } },
    { mfaTask: { ...task, authMethod: "Social Login" } },
    { mfaTask: { ...task, observedAt: "2026-10-01T00:00:00.000Z" } },
    { mfaTask: { ...task, source: "guess" as never } },
    { mfaTask: { ...task, evidenceHash: "not-a-digest" } },
    { mfaTask: { ...task, message: "Approval required" } as never },
  ];
  for (const fields of bad) await assert.rejects(journal.persist(patch(live, fields)), { code: "APN_STATE_CORRUPT" }, JSON.stringify(fields));
  assert.deepEqual(await journal.read(live.operationId), live, "nothing was written");
});
