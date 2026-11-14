/**
 * QA F26: the MetaMask gasless request id (MetaMask's id for the relay job, which the owner's pending MFA approval waits
 * on) is kept encrypted. A new journal keeps only its hash; the id is sealed under the wrapping secret and opened only to
 * send the request and to read its job. Journals an earlier release wrote keep their plaintext id and work as before.
 * Synthetic wrapping secret only; the Keychain is never touched.
 */
import assert from "node:assert/strict";
import { chmod, copyFile, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { mmPrivateHash } from "../../src/metamask-gasless/identity.js";
import { newMetaMaskGaslessOperation } from "../../src/metamask-gasless/journal/transitions.js";
import type { MetaMaskGaslessOperationRecord } from "../../src/metamask-gasless/operation-model.js";
import { EncryptedMetaMaskGaslessRequestReferenceStore } from "../../src/metamask-gasless/journal/request-reference.js";
import { StateStore } from "../../src/state.js";
import { holdsSealedCustody, loadOrCreateWrappingSecret } from "../../src/wrapping-secret-custody.js";
import { FixedSecret, nestedFormat, referenceOpen } from "./custody-envelope-reference.js";
import { MmTestWrappingSecret, mmFixture, mmWriteOperationFile } from "./metamask-gasless-helpers.js";

type Fixture = Awaited<ReturnType<typeof mmFixture>>;
const sandbox = async () => await mkdtemp(join(await realpath(tmpdir()), "apn-mm-request-reference-"));
const journalPath = (f: Fixture, op: MetaMaskGaslessOperationRecord) =>
  join(f.state.root, "metamask-gasless-operations", op.profileHash, `${op.operationId}.json`);
const sealedPath = (f: Fixture, op: MetaMaskGaslessOperationRecord) =>
  join(f.state.root, "metamask-gasless-request-references", op.profileHash, `${op.operationId}.json`);
function hashOf(op: MetaMaskGaslessOperationRecord): string {
  assert.match(op.intent.requestIdHash ?? "", /^[0-9a-f]{64}$/u); return op.intent.requestIdHash!;
}
async function sealedId(f: Fixture, op: MetaMaskGaslessOperationRecord): Promise<string> {
  return await f.references.open({ profileHash: op.profileHash, operationId: op.operationId, requestIdHash: hashOf(op) });
}
/** Every regular file under the state root, as text. */
async function stateFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path); else if (entry.isFile()) files.set(path, await readFile(path, "utf8"));
    }
  };
  await visit(root); return files;
}
async function rewrite(path: string, change: (value: Record<string, any>) => Record<string, any>): Promise<void> {
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
  await writeFile(path, `${canonicalJson(change(value))}\n`, { mode: 0o600 }); await chmod(path, 0o600);
}
function flipped(encoded: string): string {
  const bytes = Buffer.from(encoded, "base64"); bytes[0] = bytes[0]! ^ 1; return bytes.toString("base64");
}

test("a new MetaMask gasless journal keeps only the request id hash; the sealed id is the one sent, and no output names it", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root);
    assert.equal(await holdsSealedCustody(f.state), false, "a provider profile alone seals nothing");
    const { id, operation } = await f.prepare();
    assert.equal(operation.intent.requestId, undefined);
    const requestId = await sealedId(f, operation);
    assert.equal(mmPrivateHash("request-id", requestId), hashOf(operation));
    assert.ok(f.wrapping.loads > 0, "prepare sealed the id under the wrapping secret");
    const sealed = JSON.parse(await readFile(sealedPath(f, operation), "utf8")) as Record<string, any>;
    assert.deepEqual(Object.keys(sealed).sort(), ["binding", "cipher", "kdf", "schemaVersion"]);
    assert.equal(sealed.schemaVersion, "apn.metamask-gasless-request-reference-envelope.v1");
    assert.deepEqual(sealed.binding, { profileHash: operation.profileHash, operationId: id, requestIdHash: hashOf(operation) });
    // The sealed record now forbids minting a replacement secret that would orphan it.
    assert.equal(await holdsSealedCustody(f.state), true);
    const missing = new MmTestWrappingSecret(); missing.secret = null;
    await assert.rejects(loadOrCreateWrappingSecret(f.state, missing), (error: unknown) =>
      error instanceof ApnError && error.code === "APN_STATE_CORRUPT" && error.details?.reason === "wrapping_secret_missing");

    const status = await f.core.execute({ command: "operation.status", operationId: id });
    assert.equal(status.ok, true, JSON.stringify(status.error));
    assert.equal((status.operation as Record<string, unknown>).provider_request_id_hash, hashOf(operation));
    const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    assert.equal(f.provider.submissions.length, 1);
    const sent = f.provider.submissions[0]!;
    assert.equal(sent.requestId, requestId); assert.equal("requestIdHash" in sent, false, "the helper gets the id, never the hash");
    assert.equal(f.approval.calls.length, 1); assert.equal(JSON.stringify(f.approval.calls).includes(requestId), false);
    const completed = await f.record(id);
    assert.equal(completed.state, "completed"); assert.equal(completed.intent.requestId, undefined);
    assert.equal(completed.providerObservation?.requestIdHash, hashOf(operation));
    const receipt = await f.core.execute({ command: "receipt.get", operationId: id });
    assert.equal((receipt.receipt as Record<string, unknown>).provider_request_id_hash, hashOf(operation));
    for (const output of [status, approved, receipt]) assert.equal(JSON.stringify(output).includes(requestId), false);
    for (const [path, text] of await stateFiles(root)) assert.equal(text.includes(requestId), false, `${path} keeps the request id in plaintext`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the sealed record is the shared custody envelope: an independent AES-GCM reader opens it, and every secret copy is zeroed", async () => {
  const root = await sandbox();
  try {
    const state = new StateStore(join(root, "state")); await state.initialize();
    const secret = Buffer.alloc(32, 5), spy = new FixedSecret(secret), store = new EncryptedMetaMaskGaslessRequestReferenceStore(state, spy);
    const requestId = "12345678-1234-4234-8234-123456789abc";
    const binding = { profileHash: "a".repeat(64), operationId: "b".repeat(64), requestIdHash: mmPrivateHash("request-id", requestId) };
    await assert.rejects(store.seal({ ...binding, requestIdHash: "c".repeat(64) }, requestId), { code: "APN_INTERNAL" },
      "an id is sealed only under its own hash");
    await store.seal(binding, requestId);
    assert.equal(await store.open(binding), requestId);
    const file = JSON.parse(await readFile(join(state.root, "metamask-gasless-request-references", binding.profileHash,
      `${binding.operationId}.json`), "utf8")) as Record<string, any>;
    const format = nestedFormat("nonce", f => ["apn.metamask-gasless-request-reference-envelope.v1", f.binding.profileHash,
      f.binding.operationId, f.binding.requestIdHash].join("\0"));
    assert.equal(referenceOpen(format, file, secret).toString("utf8"),
      canonicalJson({ schemaVersion: "apn.metamask-gasless-request-reference.v1", requestId }));
    assert.ok(spy.handed.length > 0);
    for (const copy of spy.handed) assert.ok(copy.every(byte => byte === 0), "a wrapping-secret copy was left unzeroed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prepare mints the first wrapping secret for a state root that holds nothing sealed", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root); f.wrapping.secret = null;
    const { id, operation } = await f.prepare();
    assert.notEqual(f.wrapping.secret, null);
    assert.equal(mmPrivateHash("request-id", await sealedId(f, operation)), hashOf(operation));
    assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    assert.equal(f.provider.submissions.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an earlier release's journal keeps its plaintext request id: it loads, sends and projects as before, and reads never rewrite it", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root), { id, operation } = await f.prepare(), requestId = await sealedId(f, operation);
    // The same operation as APN 0.5.106 wrote it: the request id itself in the intent, no sealed record at all.
    const { requestIdHash: _hash, ...kept } = operation.intent;
    const legacy = newMetaMaskGaslessOperation({ profileHash: operation.profileHash, operationId: id,
      idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash }, { ...kept, requestId });
    await mmWriteOperationFile(root, legacy);
    await rm(join(root, "metamask-gasless-request-references"), { recursive: true, force: true });
    const loads = f.wrapping.loads, before = await readFile(journalPath(f, legacy));
    const status = await f.restart().execute({ command: "operation.status", operationId: id });
    assert.equal(status.ok, true, JSON.stringify(status.error));
    assert.equal((status.operation as Record<string, unknown>).provider_request_id_hash, mmPrivateHash("request-id", requestId));
    assert.deepEqual(await readFile(journalPath(f, legacy)), before, "a read never rewrites an earlier release's journal");
    const approved = await f.restart().execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    assert.equal(f.provider.submissions.length, 1); assert.equal(f.provider.submissions[0]!.requestId, requestId);
    assert.equal(f.wrapping.loads, loads, "an earlier release's journal needs no wrapping secret");
    const after = await f.record(id);
    assert.equal(after.state, "completed"); assert.equal(after.fingerprint, legacy.fingerprint);
    assert.equal(after.intent.requestId, requestId); assert.equal(after.intent.requestIdHash, undefined);
    assert.deepEqual(after.transitions.slice(0, legacy.transitions.length), legacy.transitions);
    const receipt = await f.restart().execute({ command: "receipt.get", operationId: id });
    assert.equal((receipt.receipt as Record<string, unknown>).provider_request_id_hash, mmPrivateHash("request-id", requestId));
    assert.equal(JSON.stringify([status, approved, receipt]).includes(requestId), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a sealed request id that cannot be opened refuses approve before its screen; nothing is sent and the journal is unchanged", async (t) => {
  const root = await sandbox();
  try {
    const corrupt = "mm_gasless_state_corrupt";
    const cases: ReadonlyArray<readonly [string, (f: Fixture, op: MetaMaskGaslessOperationRecord) => Promise<void>, string, string | undefined]> = [
      ["missing", async (f, op) => { await rm(sealedPath(f, op)); }, "APN_STATE_CORRUPT", corrupt],
      ["ciphertext changed", async (f, op) => { await rewrite(sealedPath(f, op), v => ({ ...v, cipher: { ...v.cipher, ciphertext: flipped(v.cipher.ciphertext) } })); },
        "APN_STATE_CORRUPT", corrupt],
      ["binding changed", async (f, op) => { await rewrite(sealedPath(f, op), v => ({ ...v, binding: { ...v.binding, requestIdHash: "f".repeat(64) } })); },
        "APN_STATE_CORRUPT", corrupt],
      ["another operation's record", async (f, op) => {
        const other = "12345678-1234-4234-8234-123456789abc", binding = { profileHash: op.profileHash, operationId: "e".repeat(64),
          requestIdHash: mmPrivateHash("request-id", other) };
        await f.references.seal(binding, other);
        await copyFile(join(f.state.root, "metamask-gasless-request-references", op.profileHash, `${"e".repeat(64)}.json`), sealedPath(f, op));
      }, "APN_STATE_CORRUPT", corrupt],
      ["another wrapping secret", async (f) => { f.wrapping.secret = Buffer.alloc(32, 9); }, "APN_STATE_CORRUPT", corrupt],
      ["wrapping secret gone", async (f) => { f.wrapping.secret = null; }, "APN_STATE_CORRUPT", "wrapping_secret_missing"],
      ["Keychain refused", async (f) => { f.wrapping.failure = new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable.",
        { nativeCode: "APN_KEYCHAIN_UNAVAILABLE" }); }, "APN_NATIVE_REJECTED", undefined],
    ];
    for (const [name, damage, code, reason] of cases) await t.test(name, async () => {
      const f = await mmFixture(join(root, name.replaceAll(" ", "-").replaceAll("'", ""))), { id, operation } = await f.prepare();
      await damage(f, operation);
      const before = await readFile(journalPath(f, operation));
      const refused = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
      assert.equal(refused.ok, false); assert.equal(refused.error?.code, code, JSON.stringify(refused.error));
      if (reason !== undefined) assert.equal(refused.error?.details?.reason, reason);
      assert.equal(f.approval.calls.length, 0, "the owner is never asked to approve what cannot be sent");
      assert.equal(f.provider.submissions.length, 0);
      assert.deepEqual(await readFile(journalPath(f, operation)), before);
      assert.equal((await f.record(id)).state, "awaiting_approval");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("after dispatch a sealed id that cannot be opened is a failed provider read: the chain is still observed and nothing is sent again", async () => {
  const root = await sandbox();
  try {
    const f = await mmFixture(root), { id, operation } = await f.prepare(), requestId = await sealedId(f, operation);
    // MetaMask holds the request for the owner's MFA: the pending MFA request reference is the sealed id.
    f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.status = "awaiting_approval"; f.provider.txHash = null;
    const approved = await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    const pending = await f.record(id);
    assert.equal(pending.state, "unknown_finality"); assert.equal(pending.failure?.reason, "mm_gasless_provider_approval");
    assert.equal(pending.intent.requestId, undefined); assert.equal(JSON.stringify(approved).includes(requestId), false);
    const read = (await f.restart().execute({ command: "operation.resume", operationId: id })).operation as Record<string, unknown>;
    assert.deepEqual(read.provider_job_read, { ok: true, status: "awaiting_approval", tx_hash: false }, "the sealed id reads its own job");
    const observes = f.provider.calls.filter(call => call === "observe").length, rpcCalls = f.rpc.calls.length;
    await rewrite(sealedPath(f, pending), v => ({ ...v, cipher: { ...v.cipher, tag: flipped(v.cipher.tag) } }));
    const tampered = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(tampered.ok, true, JSON.stringify(tampered.error));
    const shown = tampered.operation as Record<string, unknown>;
    assert.deepEqual(shown.provider_job_read, { ok: false, reason: "mm_gasless_state_corrupt", check: null, provider_status: null, response_tx: null });
    assert.equal(f.provider.calls.filter(call => call === "observe").length, observes, "no job is read without its own id");
    assert.ok(f.rpc.calls.length > rpcCalls, "the chain is still observed");
    assert.equal(f.provider.submissions.length, 1, "never a second request");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prepare reads the wrapping secret before any provider or chain read: a refusing Keychain or a secret missing over sealed state costs none", async (t) => {
  const root = await sandbox();
  try {
    const cases: ReadonlyArray<readonly [string, (f: Fixture) => Promise<void>, string, string | undefined]> = [
      ["Keychain refused", async (f) => { f.wrapping.failure = new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable.",
        { nativeCode: "APN_KEYCHAIN_UNAVAILABLE" }); }, "APN_NATIVE_REJECTED", undefined],
      ["secret missing over sealed state", async (f) => {
        const other = "12345678-1234-4234-8234-123456789abc";
        await f.references.seal({ profileHash: f.state.profileHash(f.profile), operationId: "e".repeat(64),
          requestIdHash: mmPrivateHash("request-id", other) }, other);
        f.wrapping.secret = null;
      }, "APN_STATE_CORRUPT", "wrapping_secret_missing"],
    ];
    for (const [name, damage, code, reason] of cases) await t.test(name, async () => {
      const f = await mmFixture(join(root, name.replaceAll(" ", "-")));
      await damage(f);
      const refused = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: f.request,
        idempotencyKey: "mm-fixture-refused" });
      assert.equal(refused.ok, false); assert.equal(refused.error?.code, code, JSON.stringify(refused.error));
      if (reason !== undefined) assert.equal(refused.error?.details?.reason, reason);
      assert.deepEqual(f.provider.calls, [], "no provider read before the wrapping secret is read");
      assert.deepEqual(f.rpc.calls, [], "no chain read before the wrapping secret is read");
      assert.deepEqual(await readdir(join(f.state.root, "metamask-gasless-operations")).catch(() => []), [], "no journal is written");
      // With the Keychain item back, the same owner prepares as usual.
      f.wrapping.failure = undefined; f.wrapping.secret = Buffer.alloc(32, 7);
      const { operation } = await f.prepare();
      assert.equal(operation.state, "awaiting_approval");
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
