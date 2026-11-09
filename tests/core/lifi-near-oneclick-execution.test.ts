import assert from "node:assert/strict";
import test from "node:test";
import { BridgeHttps } from "../../src/lifi/https.js";
import { OneClickSourceService, TtyOneClickSourceApproval } from "../../src/lifi/near-oneclick-source-service.js";
import { UNSTARTED_DEADLINE_MARGIN_MS } from "../../src/operation-index/adapters/family-claims.js";
import { harness, request } from "./lifi-near-oneclick-base-harness.js";

for (const ambiguous of [false, true]) test(`concrete 1Click service makes one ${ambiguous ? "ambiguous" : "accepted"} send`, async t => {
  const h = await harness(t, ambiguous);
  const result = await h.service.submit(request) as any;
  assert.equal(result.sourceState, ambiguous ? "unknown_finality" : "submitted_pending");
  assert.equal(result.submissionAttempts, 1); assert.equal(result.tronDestinationDelivered, false);
  assert.equal(h.sends(), 1); assert.equal(h.approvals(), 1);
  await assert.rejects(h.service.submit(request)); assert.equal(h.sends(), 1);
});
test("post-consent nonce drift fails before signing or sending", async t => {
  const h = await harness(t, false, true, () => h.changeNonce());
  await assert.rejects(h.service.submit(request), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(h.sends(), 0);
});
test("earlier provider deadline expires during consent before signing or send", async t => {
  const h = await harness(t, false, true, undefined, 70_000, 45_000);
  await assert.rejects(h.service.submit(request), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(h.approvals(), 1);
  assert.equal(h.sends(), 0);
});
test("forged constructor approval argument cannot bypass concrete TTY consent", async t => {
  const h = await harness(t, false, false);
  t.mock.method(TtyOneClickSourceApproval.prototype, "approve", async () => { throw Error("real consent required"); });
  const forged = new (OneClickSourceService as any)((h.service as any).state, (h.service as any).wrapping,
    { APN_BASE_RPC_URL: "https://base.example.org" }, new BridgeHttps(), Date.now, async () => {});
  await assert.rejects(forged.submit(request), /real consent required/u);
  assert.equal(h.sends(), 0);
});
test("source receipt and provider SUCCESS remain separate from independent TRON finality", async t => {
  const h = await harness(t);
  const submitted = await h.service.submit(request) as any;
  const observed = await h.service.status(submitted.operationId) as any;
  assert.equal(observed.sourceReceipt.safe, true);
  assert.equal(observed.sourceReceipt.status, "success");
  assert.equal(observed.tronDestinationClaimed, true);
  assert.equal(observed.tronDestinationFinalized, false);
});

test("safe Base source status rejects altered Transfer amount and block membership", async t => {
  const h = await harness(t);
  const submitted = await h.service.submit(request) as any;
  h.badLog();
  await assert.rejects(h.service.status(submitted.operationId), { code: "APN_OPERATION_BLOCKED" });
  h.badMembership();
  await assert.rejects(h.service.status(submitted.operationId), { code: "APN_OPERATION_BLOCKED" });
});

test("one ambiguous send reserves its nonce only until its deadline passes and the chain does not know its hash", async t => {
  const h = await harness(t, true);
  const first = await h.service.submit(request) as any; assert.equal(first.sourceState, "unknown_finality"); assert.equal(h.sends(), 1);
  // Before the old deadline the payer's claim (phase 4b) refuses before the quote, staging, consent or signing.
  await assert.rejects(h.service.submit({ ...request, idempotencyKey: "oneclick-second-try" }), { code: "APN_OPERATION_BLOCKED",
    details: { blockingOperationId: first.operationId, blockingState: "unknown_finality", blockingNetwork: "evm:8453",
      blockingAccount: request.expectedPayer.toLowerCase() } });
  assert.equal(h.approvals(), 1); assert.equal(h.sends(), 1);
  // After it (and the claim's margin), the unknown old hash cannot block the wallet: at most one of the two signed
  // transactions can use nonce 7, which the family's own reservation check still proves before staging.
  h.advance(200_000 + UNSTARTED_DEADLINE_MARGIN_MS);
  const second = await h.service.submit({ ...request, idempotencyKey: "oneclick-third-try" }) as any;
  assert.equal(second.submissionAttempts, 1); assert.equal(h.approvals(), 2); assert.equal(h.sends(), 2);
});
test("a one-wei Base fee tick after consent stays inside the signed fee cap and sends", async t => {
  const h = await harness(t, false, true, () => h.tickBaseFee());
  const result = await h.service.submit(request) as any;
  assert.equal(result.sourceState, "submitted_pending"); assert.equal(h.sends(), 1);
});
test("status persists the safe source receipt and a reverted source then answers from the journal with no RPC", async t => {
  const h = await harness(t);
  const submitted = await h.service.submit(request) as any; h.revert();
  const observed = await h.service.status(submitted.operationId) as any;
  assert.equal(observed.sourceState, "source_observed"); assert.equal(observed.sourceReceipt.status, "reverted");
  const posts = h.rpcPosts(), again = await h.service.status(submitted.operationId) as any;
  assert.equal(h.rpcPosts(), posts); assert.equal(again.sourceReceipt.status, "reverted"); assert.equal(again.providerStatusProvenance, "apn_journal");
  assert.equal(again.tronDestinationFinalized, false);
});
