import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { inspectPermit2Offer } from "../../src/x402-permit2/inspection.js";
import { X402_PERMIT2_ASSETS } from "../../src/x402-permit2/registry.js";

const accepts = (JSON.parse(readFileSync("tests/fixtures/x402-permit2/payment-required-accepts.json", "utf8")) as {
  accepts: Record<string, unknown>[];
}).accepts;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as `0x${string}`;

test("pure inspection returns the original Permit2 offer and list-pinned economics", () => {
  const input = structuredClone(accepts);
  const inspection = inspectPermit2Offer({ accepts: input, payer });
  const selected = input[1]!;

  assert.equal(inspection.index, 1);
  assert.deepEqual(inspection.requirement, selected);
  assert.equal(inspection.network, X402_PERMIT2_ASSETS[0]!.chain);
  assert.equal(inspection.asset, X402_PERMIT2_ASSETS[0]!.token);
  assert.equal(inspection.amountAtomic, "10000");
  assert.equal(inspection.payTo, selected.payTo);
  assert.equal(inspection.maxTimeoutSeconds, 60);
  assert.match(inspection.offerHash, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(inspection), true);
  assert.equal(Object.isFrozen(inspection.requirement), true);
  assert.equal(Object.isFrozen(inspection.requirement.extra), true);
  assert.deepEqual(input, accepts);
});

test("inspection retains canonical refusal reasons for unsupported offers", () => {
  assert.throws(() => inspectPermit2Offer({ accepts: [], payer }), (error: unknown) =>
    error instanceof ApnError && error.code === "APN_X402_UNSUPPORTED_OFFER" && error.details?.reason === "x402_permit2_no_listed_offer");

  assert.throws(() => inspectPermit2Offer({ accepts: [accepts[2]!], payer }), (error: unknown) =>
    error instanceof ApnError && error.code === "APN_X402_UNSUPPORTED_OFFER" && error.details?.reason === "x402_permit2_facilitator_unavailable");
});

test("inspection keeps invalid payer refusal before any offer output", () => {
  assert.throws(() => inspectPermit2Offer({ accepts, payer: "not-an-address" as `0x${string}` }), (error: unknown) =>
    error instanceof ApnError && error.code === "APN_INVALID_INPUT");
});
