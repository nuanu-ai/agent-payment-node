/**
 * 0.5.109, QA's open item "Сохранение ID для revoke": `apn gasless transfer revoke` named its MetaMask request id, sent
 * it once and kept it nowhere, so after a `pending` or `unknown` answer nobody could read that request again. Now the id
 * is sealed (provider-request-reference-store.ts, lane `metamask-revocation`, one record per request) after the wallet's
 * own check and before the helper starts; a request whose helper provably stopped before any network call has its seal
 * removed again. `operation resume` keeps its chain reads, then lists the sealed requests newest first and opens the ids
 * of the newest 16 under the operation lock, and reads MetaMask's status of each by its id after that lock is released,
 * under the provider-session lock. Status, receipts and abandonment never open a sealed id. The `mm` reads and the
 * helper are doubles; the store is the real one under a synthetic wrapping secret.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { MetaMaskGaslessProviderClient } from "../../src/metamask-gasless/client/index.js";
import type { MetaMaskServerTransactionInput } from "../../src/metamask-gasless/client/server-transaction.js";
import { runnerDiagnostic, submitFailureError } from "../../src/metamask-gasless/client/submit-diagnostic.js";
import type { MetaMaskRevocationApprovalPort, MetaMaskRevocationSummary } from "../../src/metamask-gasless/revocation/consent.js";
import { metaMaskRevocationRequestIdHash, MM_REVOCATION_REQUEST_READ_LIMIT,
  type MetaMaskRevocationReferencesPort } from "../../src/metamask-gasless/revocation/requests.js";
import { MetaMaskSdkRevocationWallet, type MetaMaskRevocationSendInput, type MetaMaskRevocationSubmission,
  type MetaMaskRevocationWalletPort } from "../../src/metamask-gasless/revocation/wallet.js";
import type { MetaMaskProcessRunnerPort } from "../../src/metamask-process-runner.js";
import { metaMaskServerTransaction } from "../../src/metamask-server-transaction.js";
import { listProviderRequestReferences, type ProviderRequestReferenceBinding } from "../../src/provider-request-reference-store.js";
import { temporaryState } from "./helpers.js";
import { mmFixture, mmTestWord } from "./metamask-gasless-helpers.js";
import type { Json } from "./metamask-gasless-rpc-fake.js";
import { flipped, rewrite } from "./provider-request-reference-helpers.js";

type Fixture = Awaited<ReturnType<typeof mmFixture>>;

/** The real store, with every call written to `log` and a refusal at `ready`, `seal` or `discard` when set. */
class LoggedReferences implements MetaMaskRevocationReferencesPort {
  failReady: Error | undefined;
  failSeal: Error | undefined;
  failDiscard: Error | undefined;
  constructor(readonly inner: MetaMaskRevocationReferencesPort, readonly log: string[]) {}
  async ready() { this.log.push("ready"); if (this.failReady !== undefined) throw this.failReady; await this.inner.ready(); }
  async seal(binding: ProviderRequestReferenceBinding, reference: string) {
    this.log.push("seal"); if (this.failSeal !== undefined) throw this.failSeal; await this.inner.seal(binding, reference);
  }
  async open(binding: ProviderRequestReferenceBinding) { this.log.push("open"); return await this.inner.open(binding); }
  async discard(binding: ProviderRequestReferenceBinding) {
    this.log.push("discard"); if (this.failDiscard !== undefined) throw this.failDiscard; await this.inner.discard(binding);
  }
}
class Approval implements MetaMaskRevocationApprovalPort {
  readonly seen: MetaMaskRevocationSummary[] = [];
  constructor(readonly log: string[]) {}
  async confirm(summary: MetaMaskRevocationSummary) { this.log.push("consent"); this.seen.push(summary); return true; }
}
/** The owner's wallet: the check builds the helper's request as the SDK wallet does; the send answers `answer`. */
class Wallet implements MetaMaskRevocationWalletPort {
  readonly sent: MetaMaskServerTransactionInput[] = [];
  constructor(readonly log: string[], readonly refusal?: ApnError,
    readonly answer: Readonly<Record<string, unknown>> = { disposition: "pending" }) {}
  async check(input: MetaMaskRevocationSendInput) {
    this.log.push("check"); if (this.refusal !== undefined) throw this.refusal;
    return metaMaskServerTransaction({ ...input, projectHash: null, expiresAt: new Date(Date.now() + 120_000).toISOString() });
  }
  async send(request: MetaMaskServerTransactionInput): Promise<MetaMaskRevocationSubmission> {
    this.log.push("send"); this.sent.push(request);
    return { ...this.answer, requestIdHash: metaMaskRevocationRequestIdHash(request.requestId) } as unknown as MetaMaskRevocationSubmission;
  }
}
/** The helper's own closed facts for a stop before any network call: the session read refused (session_binding). */
const UNSENT = { disposition: "unknown", reason: "provider_handoff_outcome_unknown", helperFailure: "mm_gasless_binding_changed",
  submitDiagnostic: { mode: "submit", stage: "private_state", post: "not_reached", httpStatus: null, check: "unclassified", providerError: null,
    providerStatus: null, responseTx: null } } as const;
/** A POST that left and got no usable answer: the request may have reached MetaMask. */
const MAY_HAVE_LEFT = { disposition: "unknown", reason: "provider_handoff_outcome_unknown", helperFailure: "mm_gasless_submit_unknown",
  submitDiagnostic: { mode: "submit", stage: "post", post: "sent", httpStatus: null, check: "no_answer", providerError: null,
    providerStatus: null, responseTx: null } } as const;

/** A dispatched transfer whose submit response was lost: only its outcome is unknown, so its delegation may be disabled. */
async function unresolved(f: Fixture): Promise<string> {
  const { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  f.provider.failSubmit = false;
  assert.equal((await f.record(id)).state, "unknown_finality");
  return id;
}
/** QA's Sei shape: MetaMask closed the relay request, so resume proves `revoked_unused` once the delegation is disabled. */
async function providerFailed(f: Fixture): Promise<string> {
  const { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.status = "failed"; f.provider.txHash = null;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  return id;
}
const scope = (f: Fixture, id: string) => ({ lane: "metamask-revocation", profileHash: f.state.profileHash(f.profile), operationId: id }) as const;
const binding = (f: Fixture, id: string, requestId: string): ProviderRequestReferenceBinding =>
  ({ ...scope(f, id), providerId: "metamask-agent-wallet", referenceHash: metaMaskRevocationRequestIdHash(requestId) });
const directory = (f: Fixture, id: string) => join(f.state.root, "metamask-revocation-request-references", f.state.profileHash(f.profile), id);
/** The sealed request hashes, in the listing's own order: newest first. */
const listed = async (f: Fixture, id: string) => (await listProviderRequestReferences(f.state, scope(f, id))).map(record => record.referenceHash);
/** Gives each sealed request of `ids` its own seal time, one second apart in the order given (the last is the newest). */
async function sealedAt(f: Fixture, id: string, ids: readonly string[]): Promise<void> {
  for (const [index, requestId] of ids.entries()) {
    const seconds = 1_900_000_000 + index;
    await utimes(join(directory(f, id), `${metaMaskRevocationRequestIdHash(requestId)}.json`), seconds, seconds);
  }
}
/** Seals revoke requests as earlier revokes of the operation left them; returns their ids. */
async function sealed(f: Fixture, id: string, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  for (const requestId of ids) await f.providerReferences.seal(binding(f, id, requestId), requestId);
  return ids;
}
const revoking = (f: Fixture, approval: Approval, wallet: MetaMaskRevocationWalletPort, references: MetaMaskRevocationReferencesPort) =>
  new ApnCore({ state: f.state, clock: f.clock, wait: f.wait, metaMaskGasless: { ...f.dependencies, revocation: { approval, wallet, references } } });
const revoke = { command: "gasless.transfer.revoke" } as const;
const resume = { command: "operation.resume" } as const;

test("the id is sealed after consent and the wallet's check and before the send; the output names its hash", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  const references = new LoggedReferences(f.providerReferences, log), wallet = new Wallet(log);
  const result = await revoking(f, new Approval(log), wallet, references).execute({ ...revoke, operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(log, ["ready", "consent", "check", "seal", "send"]);
  const requestId = wallet.sent[0]!.requestId, hash = metaMaskRevocationRequestIdHash(requestId);
  assert.deepEqual((result.data as Json).submission, { disposition: "pending", requestIdHash: hash });
  assert.deepEqual(await listed(f, id), [hash]);
  assert.equal(await f.providerReferences.open(binding(f, id, requestId)), requestId);
  // Each revoke is a new request with a new record; the first stays as it was.
  const again = await revoking(f, new Approval(log), new Wallet(log), references).execute({ ...revoke, operationId: id });
  assert.equal(again.ok, true, JSON.stringify(again.error));
  assert.equal((await listed(f, id)).length, 2);
  assert.equal(await f.providerReferences.open(binding(f, id, requestId)), requestId);
});

test("with the real wallet the sealed record is on disk before the helper starts; a send that may have left keeps it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  let seenByHelper: readonly string[] | undefined, sentId: string | undefined;
  const mm: MetaMaskProcessRunnerPort = { async runJson(argv: readonly string[]) {
    log.push(`mm ${argv.slice(0, 2).join(" ")}`);
    return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, data: { mode: "server", chainNamespace: "evm", address: f.binding.address } })) };
  }, async runForeground() { throw new Error("TEST no foreground mm"); } };
  // A runner failure after the helper started: the POST may have left, so the answer is unknown and the seal stays.
  const client = new MetaMaskGaslessProviderClient({ environment: {}, clock: f.clock, runner: { async run(request) {
    log.push("helper");
    if (request.mode !== "submitTransaction") throw new Error(`TEST unexpected helper mode ${request.mode}`);
    sentId = request.transaction.requestId; seenByHelper = await listed(f, id);
    throw new Error("TEST helper stops here");
  } } });
  const result = await revoking(f, new Approval(log), new MetaMaskSdkRevocationWallet(mm, client), new LoggedReferences(f.providerReferences, log))
    .execute({ ...revoke, operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(log, ["ready", "consent", "mm wallet address", "seal", "helper"]);
  const hash = metaMaskRevocationRequestIdHash(sentId!);
  assert.deepEqual(seenByHelper, [hash], "the helper started only after this very request was sealed");
  assert.deepEqual((result.data as Json).submission.disposition, "unknown"); assert.equal((result.data as Json).submission.requestIdHash, hash);
  assert.deepEqual(await listed(f, id), [hash], "a request that may have reached MetaMask keeps its seal");
});

test("a helper that provably stopped before any network call leaves no seal; one that may have sent keeps it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  const references = new LoggedReferences(f.providerReferences, log), stopped = new Wallet(log, undefined, UNSENT);
  const result = await revoking(f, new Approval(log), stopped, references).execute({ ...revoke, operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(log, ["ready", "consent", "check", "seal", "send", "discard"]);
  assert.deepEqual(await listed(f, id), [], "nothing reached MetaMask, so there is nothing to read again");
  assert.equal(result.next_actions.some(action => action.includes("revocation_requests")), false, "no read of it is offered");
  assert.match(result.next_actions[0]!, /^The MetaMask helper stopped before any network call: /u);
  const left = new Wallet([], undefined, MAY_HAVE_LEFT);
  const unknown = await revoking(f, new Approval([]), left, f.providerReferences).execute({ ...revoke, operationId: id });
  assert.equal(unknown.ok, true, JSON.stringify(unknown.error));
  const hash = metaMaskRevocationRequestIdHash(left.sent[0]!.requestId);
  assert.deepEqual(await listed(f, id), [hash]);
  assert.equal(unknown.next_actions.some(action => action.includes(`request_id_hash ${hash}`)), true, "its read is offered");
});

test("with the real wallet a helper that never started leaves no seal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  const mm: MetaMaskProcessRunnerPort = { async runJson() {
    return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, data: { mode: "server", chainNamespace: "evm", address: f.binding.address } })) };
  }, async runForeground() { throw new Error("TEST no foreground mm"); } };
  // The runner's own refusal before launch: its closed facts say the POST was never reached.
  const client = new MetaMaskGaslessProviderClient({ environment: {}, clock: f.clock, runner: { async run() {
    log.push("helper"); throw submitFailureError("mm_gasless_submit_unknown", runnerDiagnostic("runner_launch", false));
  } } });
  const result = await revoking(f, new Approval(log), new MetaMaskSdkRevocationWallet(mm, client), new LoggedReferences(f.providerReferences, log))
    .execute({ ...revoke, operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal((result.data as Json).submission.disposition, "unknown");
  assert.deepEqual((result.data as Json).submission.submitDiagnostic?.post, "not_reached");
  assert.deepEqual(log, ["ready", "consent", "seal", "helper", "discard"]);
  assert.deepEqual(await listed(f, id), [], "the request never left the machine, so its seal is gone");
  assert.match(result.next_actions[0]!, /^The MetaMask helper stopped before any network call: the helper process did not start/u);
});

test("an unsent request whose seal cannot be removed keeps it, and the next actions name it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  const references = new LoggedReferences(f.providerReferences, log), wallet = new Wallet(log, undefined, UNSENT);
  references.failDiscard = new ApnError("APN_STATE_SECURITY", "State file must have mode 0600.");
  const result = await revoking(f, new Approval(log), wallet, references).execute({ ...revoke, operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal((result.data as Json).submission.disposition, "unknown", "the answer is kept");
  const hash = metaMaskRevocationRequestIdHash(wallet.sent[0]!.requestId);
  assert.deepEqual(await listed(f, id), [hash]);
  assert.deepEqual(result.next_actions.slice(1), [`The sealed ID of this disable request (request_id_hash ${hash}) could not be removed ` +
    "(apn_state_security). Resume lists it under revocation_requests; MetaMask never received it, so its read proves nothing.",
  `apn operation resume --operation ${id}`]);
});

test("a seal that fails, or a selected-wallet check that refuses, sends nothing; the check refusal seals nothing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f);
  const sealLog: string[] = [], failing = new LoggedReferences(f.providerReferences, sealLog), sealWallet = new Wallet(sealLog);
  failing.failSeal = new ApnError("APN_STATE_CORRUPT", "APN state holds encrypted records but their wrapping secret is missing.",
    { reason: "wrapping_secret_missing", nextActions: ["Restore the login Keychain item."] });
  const unsealed = await revoking(f, new Approval(sealLog), sealWallet, failing).execute({ ...revoke, operationId: id });
  assert.equal(unsealed.error?.code, "APN_STATE_CORRUPT"); assert.equal(unsealed.error?.details?.reason, "wrapping_secret_missing");
  assert.match(unsealed.error?.message ?? "", / The disable was not sent\.$/u);
  assert.deepEqual(unsealed.next_actions, ["Restore the login Keychain item."], "the seal's own steps are kept");
  assert.deepEqual(sealLog, ["ready", "consent", "check", "seal"]); assert.equal(sealWallet.sent.length, 0);
  const checkLog: string[] = [], refusing = new Wallet(checkLog, new ApnError("APN_PROFILE_DRIFT",
    "The MetaMask Agent Wallet's selected wallet is not this delegation's server wallet; nothing was sent.", { reason: "mm_revoke_wallet_mismatch" }));
  const drifted = await revoking(f, new Approval(checkLog), refusing, new LoggedReferences(f.providerReferences, checkLog))
    .execute({ ...revoke, operationId: id });
  assert.equal(drifted.error?.details?.reason, "mm_revoke_wallet_mismatch");
  assert.deepEqual(checkLog, ["ready", "consent", "check"]); assert.equal(refusing.sent.length, 0);
  assert.deepEqual(await listed(f, id), [], "no id is sealed without a send after it");
});

test("a refusing Keychain stops the revoke before consent; any number of sealed requests never does", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  const locked = new LoggedReferences(f.providerReferences, log), approval = new Approval(log), wallet = new Wallet(log);
  locked.failReady = new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable.", { nativeCode: "APN_KEYCHAIN_UNAVAILABLE" });
  const refused = await revoking(f, approval, wallet, locked).execute({ ...revoke, operationId: id });
  assert.equal(refused.error?.code, "APN_NATIVE_REJECTED"); assert.deepEqual(log, ["ready"]);
  assert.equal(f.rpc.calls.includes("revocation"), false); assert.equal(approval.seen.length, 0);
  // Revoke has no count limit: the 17th disable proceeds as the first did.
  await sealed(f, id, MM_REVOCATION_REQUEST_READ_LIMIT);
  const seventeenth = await revoking(f, new Approval([]), new Wallet([]), f.providerReferences).execute({ ...revoke, operationId: id });
  assert.equal(seventeenth.ok, true, JSON.stringify(seventeenth.error));
  assert.equal((await listed(f, id)).length, MM_REVOCATION_REQUEST_READ_LIMIT + 1);
});

test("resume reports MetaMask's status of each sealed request beside its chain reads; one failed read is that entry's own reason", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f);
  const [read, lost, damaged] = await sealed(f, id, 3) as [string, string, string];
  const tx = mmTestWord("disable-transaction");
  f.revocationReader.answers.set(read, { outcome: "verified", status: "BROADCASTED", transactionHash: tx, mfa: null, responseHash: "f".repeat(64) });
  f.revocationReader.answers.set(lost, new ApnError("APN_PROVIDER_UNAVAILABLE", "synthetic helper failure", { reason: "mm_gasless_provider_unavailable" }));
  await rewrite(join(directory(f, id), `${metaMaskRevocationRequestIdHash(damaged)}.json`),
    v => ({ ...v, cipher: { ...v.cipher, ciphertext: flipped(v.cipher.ciphertext) } }));
  // The rewrite moved one record's mtime; fix all three seal times so the newest-first order is known.
  await sealedAt(f, id, [read, lost, damaged]);
  const resumed = await f.core.execute({ ...resume, operationId: id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  const empty = { status: null, transaction_hash: null, mfa: null, response_hash: null, check: null };
  const expected = new Map([
    [metaMaskRevocationRequestIdHash(read), { outcome: "verified", status: "BROADCASTED", transaction_hash: tx, mfa: null,
      response_hash: "f".repeat(64), reason: null, check: null }],
    [metaMaskRevocationRequestIdHash(lost), { outcome: "refused", ...empty, reason: "mm_gasless_provider_unavailable" }],
    [metaMaskRevocationRequestIdHash(damaged), { outcome: "refused", ...empty, reason: "provider_request_reference_unmatched" }],
  ]);
  const newestFirst = [damaged, lost, read].map(metaMaskRevocationRequestIdHash);
  assert.deepEqual((resumed.operation as Json).revocation_requests, newestFirst.map(hash => ({ request_id_hash: hash, ...expected.get(hash) })));
  // One session project read; a request whose seal could not be opened is never read.
  assert.equal(f.revocationReader.sessionReads, 1);
  assert.deepEqual(f.revocationReader.reads.map(entry => entry.requestId).sort(), [read, lost].sort());
  for (const entry of f.revocationReader.reads) assert.deepEqual(entry.binding, { sender: f.binding.address, chainId: 8453 });
  assert.equal(JSON.stringify(resumed).includes(read), false, "no sealed id is shown");
  const record = JSON.stringify(await f.record(id));
  assert.equal(record.includes("revocation") || [...expected.keys()].some(hash => record.includes(hash)), false, "nothing of the reads is written");
  // Without a session project, every entry carries that reason and no request is read.
  f.revocationReader.project = { reason: "metamask_session_required" };
  const reads = f.revocationReader.reads.length, signedOut = await f.core.execute({ ...resume, operationId: id });
  assert.equal(signedOut.ok, true, JSON.stringify(signedOut.error));
  assert.deepEqual(((signedOut.operation as Json).revocation_requests as Json[]).map(entry => [entry.outcome, entry.reason]).sort(),
    [["refused", "metamask_session_required"], ["refused", "metamask_session_required"], ["refused", "provider_request_reference_unmatched"]]);
  assert.equal(f.revocationReader.reads.length, reads);
});

test("resume reads the 16 newest requests and reports the older ones; nothing sealed means no field; a dot-file is no request", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f);
  const plain = await f.core.execute({ ...resume, operationId: id });
  assert.equal(plain.ok, true, JSON.stringify(plain.error));
  assert.equal(Object.hasOwn(plain.operation as Json, "revocation_requests"), false, "nothing sealed: no field");
  await sealed(f, id, MM_REVOCATION_REQUEST_READ_LIMIT + 2);
  await writeFile(join(directory(f, id), ".DS_Store"), "", { mode: 0o600 });
  const resumed = await f.core.execute({ ...resume, operationId: id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  const entries = (resumed.operation as Json).revocation_requests as Json[], hashes = await listed(f, id);
  assert.deepEqual(entries.map(entry => entry.request_id_hash), hashes, "every sealed request, newest first; the dot-file is none");
  assert.deepEqual(entries.slice(0, MM_REVOCATION_REQUEST_READ_LIMIT).map(entry => entry.outcome),
    Array(MM_REVOCATION_REQUEST_READ_LIMIT).fill("not_found"));
  assert.deepEqual(entries.slice(MM_REVOCATION_REQUEST_READ_LIMIT), hashes.slice(MM_REVOCATION_REQUEST_READ_LIMIT).map(hash => ({
    request_id_hash: hash, outcome: "refused", status: null, transaction_hash: null, mfa: null, response_hash: null,
    reason: "revocation_request_read_limit", check: null })));
  assert.equal(f.revocationReader.reads.length, MM_REVOCATION_REQUEST_READ_LIMIT, "the requests past the limit are not read");
});

test("the newest request is read even when its hash sorts last; the oldest past the limit is reported, not read", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f);
  const ids = await sealed(f, id, MM_REVOCATION_REQUEST_READ_LIMIT + 1);
  // Seal times rise with the hash: the newest request has the largest hash, which a hash-ordered read would have skipped.
  const byHash = [...ids].sort((left, right) => metaMaskRevocationRequestIdHash(left) < metaMaskRevocationRequestIdHash(right) ? -1 : 1);
  await sealedAt(f, id, byHash);
  const newest = byHash.at(-1)!, oldest = byHash[0]!;
  const resumed = await f.core.execute({ ...resume, operationId: id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  const entries = (resumed.operation as Json).revocation_requests as Json[];
  assert.deepEqual(entries.map(entry => entry.request_id_hash), [...byHash].reverse().map(metaMaskRevocationRequestIdHash), "newest first");
  assert.deepEqual([entries[0]!.outcome, entries[0]!.reason], ["not_found", null], "the newest request was read");
  assert.deepEqual([entries.at(-1)!.request_id_hash, entries.at(-1)!.outcome, entries.at(-1)!.reason],
    [metaMaskRevocationRequestIdHash(oldest), "refused", "revocation_request_read_limit"]);
  const readIds = f.revocationReader.reads.map(entry => entry.requestId);
  assert.equal(readIds.includes(newest), true); assert.equal(readIds.includes(oldest), false);
  assert.equal(readIds.length, MM_REVOCATION_REQUEST_READ_LIMIT);
});

test("a lane entry APN never wrote, or no reader, is one refused entry; the chain still proves revoked_unused", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 1329), id = await providerFailed(f);
  await sealed(f, id, 1);
  await writeFile(join(directory(f, id), "note.json"), "{}", { mode: 0o600 });
  f.rpc.phase = "disabled";
  const proved = await f.core.execute({ ...resume, operationId: id });
  assert.equal(proved.ok, true, JSON.stringify(proved.error));
  assert.equal((proved.operation as Json).state, "revoked_unused", "the listing never blocks the chain proof");
  assert.deepEqual((proved.operation as Json).revocation_requests, [{ request_id_hash: null, outcome: "refused", status: null,
    transaction_hash: null, mfa: null, response_hash: null, reason: "provider_request_reference_listing_invalid", check: null }]);
  assert.equal(f.revocationReader.sessionReads, 0);
  const other = await temporaryState(); t.after(other.cleanup);
  const g = await mmFixture(other.root), unwired = await unresolved(g);
  await sealed(g, unwired, 1);
  const { revocationReads: _reads, ...dependencies } = g.dependencies;
  const answered = await new ApnCore({ state: g.state, clock: g.clock, wait: g.wait, metaMaskGasless: dependencies })
    .execute({ ...resume, operationId: unwired });
  assert.equal(answered.ok, true, JSON.stringify(answered.error));
  assert.deepEqual(((answered.operation as Json).revocation_requests as Json[]).map(entry => [entry.request_id_hash, entry.reason]),
    [[null, "revocation_request_reader_unavailable"]]);
});

test("resume opens the sealed ids under the operation lock and reads MetaMask under the provider-session lock alone", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f);
  await sealed(f, id, 2);
  // Records the lock keys the command holds on this state at each step.
  const held: string[] = [];
  const state = f.state as unknown as { withLocks: (keys: readonly string[], action: () => Promise<unknown>, options?: { readonly waitMs?: number }) => Promise<unknown> };
  const original = state.withLocks.bind(f.state);
  state.withLocks = async (keys, action, options) => await original(keys, async () => {
    held.push(...keys);
    try { return await action(); } finally { for (const key of keys) held.splice(held.indexOf(key), 1); }
  }, options);
  const holding = () => [held.some(key => key.startsWith("operation:")) ? "operation" : null,
    held.includes("provider-session:metamask-agent-wallet") ? "session" : null].filter(item => item !== null).join("+") || "none";
  const seen: string[] = [];
  const reader = { sessionProject: async () => { seen.push(`project ${holding()}`); return { projectHash: "c".repeat(64) }; },
    read: async () => { seen.push(`read ${holding()}`); return { outcome: "not_found" } as const; } };
  const references = { ready: async () => {}, seal: async () => assert.fail("resume seals nothing"), discard: async () => assert.fail("resume discards nothing"),
    open: async (sealedBinding: ProviderRequestReferenceBinding) => { seen.push(`open ${holding()}`); return await f.providerReferences.open(sealedBinding); } };
  const resumed = await new ApnCore({ state: f.state, clock: f.clock, wait: f.wait,
    metaMaskGasless: { ...f.dependencies, revocationReads: { references, reader } } }).execute({ ...resume, operationId: id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  assert.deepEqual(seen, ["open operation", "open operation", "project session", "read session", "read session"]);
});

test("status, receipts and abandonment never open a sealed revoke request id; resume does", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 8453, "empty", { abandonApproval: { approve: async () => undefined } }), id = await unresolved(f);
  await sealed(f, id, 2);
  const log: string[] = [], references = new LoggedReferences(f.providerReferences, log);
  const core = () => new ApnCore({ state: f.state, clock: f.clock, wait: f.wait, operationAbandonApproval: { approve: async () => undefined },
    providerRequestReferences: references, metaMaskGasless: { ...f.dependencies, revocationReads: { references, reader: f.revocationReader } } });
  assert.equal((await core().execute({ command: "operation.status", operationId: id })).ok, true);
  await core().execute({ command: "receipt.get", operationId: id });
  f.advance(600_000);
  const abandoned = await core().execute({ command: "operation.abandon", operationId: id });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error)); assert.equal((await f.record(id)).state, "abandoned_unknown");
  assert.equal((await core().execute({ command: "operation.status", operationId: id })).ok, true);
  await core().execute({ command: "receipt.get", operationId: id });
  assert.deepEqual(log, [], "neither status, a receipt nor the observation an abandonment runs first opens a sealed id");
  assert.equal(f.revocationReader.sessionReads, 0);
  // An abandoned dispatch is still observed by resume, which reads each sealed request again.
  const resumed = await core().execute({ ...resume, operationId: id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  assert.equal(((resumed.operation as Json).revocation_requests as Json[]).length, 2); assert.deepEqual(log, ["open", "open"]);
  assert.equal(f.revocationReader.sessionReads, 1);
});
