import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../fixtures/jupiter-v1/material.js";
import { receipt } from "../fixtures/jupiter-v1/scenarios.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { validateFinalizedJupiterV1Receipt } from "../../src/swap/jupiter-solana/v1-proof.js";

async function evidence(index: unknown) {
  const guarded = await guardJupiterV1WhirlpoolMaterial(fixture());
  const saved = receipt(guarded);
  const response = { ...saved.response, transactionIndex: index };
  return {
    guarded, saved, response,
    reader: { async call(method: string) {
      return method === "getSignatureStatuses" ? saved.status : response;
    } },
  };
}

// Agave EncodedConfirmedTransactionWithStatusMeta carries Option<u32>.
// This observed metadata never substitutes for signature, slot or effect proof.
for (const [name, index] of [
  ["zero", 0], ["live index", 1368], ["u32 maximum", 4294967295],
  ["bigint zero", 0n], ["bigint maximum", 4294967295n], ["null", null],
] as const) {
  test(`V1 finalized receipt admits optional transactionIndex: ${name}`, async () => {
    const e = await evidence(index);
    const proof = await validateFinalizedJupiterV1Receipt(e.reader, e.guarded, { signature: e.saved.signature });
    assert.equal(proof.recipientOutputAtomic, "116130");
    assert.equal(proof.nativeSpendLamports, "1006400");
  });
}

for (const [name, index] of [
  ["negative", -1], ["negative bigint", -1n], ["fraction", 1.5],
  ["u32 overflow", 4294967296], ["bigint u32 overflow", 4294967296n],
  ["string", "1368"], ["boolean", true], ["object", {}],
  ["unsafe number", Number.MAX_SAFE_INTEGER + 1], ["NaN", NaN], ["infinity", Infinity],
] as const) {
  test(`V1 finalized receipt rejects malformed transactionIndex: ${name}`, async () => {
    const e = await evidence(index);
    await assert.rejects(validateFinalizedJupiterV1Receipt(e.reader, e.guarded, { signature: e.saved.signature }));
  });
}

test("V1 finalized transactionIndex is retained in the authenticated response digest", async () => {
  const e = await evidence(1368);
  const first = await validateFinalizedJupiterV1Receipt(e.reader, e.guarded, { signature: e.saved.signature });
  e.response.transactionIndex = 1369;
  const second = await validateFinalizedJupiterV1Receipt(e.reader, e.guarded, { signature: e.saved.signature });
  assert.notEqual(first.receiptHash, second.receiptHash);
});

for (const kind of ["unknown field", "nonfinal status", "payer debit", "wrong signature"] as const) {
  test(`V1 transactionIndex preserves ${kind} refusal`, async () => {
    const e = await evidence(1368);
    if (kind === "unknown field") Object.assign(e.response, { ownerSafetyVerified: true });
    if (kind === "nonfinal status") e.saved.status.value[0]!.confirmationStatus = "confirmed";
    if (kind === "payer debit") e.response.meta.postBalances[0]!--;
    const signature = kind === "wrong signature" ? e.saved.signature.slice(0, -1) + (e.saved.signature.endsWith("1") ? "2" : "1") : e.saved.signature;
    await assert.rejects(validateFinalizedJupiterV1Receipt(e.reader, e.guarded, { signature }));
  });
}
