import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { decodeAndNormalizePaymentResponseHeader, decodePaymentSignatureHeader } from "../../src/x402-codec.js";
import { Permit2ProductionResults } from "../../src/x402-permit2/production-results.js";
import { Permit2HttpObservationStore, permit2HttpLocatorHint, validatePermit2HttpLocatorHint } from "../../src/x402-permit2/production-http-observations.js";
import { reconstructPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { observePermit2Production } from "../../src/x402-permit2/production-observer.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";

const header = (value: unknown) => Buffer.from(canonicalJson(value)).toString("base64");
async function ready(t: TestContext) {
  const f = await journalFixture(t); await f.journal.markSignatureRisk(f.record.operationId);
  await f.journal.storeSigned(f.record.operationId, f.signed); const r = await f.journal.markRequestPending(f.record.operationId);
  const service = new Permit2ProductionResults(f.state, f.journal), plan = reconstructPermit2ProductionMaterial(r.material);
  const response = (extra: Record<string, unknown> = {}) => header({ success: true, transaction: f.input.locator,
    network: "eip155:43114", payer: plan.payer.toLowerCase(), amount: plan.amountAtomic, ...extra });
  const observation = (rawHeaderPairs: Array<[string, string]> = [], status = 200) => ({ status, rawHeaderPairs,
    bodyBytes: Buffer.from("private-body"), finalUrl: r.material.checked.request.url, errorReason: "private-secret-error" });
  return { ...f, r, service, response, observation, id: r.operationId,
    path: `${f.root}/permit2-production-http-observations/${r.operationId}.json` };
}
async function held(f: Awaited<ReturnType<typeof ready>>) { assert.equal((await f.journal.findOperation(f.id))!.terminal, false); assert.equal((await f.lease()).state, "unknown_finality"); }

test("strict response decoder accepts only explicit Avalanche network while default Base and generic Permit2 rejection remain unchanged", async t => {
  const f = await ready(t), p = reconstructPermit2ProductionMaterial(f.r.material), expected = { payer: p.payer.toLowerCase(), amountAtomic: p.amountAtomic };
  assert.equal(decodeAndNormalizePaymentResponseHeader(f.response(), { ...expected, network: "eip155:43114" }).classification, "success");
  for (const network of ["eip155:8453", "eip155:1", "eip155:42161"]) assert.throws(() => decodeAndNormalizePaymentResponseHeader(f.response({ network }), { ...expected, network: "eip155:43114" }));
  assert.throws(() => decodeAndNormalizePaymentResponseHeader(f.response(), expected));
  assert.equal(decodeAndNormalizePaymentResponseHeader(f.response({ network: "eip155:8453" }), expected).classification, "success");
  assert.throws(() => decodePaymentSignatureHeader(f.r.exposureJournal!.signed!.paymentSignatureHeader));
});
test("real owned first sidecar writes only bounded digests/classification/locator, is immutable, and never marks paid", async t => {
  const f = await ready(t), observation = f.observation([["payment-response", f.response()]]);
  assert.equal((await f.service.recordHttp(f.id, observation)).code, "hint_saved");
  const bytes = await readFile(f.path, "utf8"), hint = JSON.parse(bytes);
  assert.equal(hint.classification, "success_hint"); assert.equal(hint.locator, f.input.locator);
  assert.equal((await f.service.recordHttp(f.id, observation)).code, "hint_saved"); assert.equal(await readFile(f.path, "utf8"), bytes);
  assert.equal((await f.service.recordHttp(f.id, f.observation([], 402))).code, "hint_unavailable"); assert.equal(await readFile(f.path, "utf8"), bytes); await held(f);
  for (const secret of [f.response(), "private-body", "private-secret-error", f.r.material.checked.request.url, f.r.exposureJournal!.signed!.permit2Signature]) assert.equal(bytes.includes(secret), false);
});
for (const fault of ["duplicate", "alias", "folded", "control", "wrong-network", "wrong-payer", "wrong-amount", "conflicting-tx"] as const)
  test(`strict ${fault} payment response cannot produce a locator or terminal outcome`, async t => {
    const f = await ready(t), valid = f.response(); let pairs: Array<[string, string]> = [["payment-response", valid]];
    if (fault === "duplicate") pairs.push(["Payment-Response", valid]); if (fault === "alias") pairs.push(["x-payment-response", valid]);
    if (fault === "folded") pairs = [["payment-response", valid + "," + valid]]; if (fault === "control") pairs = [["payment-response", valid + "\n"]];
    if (fault === "wrong-network") pairs = [["payment-response", f.response({ network: "eip155:8453" })]];
    if (fault === "wrong-payer") pairs = [["payment-response", f.response({ payer: `0x${"4".repeat(40)}` })]];
    if (fault === "wrong-amount") pairs = [["payment-response", f.response({ amount: "1" })]];
    if (fault === "conflicting-tx") pairs = [["payment-response", f.response({ txHash: `0x${"f".repeat(64)}` })]];
    const hint = permit2HttpLocatorHint(f.r, f.observation(pairs)); assert.equal(hint.classification, "invalid_response"); assert.equal(hint.locator, null);
    assert.equal((await f.service.recordHttp(f.id, f.observation(pairs))).code, "hint_saved"); const before = f.batches.length;
    assert.equal((await f.service.observe(f.id, f.input.rpcUrl)).code, "held"); assert.equal(f.batches.length, before); await held(f);
  });
for (const state of ["200-no-header", "402", "pending", "failure"] as const) test(`${state} HTTP observation alone leaves genuine common usage held`, async t => {
  const f = await ready(t), extra = state === "pending" ? { success: false, errorReason: "settlement_pending" } : state === "failure" ? { success: false, errorReason: "private-secret-error" } : {};
  const pairs: Array<[string, string]> = state === "200-no-header" || state === "402" ? [] : [["payment-response", f.response(extra)]];
  const result = await f.service.recordHttp(f.id, f.observation(pairs, state === "402" ? 402 : 200)); assert.equal(result.code, "hint_saved");
  assert.equal(JSON.stringify(result).includes("private-secret-error"), false); assert.equal((await readFile(f.path, "utf8")).includes("private-secret-error"), false); await held(f);
});
test("strict sidecar codec rejects operation/hash/raw extras and genuine store refuses mismatched/corrupt first hint", async t => {
  const f = await ready(t), hint = permit2HttpLocatorHint(f.r, f.observation([["payment-response", f.response()]]));
  for (const value of [{ ...hint, operationId: "f".repeat(64) }, { ...hint, signedHash: "f".repeat(64) }, { ...hint, materialHash: "f".repeat(64) }, { ...hint, response: f.response() }, { ...hint, locator: `0x${"A".repeat(64)}` }]) assert.throws(() => validatePermit2HttpLocatorHint(value, f.r));
  await f.service.recordHttp(f.id, f.observation([["payment-response", f.response()]]));
  await writeFile(f.path, "{corrupt", { mode: 0o600 }); assert.equal((await f.service.recordHttp(f.id, f.observation())).code, "hint_unavailable");
  assert.equal((await f.service.observe(f.id, f.input.rpcUrl)).code, "hint_unavailable"); await held(f);
});
test("actual sidecar I/O failure returns bounded hold without echo or financial mutation", async t => {
  const f = await ready(t), original = (SecureStateStore.prototype as any).writeJson;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, ...args: any[]) {
    if (path.startsWith("permit2-production-http-observations/")) throw new Error("private-secret-error"); return original.call(this, path, ...args);
  });
  const result = await f.service.recordHttp(f.id, f.observation([["payment-response", f.response()]])); assert.equal(result.code, "hint_unavailable");
  assert.equal(JSON.stringify(result).includes("private-secret-error"), false); await held(f);
});
test("forged proof/hint cannot finalize; explicit later candidate probes actual readonly observer despite bad saved locator", async t => {
  const f = await ready(t), wrong = `0x${"f".repeat(64)}`;
  await f.service.recordHttp(f.id, f.observation([["payment-response", f.response({ transaction: wrong })]]));
  await assert.rejects(f.journal.finalize(f.id, { kind: "checked-permit2-production-observation" }, "settlement"));
  assert.equal((await f.service.observe(f.id, f.input.rpcUrl)).code, "observed_hold"); await held(f);
  const bytes = await readFile(f.path, "utf8"), result = await f.service.observe(f.id, f.input.rpcUrl, "settlement", f.input.locator);
  assert.equal(result.code, "finalized"); assert.equal(result.status?.state, "settled"); assert.equal((await f.lease()).state, "finalized");
  assert.equal(await readFile(f.path, "utf8"), bytes); assert.equal(JSON.stringify(result).includes(f.input.rpcUrl), false);
});
test("explicit candidate bypasses corrupt hint but still needs genuine canonical effect; no HTTP or resign path", async t => {
  const f = await ready(t); await f.service.recordHttp(f.id, f.observation()); await writeFile(f.path, "{corrupt", { mode: 0o600 });
  f.wire.missing = true; assert.equal((await f.service.observe(f.id, f.input.rpcUrl, "settlement", f.input.locator)).code, "observed_hold"); await held(f);
  f.wire.missing = false; assert.equal((await f.service.observe(f.id, f.input.rpcUrl, "settlement", f.input.locator)).code, "finalized");
});
test("prepared/reserved and exposed unsigned rows return sanitized status without RPC", async t => {
  const f = await journalFixture(t), service = new Permit2ProductionResults(f.state, f.journal), before = f.batches.length;
  assert.equal((await service.observe(f.record.operationId, f.input.rpcUrl)).code, "not_exposed");
  await f.journal.markSignatureRisk(f.record.operationId); assert.equal((await service.observe(f.record.operationId, f.input.rpcUrl, "expired_unused")).code, "not_exposed");
  assert.equal(f.batches.length, before);
});
test("explicit expired_unused mode uses finalized unused-nonce proof, never HTTP failure/timeout", async t => {
  const f = await ready(t); await f.service.recordHttp(f.id, f.observation([], 500));
  // The wire fixture selects the asserted canonical read block from this test-only mode.
  (f.input as { mode: string }).mode = "expired_unused";
  f.wire.finalized.timestamp = `0x${(f.record.material.signingSecond + 1).toString(16)}`;
  assert.equal((await f.service.observe(f.id, f.input.rpcUrl, "expired_unused")).code, "observed_hold"); await held(f);
  f.wire.finalized.timestamp = `0x${(f.record.material.signingSecond + 61).toString(16)}`;
  const result = await f.service.observe(f.id, f.input.rpcUrl, "expired_unused"); assert.equal(result.status?.state, "expired_no_effect"); assert.equal((await f.lease()).state, "released_unsubmitted");
});
test("genuine finalization write failure preserves own verdict and terminal ledger reconciliation uses no new RPC", async t => {
  const f = await ready(t), original = (SecureStateStore.prototype as any).writeJson; let fail = true;
  t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...args: any[]) {
    if (fail && path.startsWith("permit2-production/") && value?.state === "settled") { fail = false; throw new Error("private-secret-error"); }
    return original.call(this, path, value, ...args);
  });
  const heldResult = await f.service.observe(f.id, f.input.rpcUrl, "settlement", f.input.locator); assert.equal(heldResult.code, "held");
  const pending = (await f.journal.findOperation(f.id))!, digest = pending.exposureJournal!.terminalIntent!.outcomeDigest;
  assert.equal(pending.state, "terminal_pending"); assert.equal((await f.lease()).state, "finalized"); const before = f.batches.length;
  const recovered = await f.service.observe(f.id, f.input.rpcUrl); assert.equal(recovered.code, "reconciled"); assert.equal(recovered.status?.state, "settled");
  assert.equal(f.batches.length, before); assert.equal((await f.journal.findOperation(f.id))!.exposureJournal!.terminalIntent!.outcomeDigest, digest);
  assert.equal((await f.service.observe(f.id, f.input.rpcUrl)).code, "terminal"); assert.equal(f.batches.length, before);
});
test("usage transition failure retains verdict; later actual observer proof renews accounting authority without rewriting intent", async t => {
  const f = await ready(t), original = AssetUsageLedger.prototype.transition; let fail = true;
  t.mock.method(AssetUsageLedger.prototype, "transition", async function(this: AssetUsageLedger, input: Parameters<typeof original>[0]) {
    if (fail && input.state === "finalized") { fail = false; throw new Error("private-secret-error"); } return original.call(this, input);
  });
  assert.equal((await f.service.observe(f.id, f.input.rpcUrl, "settlement", f.input.locator)).code, "held");
  const pending = (await f.journal.findOperation(f.id))!, digest = pending.exposureJournal!.terminalIntent!.outcomeDigest;
  assert.equal(pending.state, "terminal_pending"); assert.equal((await f.lease()).state, "unknown_finality");
  const result = await f.service.observe(f.id, f.input.rpcUrl); assert.equal(result.status?.state, "settled"); assert.equal((await f.lease()).state, "finalized");
  assert.equal((await f.journal.findOperation(f.id))!.exposureJournal!.terminalIntent!.outcomeDigest, digest);
});

test("unsigned terminal intent reconciles actual released ledger without new RPC or signature", async t => {
  const f = await journalFixture(t), id = f.record.operationId;
  await f.journal.markSignatureRisk(id); f.advance(120);
  const checked = await f.observe("expired_unused"); assert.ok(checked.proof);
  const original = (SecureStateStore.prototype as any).writeJson;
  const fault = t.mock.method(SecureStateStore.prototype as any, "writeJson", async function(this: SecureStateStore, path: string, value: any, ...args: any[]) {
    if (value?.state === "expired_no_effect") throw new Error("synthetic terminal write failure");
    return original.call(this, path, value, ...args);
  });
  await assert.rejects(f.journal.finalize(id, checked.proof, "expired_unused")); fault.mock.restore();
  assert.equal((await f.lease()).state, "released_unsubmitted");
  const pending = (await f.journal.findOperation(id))!, digest = pending.exposureJournal!.terminalIntent!.outcomeDigest;
  assert.equal(pending.exposureJournal!.signed, null); const before = f.batches.length;
  const result = await new Permit2ProductionResults(f.state, f.journal).observe(id, f.input.rpcUrl, "expired_unused");
  assert.equal(result.code, "reconciled"); assert.equal(result.status?.state, "expired_no_effect"); assert.equal(f.batches.length, before);
  assert.equal((await f.journal.findOperation(id))!.exposureJournal!.terminalIntent!.outcomeDigest, digest);
});
