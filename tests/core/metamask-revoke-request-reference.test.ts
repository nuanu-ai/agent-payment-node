/**
 * 0.5.109, QA's open item "Сохранение ID для revoke": `apn gasless transfer revoke` named its MetaMask request id, sent
 * it once and kept it nowhere, so after a `pending` or `unknown` answer nobody could read that request again. Now the id
 * is sealed (provider-request-reference-store.ts, lane `metamask-revocation`, one record per request) after the wallet's
 * own check and before the helper starts, and `operation resume` reads MetaMask's status of each sealed request by its
 * id, beside its unchanged chain reads. Status, receipts and abandonment never open a sealed id. The `mm` reads and the
 * helper are doubles; the store is the real one under a synthetic wrapping secret.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { ApnError } from "../../src/errors.js";
import { MetaMaskGaslessProviderClient } from "../../src/metamask-gasless/client/index.js";
import type { MetaMaskRevocationApprovalPort, MetaMaskRevocationSummary } from "../../src/metamask-gasless/revocation/consent.js";
import { metaMaskRevocationRequestIdHash, MM_REVOCATION_REQUEST_LIMIT } from "../../src/metamask-gasless/revocation/requests.js";
import { MetaMaskSdkRevocationWallet, type MetaMaskRevocationSendInput, type MetaMaskRevocationSubmission,
  type MetaMaskRevocationWalletPort } from "../../src/metamask-gasless/revocation/wallet.js";
import type { MetaMaskProcessRunnerPort } from "../../src/metamask-process-runner.js";
import { listProviderRequestReferences, type ProviderRequestReferenceBinding,
  type ProviderRequestReferencePort } from "../../src/provider-request-reference-store.js";
import { temporaryState } from "./helpers.js";
import { mmFixture, mmTestWord } from "./metamask-gasless-helpers.js";
import type { Json } from "./metamask-gasless-rpc-fake.js";
import { flipped, rewrite } from "./provider-request-reference-helpers.js";

type Fixture = Awaited<ReturnType<typeof mmFixture>>;

/** The real store, with every call written to `log` and a refusal at `ready` or `seal` when set. */
class LoggedReferences implements ProviderRequestReferencePort {
  failReady: Error | undefined;
  failSeal: Error | undefined;
  constructor(readonly inner: ProviderRequestReferencePort, readonly log: string[]) {}
  async ready() { this.log.push("ready"); if (this.failReady !== undefined) throw this.failReady; await this.inner.ready(); }
  async seal(binding: ProviderRequestReferenceBinding, reference: string) {
    this.log.push("seal"); if (this.failSeal !== undefined) throw this.failSeal; await this.inner.seal(binding, reference);
  }
  async open(binding: ProviderRequestReferenceBinding) { this.log.push("open"); return await this.inner.open(binding); }
}
class Approval implements MetaMaskRevocationApprovalPort {
  readonly seen: MetaMaskRevocationSummary[] = [];
  constructor(readonly log: string[]) {}
  async confirm(summary: MetaMaskRevocationSummary) { this.log.push("consent"); this.seen.push(summary); return true; }
}
class Wallet implements MetaMaskRevocationWalletPort {
  readonly sent: MetaMaskRevocationSendInput[] = [];
  constructor(readonly log: string[], readonly refusal?: ApnError) {}
  async check() { this.log.push("check"); if (this.refusal !== undefined) throw this.refusal; }
  async send(input: MetaMaskRevocationSendInput): Promise<MetaMaskRevocationSubmission> {
    this.log.push("send"); this.sent.push(input); return { disposition: "pending", requestIdHash: metaMaskRevocationRequestIdHash(input.requestId) };
  }
}

/** A dispatched transfer whose submit response was lost: only its outcome is unknown, so its delegation may be disabled. */
async function unresolved(f: Fixture): Promise<string> {
  const { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.failSubmit = true;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  f.provider.failSubmit = false;
  assert.equal((await f.record(id)).state, "unknown_finality");
  return id;
}
const scope = (f: Fixture, id: string) => ({ lane: "metamask-revocation", profileHash: f.state.profileHash(f.profile), operationId: id }) as const;
const binding = (f: Fixture, id: string, requestId: string): ProviderRequestReferenceBinding =>
  ({ ...scope(f, id), providerId: "metamask-agent-wallet", referenceHash: metaMaskRevocationRequestIdHash(requestId) });
const directory = (f: Fixture, id: string) => join(f.state.root, "metamask-revocation-request-references", f.state.profileHash(f.profile), id);
/** Seals revoke requests as earlier revokes of the operation left them; returns their ids. */
async function sealed(f: Fixture, id: string, count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  for (const requestId of ids) await f.providerReferences.seal(binding(f, id, requestId), requestId);
  return ids;
}
const revoking = (f: Fixture, approval: Approval, wallet: MetaMaskRevocationWalletPort, references: ProviderRequestReferencePort) =>
  new ApnCore({ state: f.state, clock: f.clock, wait: f.wait, metaMaskGasless: { ...f.dependencies, revocation: { approval, wallet, references } } });
const revoke = { command: "gasless.transfer.revoke" } as const;

test("the id is sealed after consent and the wallet's check and before the send; the output names its hash", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  const references = new LoggedReferences(f.providerReferences, log), wallet = new Wallet(log);
  const result = await revoking(f, new Approval(log), wallet, references).execute({ ...revoke, operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(log, ["ready", "consent", "check", "seal", "send"]);
  const requestId = wallet.sent[0]!.requestId, hash = metaMaskRevocationRequestIdHash(requestId);
  assert.deepEqual((result.data as Json).submission, { disposition: "pending", requestIdHash: hash });
  assert.deepEqual(await listProviderRequestReferences(f.state, scope(f, id)), [hash]);
  assert.equal(await f.providerReferences.open(binding(f, id, requestId)), requestId);
  // Each revoke is a new request with a new record; the first stays as it was.
  const again = await revoking(f, new Approval(log), new Wallet(log), references).execute({ ...revoke, operationId: id });
  assert.equal(again.ok, true, JSON.stringify(again.error));
  assert.equal((await listProviderRequestReferences(f.state, scope(f, id))).length, 2);
  assert.equal(await f.providerReferences.open(binding(f, id, requestId)), requestId);
});

test("with the real wallet the sealed record is on disk before the helper starts; the selected-wallet check runs first", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  let seenByHelper: readonly string[] | undefined, sentId: string | undefined;
  const mm: MetaMaskProcessRunnerPort = { async runJson(argv: readonly string[]) {
    log.push(`mm ${argv.slice(0, 2).join(" ")}`);
    return { exitCode: 0, stdout: Buffer.from(JSON.stringify({ ok: true, data: { mode: "server", chainNamespace: "evm", address: f.binding.address } })) };
  }, async runForeground() { throw new Error("TEST no foreground mm"); } };
  const client = new MetaMaskGaslessProviderClient({ environment: {}, clock: f.clock, runner: { async run(request) {
    log.push("helper");
    if (request.mode !== "submitTransaction") throw new Error(`TEST unexpected helper mode ${request.mode}`);
    sentId = request.transaction.requestId; seenByHelper = await listProviderRequestReferences(f.state, scope(f, id));
    throw new Error("TEST helper stops here");
  } } });
  const result = await revoking(f, new Approval(log), new MetaMaskSdkRevocationWallet(mm, client), new LoggedReferences(f.providerReferences, log))
    .execute({ ...revoke, operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(log, ["ready", "consent", "mm wallet address", "seal", "helper"]);
  assert.deepEqual(seenByHelper, [metaMaskRevocationRequestIdHash(sentId!)], "the helper started only after this very request was sealed");
  assert.equal((result.data as Json).submission.requestIdHash, metaMaskRevocationRequestIdHash(sentId!));
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
  assert.deepEqual(await listProviderRequestReferences(f.state, scope(f, id)), [], "no id is sealed without a send after it");
});

test("a refusing Keychain or a full request list stops the revoke before the chain is priced and before consent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f), log: string[] = [];
  const locked = new LoggedReferences(f.providerReferences, log), approval = new Approval(log), wallet = new Wallet(log);
  locked.failReady = new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable.", { nativeCode: "APN_KEYCHAIN_UNAVAILABLE" });
  const refused = await revoking(f, approval, wallet, locked).execute({ ...revoke, operationId: id });
  assert.equal(refused.error?.code, "APN_NATIVE_REJECTED"); assert.deepEqual(log, ["ready"]);
  assert.equal(f.rpc.calls.includes("revocation"), false); assert.equal(approval.seen.length, 0);
  await sealed(f, id, MM_REVOCATION_REQUEST_LIMIT);
  const full = await revoking(f, approval, wallet, new LoggedReferences(f.providerReferences, log)).execute({ ...revoke, operationId: id });
  assert.equal(full.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(full.error?.details?.reason, "mm_revoke_request_limit");
  assert.deepEqual(full.next_actions, [`apn operation resume --operation ${id}`]);
  assert.deepEqual(log, ["ready"], "nothing was read from the Keychain or the chain, and nothing was asked");
  assert.equal(f.rpc.calls.includes("revocation"), false); assert.equal(wallet.sent.length, 0);
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
  const resumed = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  const empty = { status: null, transaction_hash: null, mfa: null, response_hash: null, check: null };
  const expected = new Map([
    [metaMaskRevocationRequestIdHash(read), { outcome: "verified", status: "BROADCASTED", transaction_hash: tx, mfa: null,
      response_hash: "f".repeat(64), reason: null, check: null }],
    [metaMaskRevocationRequestIdHash(lost), { outcome: "refused", ...empty, reason: "mm_gasless_provider_unavailable" }],
    [metaMaskRevocationRequestIdHash(damaged), { outcome: "refused", ...empty, reason: "provider_request_reference_unmatched" }],
  ]);
  assert.deepEqual((resumed.operation as Json).revocation_requests, [...expected.keys()].sort().map(hash => ({ request_id_hash: hash, ...expected.get(hash) })));
  // One session project read; a request whose seal could not be opened is never read.
  assert.equal(f.revocationReader.sessionReads, 1);
  assert.deepEqual(f.revocationReader.reads.map(entry => entry.requestId).sort(), [read, lost].sort());
  for (const entry of f.revocationReader.reads) assert.deepEqual(entry.binding, { sender: f.binding.address, chainId: 8453 });
  assert.equal(JSON.stringify(resumed).includes(read), false, "no sealed id is shown");
  const record = JSON.stringify(await f.record(id));
  assert.equal(record.includes("revocation") || [...expected.keys()].some(hash => record.includes(hash)), false, "nothing of the reads is written");
  // Without a session project, every entry carries that reason and no id is opened or read.
  f.revocationReader.project = { reason: "metamask_session_required" };
  const reads = f.revocationReader.reads.length, signedOut = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(signedOut.ok, true, JSON.stringify(signedOut.error));
  assert.deepEqual(((signedOut.operation as Json).revocation_requests as Json[]).map(entry => [entry.outcome, entry.reason]),
    [["refused", "metamask_session_required"], ["refused", "metamask_session_required"], ["refused", "metamask_session_required"]]);
  assert.equal(f.revocationReader.reads.length, reads);
});

test("a revoke lane APN never wrote refuses resume before any read; status still answers", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root), id = await unresolved(f);
  await sealed(f, id, 1);
  await writeFile(join(directory(f, id), "note.json"), "{}", { mode: 0o600 });
  const calls = f.rpc.calls.length;
  const foreign = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(foreign.error?.code, "APN_STATE_CORRUPT"); assert.equal(foreign.error?.details?.reason, "provider_request_reference_listing_invalid");
  assert.equal(f.rpc.calls.length, calls, "listed before the chain was read"); assert.equal(f.revocationReader.sessionReads, 0);
  assert.equal((await f.core.execute({ command: "operation.status", operationId: id })).ok, true);
  await rm(join(directory(f, id), "note.json"));
  await sealed(f, id, MM_REVOCATION_REQUEST_LIMIT);
  const over = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(over.error?.code, "APN_STATE_CORRUPT"); assert.equal(over.error?.details?.reason, "mm_revoke_request_limit_exceeded");
  assert.equal(f.rpc.calls.length, calls); assert.equal((await f.core.execute({ command: "operation.status", operationId: id })).ok, true);
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
  const resumed = await core().execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  assert.equal(((resumed.operation as Json).revocation_requests as Json[]).length, 2); assert.deepEqual(log, ["open", "open"]);
  assert.equal(f.revocationReader.sessionReads, 1);
});
