import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { decodePaymentRequiredHeader } from "../../src/x402-codec.js";
import { hashChallenge, preparePermit2Payment, preparePermit2WithPort, type Permit2PrepareInput } from "../../src/x402-permit2/prepare.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import type { PaymentRequired } from "@x402/core/types";

const accepts = (JSON.parse(readFileSync("tests/fixtures/x402-permit2/payment-required-accepts.json", "utf8")) as { accepts: unknown[] }).accepts;
const asset = X402_PERMIT2_ASSETS[0]!;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as `0x${string}`;
const sponsoringDeclaration = {
  info: { description: "The facilitator accepts EIP-2612 gasless Permit to `Permit2` canonical contract.", version: "1" },
  schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
    properties: Object.fromEntries(["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"]
      .map((field) => [field, { type: "string", pattern: ".+" }])),
    required: ["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"] },
};
const challenge: PaymentRequired = { x402Version: 2, resource: { url: "https://seller.example/data" },
  accepts: accepts as PaymentRequired["accepts"] };
const selection = selectPermit2Offer(accepts, payer);
const base: Permit2PrepareInput = {
  payer, localWallet: true, challenge,
  expected: { index: selection.index, requirement: selection.requirement, challengeHash: hashChallenge(challenge) },
  owner: { active: true, account: payer, chain: asset.chain, token: asset.token, rail: "x402",
    mechanism: X402_PERMIT2_MECHANISM, maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000",
    usedTodayAtomic: "5000", policyDigest: "a".repeat(64) },
  evidence: { chainId: 43114, account: payer, observedAtSeconds: 1_789_719_995,
    balanceAtomic: "20000", allowanceAtomic: "10000",
    tokenDomainSeparator: asset.tokenDomainSeparator, proxyCodeHash: asset.proxyCodeHash,
    permit2Deployed: true, nonceBitmapWordIndex: "0", nonceBitmapWord: `0x${"0".repeat(64)}`, eip2612Nonce: null,
    facilitator: { available: true, network: asset.chain, scheme: "exact", asset: asset.token,
      assetTransferMethod: "permit2", permit2Address: PERMIT2_ADDRESS, exactProxy: X402_EXACT_PERMIT2_PROXY,
      eip2612GasSponsoring: false } },
  nowSeconds: 1_789_720_000, nonce: 7n,
};

function refused(input: Permit2PrepareInput, reason: string): void {
  assert.throws(() => preparePermit2Payment(input), (error: unknown) =>
    error instanceof ApnError && error.code === "APN_X402_UNSUPPORTED_OFFER" && error.details?.reason === reason);
}

test("prepares exact unsigned material bound to merchant, owner policy, domain, and proxy", () => {
  const result = preparePermit2Payment(base);
  assert.equal(result.chain, "eip155:43114");
  assert.equal(result.token, asset.token);
  assert.equal(result.amountAtomic, "10000");
  assert.equal(result.payTo, selection.payTo);
  assert.equal(result.expiresAtUnix, "1789720060");
  assert.equal(result.plan.permit2.domain.verifyingContract, PERMIT2_ADDRESS);
  assert.equal(result.plan.authorization.spender, X402_EXACT_PERMIT2_PROXY);
  assert.equal(result.plan.eip2612, null);
  assert.equal(Object.isFrozen(result.plan.selection.requirement.extra), true);
  assert.equal(Object.isFrozen(result.plan.permit2.message), true);
  assert.match(result.prepareHash, /^[a-f0-9]{64}$/u);
});

test("read port receives the exact nonce word before it supplies authenticated observations", async () => {
  let called = false;
  const result = await preparePermit2WithPort({ read: async (request) => {
    called = true;
    assert.equal(request.challengeHash, base.expected.challengeHash);
    assert.equal(request.chainId, 43114);
    assert.equal(request.token, asset.token);
    return { owner: base.owner, evidence: { ...base.evidence, nonceBitmapWordIndex: request.nonceBitmapWordIndex } };
  } }, { payer, localWallet: true, challenge, expected: base.expected, nowSeconds: base.nowSeconds });
  assert.equal(called, true);
  assert.equal(result.plan.authorization.nonce, String(result.plan.permit2.message.nonce));
});

test("read port extra keys cannot override payer, challenge, expected terms, or clock", async () => {
  const poisoned = { owner: base.owner, evidence: base.evidence, payer: "0x1111111111111111111111111111111111111111",
    localWallet: false, challenge: { ...challenge, accepts: [] }, expected: { ...base.expected, challengeHash: "b".repeat(64) },
    nowSeconds: 0 };
  const result = await preparePermit2WithPort({ read: async (request) => ({
    ...poisoned, evidence: { ...poisoned.evidence, nonceBitmapWordIndex: request.nonceBitmapWordIndex },
  }) }, { payer, localWallet: true, challenge, expected: base.expected, nowSeconds: base.nowSeconds });
  assert.equal(result.payer, payer);
  assert.equal(result.challengeHash, base.expected.challengeHash);
  assert.equal(result.amountAtomic, "10000");
});

test("short allowance prepares exact amount EIP-2612 only with merchant and facilitator sponsorship", () => {
  const input = { ...base, challenge: { ...challenge, extensions: { eip2612GasSponsoring: sponsoringDeclaration } },
    evidence: { ...base.evidence, allowanceAtomic: "0", eip2612Nonce: "9",
      facilitator: { ...base.evidence.facilitator, eip2612GasSponsoring: true } } };
  input.expected = { ...base.expected, challengeHash: hashChallenge(input.challenge) };
  const result = preparePermit2Payment(input);
  assert.equal(result.plan.eip2612?.info.amount, "10000");
  assert.equal(result.plan.eip2612?.info.spender, PERMIT2_ADDRESS);
  assert.equal(result.plan.eip2612?.typedData.domain.name, "TetherToken");
});

test("decoded PAYMENT-REQUIRED sponsorship is preserved and bound to the challenge hash", () => {
  const wire = { ...challenge, extensions: { eip2612GasSponsoring: sponsoringDeclaration,
    futureExtension: { info: { required: false } } } };
  const decoded = decodePaymentRequiredHeader(Buffer.from(JSON.stringify(wire), "utf8").toString("base64"));
  assert.deepEqual(decoded.extensions, { eip2612GasSponsoring: sponsoringDeclaration });
  const short = { ...base, challenge: decoded, evidence: { ...base.evidence, allowanceAtomic: "0", eip2612Nonce: "9",
    facilitator: { ...base.evidence.facilitator, eip2612GasSponsoring: true } } };
  const expected = { ...base.expected, challengeHash: hashChallenge(decoded) };
  assert.ok(preparePermit2Payment({ ...short, expected }).plan.eip2612);
  refused({ ...short, expected: base.expected }, "x402_permit2_merchant_terms_mismatch");
  const { extensions: _removed, ...withoutSponsor } = decoded;
  refused({ ...short, challenge: withoutSponsor, expected }, "x402_permit2_merchant_terms_mismatch");
});

test("short allowance refuses absent sponsor, facilitator capability, and malformed or unsupported declarations", () => {
  const short = { ...base, evidence: { ...base.evidence, allowanceAtomic: "0", eip2612Nonce: "9",
    facilitator: { ...base.evidence.facilitator, eip2612GasSponsoring: true } } };
  refused(short, "x402_permit2_allowance_required");
  const sponsored = { ...short, challenge: { ...challenge, extensions: { eip2612GasSponsoring: sponsoringDeclaration } } };
  const expected = { ...base.expected, challengeHash: hashChallenge(sponsored.challenge) };
  refused({ ...sponsored, expected, evidence: { ...short.evidence,
    facilitator: { ...short.evidence.facilitator, eip2612GasSponsoring: false } } }, "x402_permit2_allowance_required");
  for (const declaration of [true, null, {}, { info: { description: "sponsor", version: "2" }, schema: {} },
    { info: { description: "sponsor", version: "1" }, schema: null }]) {
    const malformed = { ...challenge, extensions: { eip2612GasSponsoring: declaration } } as PaymentRequired;
    assert.throws(() => preparePermit2Payment({ ...short, challenge: malformed }),
      (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
    assert.throws(() => decodePaymentRequiredHeader(Buffer.from(JSON.stringify(malformed), "utf8").toString("base64")),
      (error: unknown) => error instanceof ApnError && error.code === "APN_HTTP_PROTOCOL");
  }
  assert.throws(() => preparePermit2Payment({ ...short, challenge: {
    ...challenge, eip2612GasSponsoring: true } as PaymentRequired }),
    (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
});

test("refuses merchant drift, wrong admission, cap and missing exact facilitator", () => {
  refused({ ...base, expected: { ...base.expected, challengeHash: "b".repeat(64) } }, "x402_permit2_merchant_terms_mismatch");
  refused({ ...base, owner: { ...base.owner, mechanism: { ...X402_PERMIT2_MECHANISM, reference: PERMIT2_ADDRESS } } }, "x402_permit2_owner_admission_required");
  refused({ ...base, owner: { ...base.owner, maximumPerTransferAtomic: "9999" } }, "x402_permit2_owner_cap_exceeded");
  refused({ ...base, evidence: { ...base.evidence, facilitator: { ...base.evidence.facilitator, exactProxy: PERMIT2_ADDRESS } } }, "x402_permit2_facilitator_unavailable");
});

test("refuses wrong chain/domain, spent nonce, low balance and unsponsored allowance", () => {
  refused({ ...base, evidence: { ...base.evidence, chainId: 1 } }, "x402_permit2_chain_evidence_required");
  refused({ ...base, evidence: { ...base.evidence, observedAtSeconds: 1_789_719_900 } }, "x402_permit2_chain_evidence_required");
  refused({ ...base, evidence: { ...base.evidence, tokenDomainSeparator: `0x${"0".repeat(64)}` } }, "x402_permit2_chain_evidence_required");
  refused({ ...base, evidence: { ...base.evidence, nonceBitmapWord: `0x${"0".repeat(63)}8` }, nonce: 3n }, "x402_permit2_nonce_consumed");
  assert.throws(() => preparePermit2Payment({ ...base, evidence: { ...base.evidence, nonceBitmapWordIndex: "1" } }),
    (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
  refused({ ...base, evidence: { ...base.evidence, balanceAtomic: "9999" } }, "x402_permit2_balance_insufficient");
  refused({ ...base, evidence: { ...base.evidence, allowanceAtomic: "0" } }, "x402_permit2_allowance_required");
});

test("refuses Ethereum USDT and arbitrary chains or assets", () => {
  for (const requirement of [accepts[2], { ...selection.requirement, network: "eip155:137" },
    { ...selection.requirement, asset: "0x1111111111111111111111111111111111111111" }]) {
    const next: PaymentRequired = { ...challenge, accepts: [requirement] as PaymentRequired["accepts"] };
    const input = { ...base, challenge: next,
      expected: { index: 0, requirement: requirement as typeof selection.requirement, challengeHash: hashChallenge(next) } };
    assert.throws(() => preparePermit2Payment(input), (error: unknown) => error instanceof ApnError && error.code === "APN_X402_UNSUPPORTED_OFFER");
  }
});
