import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { hashObject } from "../../src/canonical.js";
import { circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { assertCircleFundingFee, circleFundingBinding, deriveCircleFundingParameters,
  quoteCircleFundingFee, validateCircleFundingBinding } from "../../src/circle-v2-evm/funding-binding.js";
const now = Date.parse("2026-10-11T06:00:00.000Z");
// Synthetic beneficiary and signers, unrelated to any live wallet, profile or policy.
const p = { recipient: getAddress(`0x${"55".repeat(20)}`), amountAtomic: "1000000", maxFeeAtomic: "1000", minMintAtomic: "999000" };
const id = { sourceProfile: "cctp-source", sourceOwner: getAddress(`0x${"a1".repeat(20)}`), destinationProfile: "cctp-gas", gasPayer: getAddress(`0x${"b2".repeat(20)}`) };
const response = [{ finalityThreshold: 1000, minimumFee: 1.234567 }];
const binding = () => circleFundingBinding(1329, id, p);
test("all absent is legacy; partial and unknown funding fields refuse", () => {
  assert.equal(deriveCircleFundingParameters({}), null);
  assert.deepEqual(deriveCircleFundingParameters(p), p);
  for (const k of Object.keys(p)) { const x: Record<string, unknown> = { ...p }; delete x[k]; assert.throws(() => deriveCircleFundingParameters(x)); }
  assert.throws(() => deriveCircleFundingParameters({ ...p, skipConsent: true }));
});
for (const [chain, profiles] of [[1329, ["cctp-source", "cctp-gas"]], [1329, ["one-profile", "one-profile"]], [59144, ["alice", "bob"]], [143, ["carol", "dave.gas"]]] as const) {
  test(`funding metadata binds any profiles' ${chain}/${profiles.join("/")} wallets independently from beneficiary`, () => {
    const identity = { ...id, sourceProfile: profiles[0], destinationProfile: profiles[1] }, b = circleFundingBinding(chain, identity, p), r = circleRoute(chain);
    assert.equal(b.sourceProfile, profiles[0]); assert.equal(b.destinationProfile, profiles[1]); assert.equal(b.sourceOwner, id.sourceOwner);
    assert.equal(b.gasPayer, id.gasPayer); assert.notEqual(b.recipient, b.gasPayer); assert.equal(b.destinationToken, r.token);
    assert.equal(b.sourceDomain, 3); assert.equal(b.destinationDomain, r.domain); assert.equal(b.decimals, 6);
    assert.equal(b.mechanism.reference, `circle-v2-evm-fast-42161-${chain}.v2`); assert.ok(Object.isFrozen(b));
    assert.deepEqual(validateCircleFundingBinding(b), b);
    const fee = quoteCircleFundingFee(b, response, now, now);
    assert.equal(fee.quotedFeeAtomic, "124");
  });
}
test("canonical quantities and beneficiary reject ambiguous or invalid input", () => {
  for (const x of [{ ...p, recipient: `0x${"0".repeat(40)}` }, { ...p, recipient: "bad" }, { ...p, amountAtomic: "01" },
    { ...p, amountAtomic: "0" }, { ...p, amountAtomic: "1.0" }, { ...p, amountAtomic: (1n << 256n).toString() }, { ...p, maxFeeAtomic: "0" },
    { ...p, maxFeeAtomic: p.amountAtomic }, { ...p, minMintAtomic: "999001" }, { ...p, minMintAtomic: "0" }]) assert.throws(() => circleFundingBinding(1329, id, x));
  for (const bad of [{ sourceProfile: "Bad Profile" }, { destinationProfile: "" }, { sourceOwner: `0x${"0".repeat(40)}` }, { gasPayer: id.gasPayer.toLowerCase() }])
    assert.throws(() => circleFundingBinding(1329, { ...id, ...bad } as typeof id, p));
  assert.throws(() => circleFundingBinding(1 as 1329, id, p));
});
test("stored binding: its own seal, and protocol fields from the route row; identity is bound by the operation, not here", () => {
  const b = binding();
  for (const [key, value] of Object.entries({ sourceChain: 1, sourceDomain: 0, sourceToken: p.recipient, decimals: 18, destinationDomain: 15, destinationToken: p.recipient,
    mechanism: { provider: "circle-cctp-v2", reference: "circle-v2-evm-fast-42161-1329.v1" }, destinationChain: 1 })) {
    const { bindingHash: _hash, ...body } = { ...b, [key]: value }; assert.throws(() => validateCircleFundingBinding({ ...body, bindingHash: hashObject(body) }));
  }
  assert.throws(() => validateCircleFundingBinding({ ...b, amountAtomic: "999999" }), /funding_binding_changed|funding metadata/i);
  assert.throws(() => validateCircleFundingBinding({ ...b, extra: 1 }));
  // A self-consistent re-seal with other signers is a well-formed binding; the operation validator refuses it unless the
  // operation's own custody records name the same wallets (circle-v2-evm-any-profile.test.ts).
  const { bindingHash: _hash, ...body } = { ...b, gasPayer: p.recipient }; assert.equal(validateCircleFundingBinding({ ...body, bindingHash: hashObject(body) }).gasPayer, p.recipient);
});
test("fresh fee binds tuple, exact rational ceiling, cap and original 30 second window", () => {
  const b = binding(), f = quoteCircleFundingFee(b, response, now, now + 29_999);
  assert.deepEqual(assertCircleFundingFee(b, f, now + 29_999), f);
  assert.throws(() => assertCircleFundingFee(b, f, now + 30_000)); assert.throws(() => quoteCircleFundingFee(b, response, now, now - 1));
  assert.throws(() => quoteCircleFundingFee(b, response, now, now + 30_000));
  assert.throws(() => quoteCircleFundingFee(b, [{ finalityThreshold: 1000, minimumFee: 11 }], now, now));
  assert.throws(() => quoteCircleFundingFee(b, [{ finalityThreshold: 2000, minimumFee: 0 }], now, now));
  const { integrityHash: _hash, ...body } = f;
  assert.throws(() => assertCircleFundingFee(b, { ...body, quotedFeeAtomic: "123", integrityHash: hashObject({ ...body, quotedFeeAtomic: "123" }) }, now));
  assert.throws(() => assertCircleFundingFee(circleFundingBinding(1329, id, { ...p, recipient: getAddress(`0x${"66".repeat(20)}`) }), f, now));
});
test("a v1 fee quote (the deleted v1 writer's exact serialization) is refused by the v2 fee check", () => {
  const body = { schemaVersion: "apn.circle-fast-fee.v1", sourceDomain: 3, destinationDomain: 16, minimumFeeBps: "1", quotedFeeAtomic: "5",
    amountAtomic: "40100", maxFeeAtomic: "100", minMintAtomic: "40000", fetchedAtMs: now, expiresAtMs: now + 30_000,
    responseHash: hashObject([{ finalityThreshold: 1000, minimumFee: 1 }]) }, legacy = { ...body, integrityHash: hashObject(body) };
  assert.throws(() => assertCircleFundingFee(binding(), legacy, now));
});
