/**
 * QA F26 on the MetaMask native lane: the MetaMask request id the owner's pending MFA approval waits on is sealed, and
 * a new journal keeps only its hash. The no-send observer opens the seal before it reads the request; a seal that
 * cannot be opened refuses that read precisely and changes nothing. A journal 0.5.106 or earlier wrote keeps its
 * plaintext id and projects and observes exactly as before. The vendor read is a double; the Keychain is never touched.
 */
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test, { mock } from "node:test";
import { ApnError } from "../../src/errors.js";
import { MetaMaskNativeJournal, metaMaskNativeMfaTask, metaMaskNativeRequestIdHash, metaMaskNativeRequestReference,
  metaMaskNativeSealedMfaTask, patchMetaMaskNativeOperation as patch, publicMetaMaskNativeOperation as publicView,
  type MetaMaskNativeOperation } from "../../src/metamask-native-journal.js";
import type { MetaMaskNativeRequestObservation } from "../../src/metamask-native-transfer-adapter.js";
import { EncryptedProviderRequestReferenceStore, providerRequestReferenceHash } from "../../src/provider-request-reference-store.js";
import { temporaryState } from "./helpers.js";
import { ReferenceTestSecret, flipped, rewrite, stateFiles } from "./provider-request-reference-helpers.js";

const RID = "8cc50f3c-ca4e-41d1-98bb-b30f7bcaa3aa", EXPIRES = "2099-10-20T09:51:13.922Z";
const EVIDENCE = "8aeaabee731ce6e603fddc324702a37abb45dd59d434101acabfab015027d46a";
let reads: string[] = [];
let answer: MetaMaskNativeRequestObservation | undefined;
mock.module("../../src/metamask-native-transfer-adapter.js", { namedExports: {
  MetaMaskNativeHandoffNotStarted: class extends Error {},
  readMetaMaskNativeVendorPolicy: async () => { throw new Error("TEST no vendor policy read"); },
  submitOwnedMetaMaskNative: async () => { throw new Error("TEST no hand-off"); },
  readMetaMaskNativeRequest: async (requestId: string) => { reads.push(requestId); assert.ok(answer, "unexpected request read"); return answer; },
} });
const { readMetaMaskNativeTransfer } = await import("../../src/metamask-native-transfer-owner.js");

const legacy = JSON.parse(await readFile("tests/fixtures/legacy-corpus/44-v0543-metamask-native-driver-no-rid/metamask-native-operations/" +
  "dc9b7d038f702ce64c1a155d9649fc6f9d413410dce4946e7f6807f70f28c133.json", "utf8")) as MetaMaskNativeOperation;
const id = legacy.operationId, HASH = metaMaskNativeRequestIdHash(RID), observe = `apn wallet metamask native-transfer-observe --operation ${id}`;
const journalPath = (root: string) => join(root, "metamask-native-operations", `${id}.json`);
const sealedPath = (root: string) => join(root, "metamask-native-request-references", legacy.context.profileHash, `${id}.json`);
const observation = (status: "AWAITING_MFA" | "DENIED", verified: boolean) => Object.freeze({ stage: "complete" as const, guard_step: null, request_id: RID,
  watch_returned: true, before_guard_verified: true, after_guard_verified: true, request_identity_verified: verified, provider_status: status,
  transaction_hash: null, chain_id: null, response_hash: EVIDENCE, reason: null, error_code: null, diagnostic: null });
/** One field of a public view, read without asserting its shape. */
const at = (value: unknown, key: string): unknown => (value as Record<string, unknown> | undefined)?.[key];
const awaiting = (): MetaMaskNativeRequestObservation => ({ disposition: "pending", requestId: RID,
  mfa: { expiresAt: EXPIRES, authMethod: "social", evidenceHash: EVIDENCE }, readObservation: observation("AWAITING_MFA", false) });
const denied = (): MetaMaskNativeRequestObservation => ({ disposition: "unknown", reason: "provider_request_outcome_unknown", requestId: RID,
  readObservation: observation("DENIED", true) });

/** The transfer as a release after 0.5.106 leaves it after the hand-off: UNKNOWN, the request id sealed, its hash in the journal. */
async function sealedTransfer(root: string) {
  const secret = new ReferenceTestSecret(), references = new EncryptedProviderRequestReferenceStore({ root }, secret);
  const journal = new MetaMaskNativeJournal(root); await journal.initialize();
  assert.equal(HASH, providerRequestReferenceHash("metamask-agent-wallet", RID));
  await references.seal(metaMaskNativeRequestReference(legacy, HASH), RID);
  const op = await journal.persist(patch(legacy, { providerRequestIdHash: HASH }));
  return { secret, references, journal, op };
}

test("a sealed journal keeps only the hash; observe opens the id for the read and no file or output names it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  reads = []; answer = undefined;
  const { secret, references, op } = await sealedTransfer(temporary.root);
  assert.equal(op.providerRequestId, null); assert.equal(op.providerRequestIdHash, HASH);
  const status = await readMetaMaskNativeTransfer(temporary.root, id);
  assert.deepEqual(status.next_actions, [observe]); assert.equal(reads.length, 0);
  const loads = secret.loads;
  answer = awaiting();
  const pending = await readMetaMaskNativeTransfer(temporary.root, id, true, references);
  assert.deepEqual(reads, [RID], "the vendor read is handed the sealed id itself");
  assert.ok(secret.loads > loads, "the id was opened under the wrapping secret");
  assert.equal(pending.state, "unknown");
  assert.equal(pending.read_observation?.provider_status, "AWAITING_MFA");
  assert.equal(Object.hasOwn(pending.read_observation!, "request_id"), false);
  assert.equal(at(pending.read_observation, "request_id_hash"), HASH);
  const task = pending.mfa_task;
  assert.equal(Object.hasOwn(task!, "request_id"), false); assert.equal(at(task, "request_id_hash"), HASH);
  assert.equal(task?.owner_action, `Approve the MetaMask request of APN ${id} from the email registered to your MetaMask dashboard before ${EXPIRES}. ` +
    "APN never approves it for you and never sends again; then observe.");
  const saved = JSON.parse(await readFile(journalPath(temporary.root), "utf8")) as MetaMaskNativeOperation;
  assert.deepEqual(saved.mfaTask && Object.keys(saved.mfaTask).sort(), ["authMethod", "evidenceHash", "expiresAt", "observedAt", "requestIdHash", "source"]);
  answer = denied();
  const closed = await readMetaMaskNativeTransfer(temporary.root, id, true, references);
  assert.equal(closed.mfa_task, undefined, "the provider's own record past the approval drops the task");
  assert.match(closed.next_actions[0]!, new RegExp(`^MetaMask closed the request of APN ${id} as DENIED at its approval step`, "u"));
  for (const output of [status, pending, closed]) assert.equal(JSON.stringify(output).includes(RID), false);
  for (const [path, text] of await stateFiles(temporary.root)) assert.equal(text.includes(RID), false, `${path} keeps the request id in plaintext`);
  assert.equal(await references.open(metaMaskNativeRequestReference(op, HASH)), RID);
});

test("a seal that cannot be opened refuses the read precisely; nothing is read and the journal is unchanged", async (t) => {
  const corrupt = (reason: string) => (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT" && error.details?.reason === reason;
  const cases: ReadonlyArray<readonly [string, (root: string, secret: ReferenceTestSecret) => Promise<void>, (error: unknown) => boolean, boolean]> = [
    ["ciphertext changed", async (root) => { await rewrite(sealedPath(root), v => ({ ...v, cipher: { ...v.cipher, ciphertext: flipped(v.cipher.ciphertext) } })); },
      corrupt("provider_request_reference_unmatched"), true],
    ["sealed record missing", async (root) => { await rm(sealedPath(root)); },
      corrupt("provider_request_reference_unmatched"), true],
    ["wrapping secret gone", async (_root, secret) => { secret.secret = null; }, corrupt("wrapping_secret_missing"), true],
    ["Keychain refused", async (_root, secret) => { secret.failure = new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable."); },
      (error: unknown) => error instanceof ApnError && error.code === "APN_NATIVE_REJECTED", true],
    ["no reference store", async () => {}, (error: unknown) => error instanceof ApnError && error.code === "APN_INTERNAL", false],
  ];
  for (const [name, damage, expected, withStore] of cases) await t.test(name, async (sub) => {
    const temporary = await temporaryState(); sub.after(temporary.cleanup);
    reads = []; answer = awaiting();
    const { secret, references } = await sealedTransfer(temporary.root);
    await damage(temporary.root, secret);
    const before = await readFile(journalPath(temporary.root));
    await assert.rejects(readMetaMaskNativeTransfer(temporary.root, id, true, withStore ? references : undefined), expected);
    assert.deepEqual(reads, [], "no request is read without its own id");
    assert.deepEqual(await readFile(journalPath(temporary.root)), before, "the state never advances");
    // Status never opens the seal and still answers.
    const status = await readMetaMaskNativeTransfer(temporary.root, id);
    assert.equal(status.state, "unknown"); assert.deepEqual(status.next_actions, [observe]);
  });
});

test("a journal 0.5.106 or earlier wrote keeps its plaintext id: it projects and observes as before, needs no wrapping secret, and a read never rewrites it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  reads = []; answer = undefined;
  const journal = new MetaMaskNativeJournal(temporary.root); await journal.initialize();
  const task = metaMaskNativeMfaTask(RID, { expiresAt: EXPIRES, authMethod: "social", evidenceHash: EVIDENCE }, "send");
  const old = await journal.persist(patch(legacy, { providerRequestId: RID, mfaTask: task }));
  const bytes = await readFile(journalPath(temporary.root));
  const status = await readMetaMaskNativeTransfer(temporary.root, id);
  assert.deepEqual(status, publicView(old));
  assert.deepEqual(status.mfa_task, { status: "awaiting_owner", provider: "metamask-agent-wallet", provider_state: "AWAITING_MFA", request_id: RID,
    auth_method: "social", expires_at: EXPIRES, observed_at: task.observedAt, source: "send", evidence_hash: EVIDENCE,
    owner_action: `Approve MetaMask request ${RID} from the email registered to your MetaMask dashboard before ${EXPIRES}. APN never approves it for you and never sends again; then observe.`,
    observe_command: observe });
  assert.deepEqual(await readFile(journalPath(temporary.root)), bytes, "a status read never rewrites an earlier release's journal");
  // Observing it never reaches the wrapping secret: the id is the record's own.
  const secret = new ReferenceTestSecret(); secret.failure = new Error("TEST the Keychain must not be read");
  answer = awaiting();
  const observed = await readMetaMaskNativeTransfer(temporary.root, id, true, new EncryptedProviderRequestReferenceStore({ root: temporary.root }, secret));
  assert.deepEqual(reads, [RID]); assert.equal(secret.loads, 0);
  assert.equal(at(observed.read_observation, "request_id"), RID); assert.equal(Object.hasOwn(observed.read_observation!, "request_id_hash"), false);
  assert.equal(at(observed.mfa_task, "request_id"), RID);
  const after = await journal.read(id);
  assert.equal(after?.providerRequestId, RID); assert.equal(after?.providerRequestIdHash, undefined);
  assert.equal((after?.mfaTask as { readonly requestId?: unknown } | undefined)?.requestId, RID);
});

test("each stored shape keeps its own keys: mixed, malformed or rebound references never load", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { journal, op } = await sealedTransfer(temporary.root);
  const evidence = { expiresAt: EXPIRES, authMethod: "social", evidenceHash: EVIDENCE } as const;
  const bad: Parameters<typeof patch>[1][] = [
    { providerRequestId: RID },
    { providerRequestIdHash: "not-a-digest" },
    { mfaTask: metaMaskNativeMfaTask(RID, evidence, "watch") },
    { mfaTask: metaMaskNativeSealedMfaTask("f".repeat(64), evidence, "watch") },
  ];
  for (const fields of bad) await assert.rejects(journal.persist(patch(op, fields)), { code: "APN_STATE_CORRUPT" }, JSON.stringify(fields));
  await assert.rejects(journal.persist(patch(op, { providerRequestIdHash: "e".repeat(64) })), { code: "APN_OPERATION_BLOCKED" },
    "a sealed reference is never rebound");
  assert.deepEqual(await journal.read(id), op, "nothing was written");
  const plain = new MetaMaskNativeJournal(join(temporary.base, "plain"));
  await plain.initialize();
  const kept = await plain.persist(patch(legacy, { providerRequestId: RID }));
  await assert.rejects(plain.persist(patch(kept, { mfaTask: metaMaskNativeSealedMfaTask(HASH, evidence, "watch") })), { code: "APN_STATE_CORRUPT" });
  await assert.rejects(plain.persist(patch(legacy, { providerRequestIdHash: HASH, state: "prepared", effectAttempts: 0 })), { code: "APN_STATE_CORRUPT" });
});
