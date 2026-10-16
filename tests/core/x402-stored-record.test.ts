import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { sealX402Operation, validateX402Operation, x402Fingerprint, type X402OperationRecord } from "../../src/x402-state-integrity.js";
import { TestClock, makeCore, temporaryState } from "./helpers.js";
import { ExactX402Native, QueuedHttp, RecoveryRpc, X402_TEST_ACCOUNT, challengeObservation } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

async function saved(t: test.TestContext): Promise<X402OperationRecord> {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const core = makeCore({ root: temporary.root, native: new ExactX402Native(), rpc, http: new QueuedHttp([challengeObservation()]), clock: new TestClock() });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const prepared = await core.execute({ command: "x402.fetch.prepare", profile: "default", url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey: "stored-record" });
  return await core.context.state.findX402Operation((prepared.operation as { readonly operationId: string }).operationId) as X402OperationRecord;
}

/** Rewrites the frozen offer and reseals every hash that covers it, as a record written by another release would be. */
function withOffer(record: X402OperationRecord, change: (offer: Record<string, unknown>) => void): X402OperationRecord {
  const offer = JSON.parse(record.selectedOffer.declaredCanonicalJson) as Record<string, unknown>;
  change(offer);
  const declaredCanonicalJson = canonicalJson(offer);
  const selectedOffer = { ...record.selectedOffer, declaredCanonicalJson, offerHash: domainHash("apn.x402.offer.v1", declaredCanonicalJson) };
  const { integrityHash: _integrityHash, ...body } = record;
  const next = { ...body, selectedOffer };
  return sealX402Operation({ ...next, fingerprint: x402Fingerprint({ ...next, fingerprint: "" } as X402OperationRecord) });
}

test("a saved operation is checked against its own frozen offer, not today's admission rules", async (t) => {
  const record = await saved(t);
  validateX402Operation(record);
  // Today's prepare refuses decimals other than 6 and unknown extras; a record that froze them still loads.
  validateX402Operation(withOffer(record, (offer) => { offer.extra = { ...(offer.extra as object), decimals: 18, note: "older seller field" }; }));
  for (const change of [
    (offer: Record<string, unknown>) => { offer.amount = "999"; },
    (offer: Record<string, unknown>) => { offer.payTo = `0x${"9".repeat(40)}`; },
    (offer: Record<string, unknown>) => { offer.extra = { ...(offer.extra as object), version: "9" }; },
    (offer: Record<string, unknown>) => { offer.maxTimeoutSeconds = 61; },
  ]) assert.throws(() => validateX402Operation(withOffer(record, change)), { code: "APN_STATE_CORRUPT" });
});
