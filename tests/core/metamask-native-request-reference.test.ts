/**
 * QA F26 on the MetaMask native lane: the MetaMask request id the owner's pending MFA approval waits on is sealed, and
 * a new journal keeps only its hash. The no-send observer opens the seal before it reads the request; a seal that
 * cannot be opened refuses that read precisely and changes nothing. A journal 0.5.106 or earlier wrote keeps its
 * plaintext id and projects and observes exactly as before; one 0.5.107 wrote after a seal that failed keeps loading as
 * it was. From 0.5.108 the effect marker names the sealed id's hash and the helper path, and observe reads that request
 * from MetaMask's server, never through an mm watch. The vendor reads are doubles; the Keychain is never touched.
 * Nothing here imports helpers.ts: it loads src/core.js, and with it the real vendor adapter, before the adapter mock
 * below could take its place.
 */
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test, { mock } from "node:test";
import { ApnError } from "../../src/errors.js";
import type { MetaMaskNativeDiagnostic } from "../../src/metamask-native-diagnostic.js";
import { MetaMaskNativeJournal, metaMaskNativeMfaTask, metaMaskNativeRequestIdHash, metaMaskNativeRequestReference,
  metaMaskNativeSealedMfaTask, patchMetaMaskNativeOperation as patch, publicMetaMaskNativeOperation as publicView,
  type MetaMaskNativeOperation } from "../../src/metamask-native-journal.js";
import { metaMaskNativeHandoffFields } from "../../src/metamask-native-request-reference.js";
import type { MetaMaskNativeRequestObservation, MetaMaskNativeSubmission } from "../../src/metamask-native-transfer-adapter.js";
import { EncryptedProviderRequestReferenceStore, providerRequestReferenceHash,
  type ProviderRequestReferencePort } from "../../src/provider-request-reference-store.js";
import { ReferenceTestSecret, flipped, referenceTemporaryState as temporaryState, rewrite,
  stateFiles } from "./provider-request-reference-helpers.js";

const RID = "8cc50f3c-ca4e-41d1-98bb-b30f7bcaa3aa", EXPIRES = "2099-10-20T09:51:13.922Z";
const EVIDENCE = "8aeaabee731ce6e603fddc324702a37abb45dd59d434101acabfab015027d46a";
let reads: string[] = [], serverReads: string[] = [];
let answer: MetaMaskNativeRequestObservation | undefined;
mock.module("../../src/metamask-native-transfer-adapter.js", { namedExports: {
  MetaMaskNativeHandoffNotStarted: class extends Error {},
  readMetaMaskNativeVendorPolicy: async () => { throw new Error("TEST no vendor policy read"); },
  submitOwnedMetaMaskNative: async () => { throw new Error("TEST no hand-off"); },
  // The watch-first read of a request mm sent (0.5.107 and earlier), and the server read of one APN sent (0.5.108).
  readMetaMaskNativeRequest: async (requestId: string) => { reads.push(requestId); assert.ok(answer, "unexpected request read"); return answer; },
  readMetaMaskNativeSdkRequest: async (requestId: string) => { serverReads.push(requestId); assert.ok(answer, "unexpected server read"); return answer; },
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

test("a record 0.5.107 wrote after its seal failed keeps loading as written and never gains a request", async (t) => {
  const DIAGNOSTIC: MetaMaskNativeDiagnostic = { stage: "sdk_send", code: "ok", exitCode: 0, signal: null, durationMs: 3860, remainingMs: 25349,
    stderrClass: "unclassified", providerCode: "other" };
  const TX = `0x${"e".repeat(64)}` as const, mfa = { expiresAt: EXPIRES, authMethod: "social", evidenceHash: EVIDENCE };
  const failing: ProviderRequestReferencePort = { ready: async () => {}, open: async () => assert.fail("no sealed id to open"),
    seal: async () => assert.fail("nothing is sealed again") };
  for (const hash of [null, TX] as const) await t.test(hash === null ? "no transaction hash" : "a transaction hash", async (sub) => {
    const temporary = await temporaryState(); sub.after(temporary.cleanup);
    reads = []; serverReads = []; answer = undefined;
    const journal = new MetaMaskNativeJournal(temporary.root); await journal.initialize();
    // What 0.5.107 persisted when the seal after the hand-off failed: UNKNOWN, no id, no hash, the reason.
    const op = await journal.persist(patch(legacy, { state: "unknown", transactionHash: hash, providerRequestId: null, diagnostic: DIAGNOSTIC,
      providerRequestReason: "provider_request_reference_unsealed" }));
    assert.deepEqual(await journal.read(id), op);
    const status = await readMetaMaskNativeTransfer(temporary.root, id);
    assert.equal(status.provider_request_reason, "provider_request_reference_unsealed"); assert.equal(status.transaction_hash, hash);
    assert.deepEqual(status.next_actions, hash === null ? [] : [observe], "only a kept transaction hash can still be observed");
    if (hash === null) {
      const observed = await readMetaMaskNativeTransfer(temporary.root, id, true, failing);
      assert.equal(observed.read_observation?.stage, "not_requested");
      assert.equal(observed.read_observation?.reason, "provider_request_reference_unsealed"); assert.deepEqual([reads, serverReads], [[], []]);
    }
    // A record that dropped its request id never gains a hash, a helper path or an MFA task afterwards.
    await assert.rejects(journal.persist(patch(op, { providerRequestIdHash: HASH })), { code: "APN_STATE_CORRUPT" });
    await assert.rejects(journal.persist(patch(op, { providerRequestIdHash: HASH, providerRequestReason: undefined as never, handoffPath: "sdk_helper" })),
      { code: "APN_OPERATION_BLOCKED" });
    await assert.rejects(journal.persist(patch(op, { mfaTask: metaMaskNativeSealedMfaTask(HASH, mfa, "watch") })), { code: "APN_STATE_CORRUPT" });
  });
});

/** The transfer as 0.5.108 leaves it: the id sealed, and the effect marker naming its hash and the helper path. */
async function helperTransfer(root: string, state: "effect_started" | "unknown" = "unknown") {
  const secret = new ReferenceTestSecret(), references = new EncryptedProviderRequestReferenceStore({ root }, secret);
  const journal = new MetaMaskNativeJournal(root); await journal.initialize();
  await references.seal(metaMaskNativeRequestReference(legacy, HASH), RID);
  const op = await journal.persist(patch(legacy, { state, providerRequestIdHash: HASH, handoffPath: "sdk_helper" }));
  return { secret, references, journal, op };
}

test("a request APN sent itself is observed from MetaMask's server by its sealed id, never through an mm watch", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  reads = []; serverReads = []; answer = awaiting();
  const { references, journal } = await helperTransfer(temporary.root);
  const pending = await readMetaMaskNativeTransfer(temporary.root, id, true, references);
  assert.deepEqual([serverReads, reads], [[RID], []], "the server is read by the sealed id; no watch runs");
  assert.equal(pending.mfa_task?.source, "watch"); assert.equal(at(pending.mfa_task, "request_id_hash"), HASH);
  assert.equal(at(pending.read_observation, "request_id_hash"), HASH); assert.equal(JSON.stringify(pending).includes(RID), false);
  answer = denied();
  const closed = await readMetaMaskNativeTransfer(temporary.root, id, true, references);
  assert.equal(closed.mfa_task, undefined); assert.match(closed.next_actions[0]!, new RegExp(`^MetaMask closed the request of APN ${id} as DENIED`, "u"));
  assert.equal((await journal.read(id))?.handoffPath, "sdk_helper", "the path stays as the marker wrote it");
  for (const [path, text] of await stateFiles(temporary.root)) assert.equal(text.includes(RID), false, `${path} keeps the request id in plaintext`);
  // A command that ended at its marker still names its request: the observer is the next step.
  const started = await temporaryState(); t.after(started.cleanup);
  await helperTransfer(started.root, "effect_started");
  assert.deepEqual((await readMetaMaskNativeTransfer(started.root, id)).next_actions, [observe]);
});

test("the helper path is bound to the marker: it needs a sealed hash, never changes and never appears later", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { journal, op } = await helperTransfer(temporary.root);
  const bad: Parameters<typeof patch>[1][] = [
    { handoffPath: "mm_cli" as never }, { providerRequestReason: "provider_request_reference_unsealed" }, { providerRequestId: RID },
  ];
  for (const fields of bad) await assert.rejects(journal.persist(patch(op, fields)), { code: "APN_STATE_CORRUPT" }, JSON.stringify(fields));
  await assert.rejects(journal.persist(patch(op, { handoffPath: undefined as never })), { code: "APN_OPERATION_BLOCKED" }, "the path never leaves");
  assert.deepEqual(await journal.read(id), op);
  const plain = new MetaMaskNativeJournal(join(temporary.base, "plain")); await plain.initialize();
  await assert.rejects(plain.persist(patch(legacy, { handoffPath: "sdk_helper" })), { code: "APN_STATE_CORRUPT" }, "no path without a sealed hash");
  await assert.rejects(plain.persist(patch(legacy, { handoffPath: "sdk_helper", providerRequestIdHash: HASH, state: "prepared", effectAttempts: 0 })),
    { code: "APN_STATE_CORRUPT" }, "no path before the effect marker");
  const sealed = await plain.persist(patch(legacy, { providerRequestIdHash: HASH }));
  await assert.rejects(plain.persist(patch(sealed, { handoffPath: "sdk_helper" })), { code: "APN_OPERATION_BLOCKED" }, "a 0.5.107 record never gains it");
});

test("the hand-off's outcome keeps the marker's request and adds only its state, hash, diagnostic and the owner's task", () => {
  const DIAGNOSTIC: MetaMaskNativeDiagnostic = { stage: "sdk_send", code: "ok", exitCode: 0, signal: null, durationMs: 120, remainingMs: 41000,
    stderrClass: "none", providerCode: "none" };
  const TX = `0x${"e".repeat(64)}` as const, mfa = { expiresAt: EXPIRES, authMethod: "qr", evidenceHash: EVIDENCE };
  const results: ReadonlyArray<readonly [MetaMaskNativeSubmission, Record<string, unknown>]> = [
    [{ disposition: "acknowledged", transactionHash: TX, diagnostic: DIAGNOSTIC }, { diagnostic: DIAGNOSTIC, state: "acknowledged", transactionHash: TX }],
    [{ disposition: "pending", mfa }, { state: "unknown", transactionHash: null, mfaTask: { requestIdHash: HASH, expiresAt: EXPIRES, authMethod: "qr",
      source: "send", evidenceHash: EVIDENCE } }],
    [{ disposition: "pending" }, { state: "unknown", transactionHash: null }],
    [{ disposition: "unknown", reason: "provider_request_closed", transactionHash: TX }, { state: "unknown", transactionHash: TX }],
  ];
  for (const [result, expected] of results) {
    const fields = metaMaskNativeHandoffFields(result, HASH) as Record<string, unknown>;
    const task = fields.mfaTask as Record<string, unknown> | undefined;
    if (task !== undefined) assert.ok(typeof task.observedAt === "string");
    assert.deepEqual(task === undefined ? fields : { ...fields, mfaTask: (({ observedAt: _at, ...rest }) => rest)(task) }, expected, result.disposition);
  }
});
