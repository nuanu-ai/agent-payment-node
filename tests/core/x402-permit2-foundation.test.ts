import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hashDomain, hashTypedData } from "viem";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { ApnError } from "../../src/errors.js";
import { PERMIT2_WITNESS_TYPES, planPermit2Authorization } from "../../src/x402-permit2/authorization.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS } from "../../src/x402-permit2/registry.js";
import { permit2NonceBitmapCall, permit2NonceConsumed, verifyPermit2SettlementReceipt } from "../../src/x402-permit2/settlement.js";

const accepts = (JSON.parse(readFileSync("tests/fixtures/x402-permit2/payment-required-accepts.json", "utf8")) as { accepts: Record<string, unknown>[] }).accepts;
const asset = X402_PERMIT2_ASSETS[0]!;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as `0x${string}`;

test("registry and typed-data bind chain, token, proxy, payee, amount and deadline", () => {
  assert.equal(loadAllowlistInventory().assets.some((row) => row.identifier === asset.token), true);
  const selection = selectPermit2Offer(accepts, payer);
  const plan = planPermit2Authorization(selection, { payer, nowSeconds: 1_789_720_000, nonce: 7n, permit2AllowanceAtomic: "10000", eip2612Nonce: null, sellerSponsorsEip2612: false });
  assert.equal(plan.authorization.permitted.token, asset.token);
  assert.equal(plan.authorization.permitted.amount, selection.amountAtomic);
  assert.equal(plan.authorization.spender, X402_EXACT_PERMIT2_PROXY);
  assert.equal(plan.authorization.witness.to, selection.payTo);
  assert.equal(plan.authorization.deadline, "1789720060");
  assert.equal(hashTypedData(plan.permit2 as never), hashTypedData({ domain: { name: "Permit2", chainId: asset.chainId, verifyingContract: PERMIT2_ADDRESS }, types: PERMIT2_WITNESS_TYPES, primaryType: "PermitWitnessTransferFrom", message: { permitted: { token: asset.token, amount: 10000n }, spender: X402_EXACT_PERMIT2_PROXY, nonce: 7n, deadline: 1789720060n, witness: { to: selection.payTo, validAfter: 0n } } } as never));
  assert.match(plan.planHash, /^[a-f0-9]{64}$/u);
});

test("unsupported offers and missing allowance refuse with stable reasons", () => {
  assert.throws(() => selectPermit2Offer([], payer), (e: unknown) => e instanceof ApnError && e.details?.reason === "x402_permit2_no_listed_offer");
  const selection = selectPermit2Offer(accepts, payer);
  assert.throws(() => planPermit2Authorization(selection, { payer, nowSeconds: 1, nonce: 1n, permit2AllowanceAtomic: "0", eip2612Nonce: null, sellerSponsorsEip2612: false }), (e: unknown) => e instanceof ApnError && e.details?.reason === "x402_permit2_allowance_required");
});

test("read-only nonce probe is exact and receipt evidence is independently validated", () => {
  const call = permit2NonceBitmapCall(payer, "259");
  assert.equal(call.to, PERMIT2_ADDRESS);
  assert.equal(permit2NonceConsumed(`0x${"0".repeat(63)}8`, "3"), true);
  assert.equal(permit2NonceConsumed(`0x${"0".repeat(63)}8`, "2"), false);
  const fixture = JSON.parse(readFileSync("tests/fixtures/x402-permit2/settlement-receipt-with-permit.json", "utf8")) as any;
  const proof = verifyPermit2SettlementReceipt(fixture.receipt, { listAsset: asset, payer: fixture.payer, payTo: fixture.payTo, amountAtomic: fixture.amountAtomic, transactionHash: fixture.receipt.transactionHash, withPermit: true });
  assert.equal(proof.settledEvent, "SettledWithPermit");
});
