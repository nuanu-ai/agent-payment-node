import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";
import { permit2Delivery, readPermit2Delivery } from "../../src/x402-permit2/production-delivery.js";
import { permit2HttpLocatorHint, validatePermit2HttpLocatorHint } from "../../src/x402-permit2/production-http-observations.js";
import { reconstructPermit2ProductionMaterial } from "../../src/x402-permit2/production-material.js";
import { Permit2ProductionResults } from "../../src/x402-permit2/production-results.js";
import { readPermit2ProductionStatus } from "../../src/x402-permit2/status.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { word } from "./x402-permit2-production-observer-fixture.js";

// APN-X402-PERMIT2-OBSERVE: payment (`state`) and the seller's answer (`delivery`) stay separate in every public view.
const BODY = Buffer.from("seller-result"), RESULT_HASH = domainHash("apn.x402.result-body.v1", BODY);
const header = (value: unknown) => Buffer.from(canonicalJson(value)).toString("base64");

async function sent(t: TestContext) {
  const f = await journalFixture(t); await f.journal.markSignatureRisk(f.record.operationId);
  await f.journal.storeSigned(f.record.operationId, f.signed); const r = await f.journal.markRequestPending(f.record.operationId);
  const service = new Permit2ProductionResults(f.state, f.journal), plan = reconstructPermit2ProductionMaterial(r.material);
  const response = (extra: Record<string, unknown> = {}) => header({ success: true, transaction: f.input.locator,
    network: "eip155:43114", payer: plan.payer.toLowerCase(), amount: plan.amountAtomic, ...extra });
  const answer = (rawHeaderPairs: Array<[string, string]> = [], status = 200) => ({ status, rawHeaderPairs, bodyBytes: BODY,
    finalUrl: r.material.checked.request.url });
  const settle = async () => {
    f.wire.settledBitmap = word(1n << 7n);
    return await service.observe(r.operationId, f.input.rpcUrl, "settlement", f.input.locator);
  };
  const views = async () => [await readPermit2ProductionStatus(f.root, "owner", r.operationId), await new OperationService(f.state).status(r.operationId)]
    .map(view => (view as { readonly delivery?: unknown }).delivery);
  return { ...f, r, id: r.operationId, service, response, answer, settle, views,
    path: `${f.root}/permit2-production-http-observations/${r.operationId}.json` };
}
const received = { state: "received", reason: null, httpStatus: 200, resultHash: RESULT_HASH, byteLength: String(BODY.byteLength) };

test("FINALIZED settlement with the seller's 2xx answer reads paid and delivered, the same in observe, status and operation status", async t => {
  const f = await sent(t);
  assert.equal((await f.service.recordHttp(f.id, f.answer([["payment-response", f.response()]]))).code, "hint_saved");
  const settled = await f.settle();
  assert.equal(settled.code, "finalized"); assert.equal(settled.status?.state, "settled"); assert.equal(settled.status?.capability, "completed");
  assert.deepEqual(settled.status?.delivery, received);
  assert.deepEqual(await f.views(), [received, received]);
  // Repeated observe changes nothing.
  const again = await f.service.observe(f.id, f.input.rpcUrl, "settlement", f.input.locator);
  assert.equal(again.code, "terminal"); assert.deepEqual(again.status, settled.status);
});

test("payment without an answer reads settled with delivery unconfirmed (no_answer)", async t => {
  const f = await sent(t), settled = await f.settle();
  assert.equal(settled.code, "finalized"); assert.equal(settled.status?.state, "settled");
  const unconfirmed = { state: "unconfirmed", reason: "no_answer", httpStatus: null, resultHash: null, byteLength: null };
  assert.deepEqual(settled.status?.delivery, unconfirmed); assert.deepEqual(await f.views(), [unconfirmed, unconfirmed]);
});

test("an answer without payment reads received while the operation stays unpaid and held", async t => {
  const f = await sent(t);
  await f.service.recordHttp(f.id, f.answer()); f.wire.settledBitmap = word(0n);
  const held = await f.service.observe(f.id, f.input.rpcUrl);
  assert.equal(held.code, "observed_hold"); assert.equal(held.status?.state, "request_pending"); assert.equal(held.status?.terminal, false);
  assert.deepEqual(held.status?.delivery, received);
});

for (const [name, pairs, status, reason] of [
  ["a 402 answer", [], 402, "answer_not_2xx"],
  ["a failure PAYMENT-RESPONSE", "failure", 200, "payment_response_refused"],
  ["a PAYMENT-RESPONSE for another payer", "wrong-payer", 200, "payment_response_refused"],
  ["a PAYMENT-RESPONSE naming another transaction", "other-tx", 200, "answer_names_other_transaction"],
] as const) test(`${name} with a proven settlement reads settled, delivery unconfirmed (${reason})`, async t => {
  const f = await sent(t);
  const paymentResponse = pairs === "failure" ? f.response({ success: false, errorReason: "private-secret-error" })
    : pairs === "wrong-payer" ? f.response({ payer: `0x${"4".repeat(40)}` })
    : pairs === "other-tx" ? f.response({ transaction: `0x${"f".repeat(64)}` }) : undefined;
  assert.equal((await f.service.recordHttp(f.id, f.answer(paymentResponse === undefined ? [] : [["payment-response", paymentResponse]], status))).code, "hint_saved");
  const settled = await f.settle();
  assert.equal(settled.code, "finalized"); assert.equal(settled.status?.state, "settled");
  assert.deepEqual(settled.status?.delivery, { state: "unconfirmed", reason, httpStatus: status, resultHash: RESULT_HASH, byteLength: String(BODY.byteLength) });
});

test("an unreadable saved answer reads answer_unreadable and never blocks the settled status", async t => {
  const f = await sent(t);
  await f.service.recordHttp(f.id, f.answer([["payment-response", f.response()]])); await writeFile(f.path, "{corrupt", { mode: 0o600 });
  const settled = await f.settle();
  assert.equal(settled.code, "finalized"); assert.equal(settled.status?.state, "settled");
  const unreadable = { state: "unconfirmed", reason: "answer_unreadable", httpStatus: null, resultHash: null, byteLength: null };
  assert.deepEqual(settled.status?.delivery, unreadable); assert.deepEqual(await f.views(), [unreadable, unreadable]);
});

test("an answer saved by 0.5.107–0.5.109 still reads, as delivery unconfirmed: it kept no body hash", async t => {
  const f = await sent(t), { bodyHash: _hash, bodyByteLength: _length, ...rest } = permit2HttpLocatorHint(f.r, f.answer()) as unknown as Record<string, unknown>;
  const v1 = validatePermit2HttpLocatorHint({ ...rest, schemaVersion: "apn.permit2-production-http-observation.v1" }, f.r);
  assert.deepEqual(permit2Delivery(f.r, v1), { state: "unconfirmed", reason: "answer_before_0_5_110", httpStatus: 200, resultHash: null, byteLength: null });
  assert.throws(() => validatePermit2HttpLocatorHint({ ...v1, bodyHash: RESULT_HASH, bodyByteLength: "13" }, f.r));
  assert.throws(() => validatePermit2HttpLocatorHint({ ...rest, schemaVersion: "apn.permit2-production-http-observation.v2" }, f.r));
});

test("before a paid request, delivery is not_requested and nothing is read", async t => {
  const f = await journalFixture(t), notRequested = { state: "not_requested", reason: null, httpStatus: null, resultHash: null, byteLength: null };
  assert.deepEqual(await readPermit2Delivery(f.root, f.reserved), notRequested);
  const exposed = await f.journal.markSignatureRisk(f.record.operationId);
  assert.deepEqual(await readPermit2Delivery(`${f.root}/missing`, exposed), notRequested, "no state read before a request");
  assert.deepEqual(((await readPermit2ProductionStatus(f.root, "owner", f.record.operationId)) as { readonly delivery?: unknown }).delivery, notRequested);
});
