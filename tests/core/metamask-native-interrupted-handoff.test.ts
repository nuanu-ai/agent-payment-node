/**
 * 0.5.108: a native transfer whose sending command ended after its effect marker (`effect_started`, the helper path, both
 * usage holds still `reserved`). Observing it, under the operation lock the sender held for its whole run, first records
 * it UNKNOWN with an `interrupted` diagnostic and moves both holds to `unknown_finality`, before any read can add a hash,
 * a receipt or the owner's task. So a hash the server names settles through the receipt, and a later status no longer
 * fails on a hold that was never moved. A record without the helper path (0.5.107 and earlier) is left as it is.
 * The vendor and chain reads are doubles; the state, the journal, the usage ledger and the sealed reference are real.
 * Nothing here imports helpers.ts: it loads src/core.js before the mocks below could apply.
 */
import assert from "node:assert/strict";
import { chmod, cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { mock } from "node:test";
import { ReferenceTestSecret, referenceTemporaryState } from "./provider-request-reference-helpers.js";

const RID = "8cc50f3c-ca4e-41d1-98bb-b30f7bcaa3aa", TX = `0x${"e".repeat(64)}` as const, EXPIRES = "2099-10-20T09:51:13.922Z";
const EVIDENCE = "8aeaabee731ce6e603fddc324702a37abb45dd59d434101acabfab015027d46a";
const FIXTURE = "tests/fixtures/legacy-corpus/45-v0543-metamask-native-driver-resolver-late";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type Answer = Record<string, unknown> & { readonly disposition: string };
let answer: Answer | undefined, serverReads: string[] = [];
mock.module("../../src/metamask-native-transfer-adapter.js", { namedExports: {
  MetaMaskNativeHandoffNotStarted: class extends Error {},
  readMetaMaskNativeVendorPolicy: async () => { throw new Error("TEST no vendor policy read"); },
  submitOwnedMetaMaskNative: async () => { throw new Error("TEST no hand-off"); },
  readMetaMaskNativeRequest: async () => { throw new Error("TEST a helper hand-off is never watched through mm"); },
  readMetaMaskNativeSdkRequest: async (requestId: string) => { serverReads.push(requestId); assert.ok(answer, "unexpected server read"); return answer; },
} });
let receipts = 0;
mock.module("../../src/metamask-native-transfer-rpc.js", { namedExports: {
  prepareMetaMaskNativeQuote: async () => { throw new Error("TEST no quote"); },
  readMetaMaskNativeFunding: async () => { throw new Error("TEST no funding read"); },
  observeMetaMaskNativeTransfer: async (quote: Record<string, any>, transactionHash: string) => {
    receipts += 1;
    const { validateMetaMaskNativeFeeReceipt, metaMaskNativeQuoteTransfer } = await import("../../src/metamask-native-fee-evidence.js");
    const transfer = metaMaskNativeQuoteTransfer(quote as never), word = (value: string) => `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
    const block = { numberAtomic: "101", hash: `0x${"b".repeat(64)}` }, t = quote.transaction;
    const evidence = { schemaVersion: "apn.metamask-native-fee-receipt.v1", quoteHash: quote.quoteHash, transactionHash, chainId: quote.chainId,
      sender: quote.sender, to: t.to, valueAtomic: "0", transactionType: 2, nonceAtomic: t.nonceAtomic, data: t.data, gasLimitAtomic: t.gasLimitAtomic,
      maxFeePerGasAtomic: t.maxFeePerGasAtomic, maxPriorityFeePerGasAtomic: t.maxPriorityFeePerGasAtomic, authorizationList: [], status: "success",
      gasUsedAtomic: "50000", effectiveGasPriceAtomic: "150", receiptBlock: block, canonicalBlock: block,
      logs: [{ address: quote.token, topics: [TRANSFER_TOPIC, word(quote.sender), word(transfer.recipient)],
        data: `0x${BigInt(transfer.amountAtomic).toString(16).padStart(64, "0")}` }], rpcOrigin: "https://test-rpc.example", observedAt: new Date().toISOString() };
    return { kind: "accepted", evidence, receipt: validateMetaMaskNativeFeeReceipt(evidence, quote) };
  },
} });
const { readMetaMaskNativeTransfer } = await import("../../src/metamask-native-transfer-owner.js");
const { MetaMaskNativeJournal, metaMaskNativeRequestIdHash, metaMaskNativeRequestReference } = await import("../../src/metamask-native-journal.js");
const { EncryptedProviderRequestReferenceStore } = await import("../../src/provider-request-reference-store.js");
const { canonicalJson, hashObject } = await import("../../src/canonical.js");
const { seal, withoutDigest } = await import("../../src/asset-usage-ledger-record.js");

const HASH = metaMaskNativeRequestIdHash(RID);
const observation = (status: string | null, verified: boolean, transactionHash: string | null) => Object.freeze({ stage: "complete", guard_step: null,
  request_id: RID, watch_returned: false, before_guard_verified: true, after_guard_verified: true, request_identity_verified: verified,
  provider_status: status, transaction_hash: transactionHash, chain_id: verified ? 1 : null, response_hash: null, reason: null, error_code: null,
  diagnostic: null, server_read: Object.freeze({ outcome: verified ? "verified" : "not_found", response_hash: verified ? EVIDENCE : null, reason: null, check: null }) });

async function ownerOnly(path: string): Promise<void> {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await ownerOnly(join(path, entry.name)); else await chmod(join(path, entry.name), 0o600);
  }
}
/** Every usage row of the state by reservation id, with its path. */
async function rows(root: string): Promise<Map<string, { readonly path: string; readonly row: Record<string, unknown> }>> {
  const found = new Map<string, { path: string; row: Record<string, unknown> }>();
  for (const name of await readdir(join(root, "asset-usage"), { recursive: true })) {
    if (!/[a-f0-9]{64}\.json$/u.test(name)) continue;
    const path = join(root, "asset-usage", name), row = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    found.set(row.reservationId as string, { path, row });
  }
  return found;
}

/**
 * A corpus transfer rewritten as a 0.5.108 command leaves it when its process dies after the effect marker: the request id
 * sealed, the marker naming its hash and the helper path, no outcome, both holds still `reserved`.
 */
async function interrupted(t: test.TestContext, handoffPath: boolean = true) {
  const temporary = await referenceTemporaryState(); t.after(temporary.cleanup);
  const root = temporary.root;
  await cp(FIXTURE, root, { recursive: true }); await ownerOnly(root);
  await new MetaMaskNativeJournal(root).initialize();
  const directory = join(root, "metamask-native-operations"), [file] = await readdir(directory), path = join(directory, file!);
  const { recordHash: _hash, diagnostic: _diagnostic, ...saved } = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const body = { ...saved, state: "effect_started", ...(handoffPath ? { providerRequestIdHash: HASH, handoffPath: "sdk_helper" } : {}) };
  await writeFile(path, `${canonicalJson({ ...body, recordHash: hashObject(body) })}\n`, { mode: 0o600 });
  const id = file!.slice(0, 64), journal = new MetaMaskNativeJournal(root), op = (await journal.read(id))!;
  for (const reservation of op.reservations) {
    const { path: rowPath, row } = (await rows(root)).get(reservation.reservationId)!;
    const { consumedAtomic: _consumed, ...current } = withoutDigest(row as never) as unknown as Record<string, unknown>;
    await writeFile(rowPath, `${canonicalJson(seal({ ...current, state: "reserved", updatedAt: current.reservedAt, effectAt: null, outcomeDigest: null } as never))}\n`,
      { mode: 0o600 });
  }
  const references = new EncryptedProviderRequestReferenceStore({ root }, new ReferenceTestSecret());
  if (handoffPath) await references.seal(metaMaskNativeRequestReference(op, HASH), RID);
  serverReads = []; receipts = 0; answer = undefined;
  return { root, id, journal, references, op };
}
const holdStates = async (root: string, op: { readonly reservations: readonly { readonly reservationId: string }[] }) => {
  const all = await rows(root);
  return op.reservations.map(reservation => all.get(reservation.reservationId)!.row.state);
};

test("a hash read for an interrupted hand-off settles through its receipt, and every later status succeeds", async (t) => {
  const { root, id, journal, references, op } = await interrupted(t);
  assert.deepEqual(await holdStates(root, op), ["reserved", "reserved"]);
  const status = await readMetaMaskNativeTransfer(root, id);
  assert.equal(status.state, "effect_started", "status alone writes nothing");
  assert.deepEqual(status.next_actions, [`apn wallet metamask native-transfer-observe --operation ${id}`]);
  assert.deepEqual(await holdStates(root, op), ["reserved", "reserved"]);
  answer = { disposition: "acknowledged", requestId: RID, transactionHash: TX, chainId: 1, readObservation: observation("CONFIRMED", true, TX) };
  const observed = await readMetaMaskNativeTransfer(root, id, true, references);
  assert.deepEqual([serverReads, receipts], [[RID], 1]);
  assert.equal(observed.state, "confirmed"); assert.equal(observed.transaction_hash, TX);
  assert.deepEqual(observed.diagnostic, { stage: "post_handoff", code: "interrupted", exitCode: null, signal: null, durationMs: 0, remainingMs: 0,
    stderrClass: "none", providerCode: "none" });
  const settled = await rows(root);
  const [native, token] = op.reservations.map(reservation => settled.get(reservation.reservationId)!.row);
  assert.deepEqual([native!.state, native!.consumedAtomic, token!.state], ["finalized", "7500000", "finalized"]);
  // The receipt's settlement no longer fails on a hold the crashed send never moved.
  for (const again of [await readMetaMaskNativeTransfer(root, id), await readMetaMaskNativeTransfer(root, id, true, references)]) {
    assert.equal(again.state, "confirmed");
  }
  assert.equal((await journal.read(id))?.handoffPath, "sdk_helper");
});

test("an interrupted hand-off MetaMask holds for MFA keeps the owner's task, and a 404 releases nothing", async (t) => {
  const mfa = await interrupted(t);
  answer = { disposition: "pending", requestId: RID, chainId: 1, mfa: { expiresAt: EXPIRES, authMethod: "qr", evidenceHash: EVIDENCE },
    readObservation: observation("AWAITING_MFA", true, null) };
  const pending = await readMetaMaskNativeTransfer(mfa.root, mfa.id, true, mfa.references);
  assert.equal(pending.state, "unknown"); assert.equal(pending.mfa_task?.status, "awaiting_owner"); assert.equal(pending.mfa_task?.expires_at, EXPIRES);
  assert.equal(pending.diagnostic?.code, "interrupted");
  assert.deepEqual(await holdStates(mfa.root, mfa.op), ["unknown_finality", "unknown_finality"]);
  const missing = await interrupted(t);
  answer = { disposition: "unknown", reason: "metamask_request_not_found_on_server", requestId: RID, readObservation: observation(null, false, null) };
  const notFound = await readMetaMaskNativeTransfer(missing.root, missing.id, true, missing.references);
  assert.equal(notFound.state, "unknown"); assert.equal(notFound.mfa_task, undefined); assert.equal(receipts, 0);
  assert.deepEqual(await holdStates(missing.root, missing.op), ["unknown_finality", "unknown_finality"], "a 404 proves nothing: no hold is released");
  // Observing again keeps both: the transition happens once.
  await readMetaMaskNativeTransfer(missing.root, missing.id, true, missing.references);
  assert.deepEqual(await holdStates(missing.root, missing.op), ["unknown_finality", "unknown_finality"]);
  assert.equal((await missing.journal.read(missing.id))?.state, "unknown");
});

test("an effect marker 0.5.107 or earlier wrote, with no helper path, is observed exactly as before", async (t) => {
  const { root, id, journal, references, op } = await interrupted(t, false);
  const before = await readFile(join(root, "metamask-native-operations", `${id}.json`));
  const observed = await readMetaMaskNativeTransfer(root, id, true, references);
  assert.equal(observed.state, "effect_started"); assert.equal(observed.read_observation?.reason, "no_stored_request_id");
  assert.deepEqual(serverReads, []); assert.deepEqual(await holdStates(root, op), ["reserved", "reserved"]);
  assert.deepEqual(await readFile(join(root, "metamask-native-operations", `${id}.json`)), before);
  assert.equal((await journal.read(id))?.diagnostic, undefined);
});
