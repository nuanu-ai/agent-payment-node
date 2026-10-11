import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { hashObject } from "../../src/canonical.js";
import { sealAssetPolicyRegistry, type AssetPolicyRow } from "../../src/asset-policy-registry.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { quoteCircleFastFee } from "../../src/circle-v2-evm/preflight.js";
import { admitCircleFundingAssets, assertCircleFundingFee, circleFundingBinding, deriveCircleFundingParameters,
  quoteCircleFundingFee, sealCircleFundingIntent, validateCircleFundingBinding, validateCircleFundingIntent } from "../../src/circle-v2-evm/funding-binding.js";
const now = Date.parse("2026-10-11T06:00:00.000Z");
// Synthetic beneficiary, unrelated to any live wallet or policy.
const p = { recipient: getAddress(`0x${"55".repeat(20)}`), amountAtomic: "1000000", maxFeeAtomic: "1000", minMintAtomic: "999000" };
const response = [{ finalityThreshold: 1000, minimumFee: 1.234567 }];
const binding = () => circleFundingBinding(1329, "evm-live-seller", p);
const row = (kind: "token" | "native", identifier: string | null, decimals: number, reference: string, cap = "1000000000000000000"): AssetPolicyRow => ({
  kind, identifier, symbol: kind === "token" ? "USDC" : "ETH", decimals,
  rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
  railCaps: { bridge: { maximumPerTransferAtomic: cap, dailyLimitAtomic: cap } }, mechanismPins: { bridge: { provider: "circle-cctp-v2", reference } },
});
function policy(chain: number, assets: AssetPolicyRow[]) {
  return sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "test-funding-v2", publishedAt: "2026-10-11T00:00:00.000Z",
    effectiveDate: "2026-10-11", effectiveAt: "2026-10-11T00:00:00.000Z", expiresAt: "2026-10-12T00:00:00.000Z", chains: [{ chain: `eip155:${chain}`, family: "evm", name: "Synthetic", assets }] });
}
function admission() {
  const b = binding(), ref = b.mechanism.reference;
  return { source: { chainId: 42161, address: CIRCLE_SOURCE_OWNER, nativeBalanceAtomic: "75000000000000", usdcBalanceAtomic: p.amountAtomic, allowanceAtomic: "0", latestNonceAtomic: "10", pendingNonceAtomic: "10" },
    destination: { chainId: 1329, address: b.gasPayer, nativeBalanceAtomic: circleRoute(1329).destinationNativeCap, usdcBalanceAtomic: "0", allowanceAtomic: "0", latestNonceAtomic: "3", pendingNonceAtomic: "3" },
    sourceRegistry: policy(42161, [row("token", CIRCLE_SOURCE_TOKEN, 6, ref), row("native", null, 18, ref)]), destinationRegistry: policy(1329, [row("native", null, 18, ref)]),
    sourceTokenUsageAtomic: "0", sourceNativeUsageAtomic: "0", destinationNativeUsageAtomic: "0", nowMs: now };
}
test("all absent is legacy; partial and unknown funding fields refuse", () => {
  assert.equal(deriveCircleFundingParameters({}), null);
  assert.deepEqual(deriveCircleFundingParameters(p), p);
  for (const k of Object.keys(p)) { const x: Record<string, unknown> = { ...p }; delete x[k]; assert.throws(() => deriveCircleFundingParameters(x)); }
  assert.throws(() => deriveCircleFundingParameters({ ...p, skipConsent: true }));
});
for (const [chain, profile] of [[1329, "evm-live-buyer"], [1329, "evm-live-seller"], [59144, "evm-live-buyer"], [143, "default"]] as const) {
  test(`funding metadata binds exact ${chain}/${profile} independently from beneficiary`, () => {
    const b = circleFundingBinding(chain, profile, p), r = circleRoute(chain, profile);
    assert.equal(b.gasPayer, r.gasPayer); assert.notEqual(b.recipient, b.gasPayer); assert.equal(b.destinationToken, r.token);
    assert.equal(b.sourceDomain, 3); assert.equal(b.destinationDomain, r.domain); assert.equal(b.decimals, 6);
    assert.equal(b.mechanism.reference, `circle-v2-evm-fast-42161-${chain}.v2`); assert.ok(Object.isFrozen(b));
    assert.deepEqual(validateCircleFundingBinding(b), b);
    const fee = quoteCircleFundingFee(b, response, now, now);
    assert.equal(fee.quotedFeeAtomic, "124");
    const i = sealCircleFundingIntent(b, fee, "a".repeat(64), now);
    assert.equal(Date.parse(i.expiresAt) - Date.parse(i.preparedAt), 900_000); assert.deepEqual(validateCircleFundingIntent(i), i);
  });
}
test("canonical quantities and beneficiary reject ambiguous or invalid input", () => {
  for (const x of [{ ...p, recipient: `0x${"0".repeat(40)}` }, { ...p, recipient: "bad" }, { ...p, amountAtomic: "01" },
    { ...p, amountAtomic: "0" }, { ...p, amountAtomic: "1.0" }, { ...p, amountAtomic: (1n << 256n).toString() }, { ...p, maxFeeAtomic: "0" },
    { ...p, maxFeeAtomic: p.amountAtomic }, { ...p, minMintAtomic: "999001" }, { ...p, minMintAtomic: "0" }]) assert.throws(() => circleFundingBinding(1329, "evm-live-buyer", x));
  assert.throws(() => circleFundingBinding(1329, "default", p));
  assert.throws(() => circleFundingBinding(1 as 1329, "evm-live-buyer", p));
});
test("binding rejects recomputed caller changes to source, assets, decimals, domains, gas payer or mechanism", () => {
  const b = binding();
  for (const [key, value] of Object.entries({ sourceChain: 1, sourceDomain: 0, sourceOwner: p.recipient, sourceToken: p.recipient, decimals: 18, destinationDomain: 15, destinationToken: p.recipient, gasPayer: p.recipient,
    mechanism: { provider: "circle-cctp-v2", reference: "circle-v2-evm-fast-42161-1329.v1" } })) {
    const { bindingHash: _hash, ...body } = { ...b, [key]: value }; assert.throws(() => validateCircleFundingBinding({ ...body, bindingHash: hashObject(body) }));
  }
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
  assert.throws(() => assertCircleFundingFee(circleFundingBinding(1329, "evm-live-seller", { ...p, recipient: getAddress(`0x${"66".repeat(20)}`) }), f, now));
});
test("intent keeps exact expiry/digest without treating metadata as an execution grant", () => {
  const b = binding(), f = quoteCircleFundingFee(b, response, now, now), i = sealCircleFundingIntent(b, f, "a".repeat(64), now);
  const { integrityHash: _hash, ...body } = i, changed = { ...body, expiresAt: new Date(now + 901_000).toISOString() };
  assert.throws(() => validateCircleFundingIntent({ ...changed, integrityHash: hashObject(changed) }));
  assert.throws(() => sealCircleFundingIntent(b, f, "url", now));
  assert.throws(() => sealCircleFundingIntent(b, f, "a".repeat(64), Infinity));
  assert.equal("effects" in i, false); assert.equal("authority" in i, false);
});
test("normal pure asset admission preserves exact balances, allowance, nonce and current policy caps", () => {
  const b = binding(), a = admission(); admitCircleFundingAssets(b, a);
  for (const patch of [{ usdcBalanceAtomic: "999999" }, { nativeBalanceAtomic: "74999999999999" }, { allowanceAtomic: "1000000" }, { pendingNonceAtomic: "11" }, { chainId: 1 }, { address: p.recipient }])
    assert.throws(() => admitCircleFundingAssets(b, { ...a, source: { ...a.source, ...patch } }));
  assert.throws(() => admitCircleFundingAssets(b, { ...a, destination: { ...a.destination, address: p.recipient } }));
  assert.throws(() => admitCircleFundingAssets(b, { ...a, nowMs: Date.parse("2026-10-12T00:00:00.000Z") }));
  assert.throws(() => admitCircleFundingAssets(b, { ...a, sourceRegistry: policy(42161, [row("token", CIRCLE_SOURCE_TOKEN, 6, b.mechanism.reference, "999999"), row("native", null, 18, b.mechanism.reference)]) }));
  assert.throws(() => admitCircleFundingAssets(b, { ...a, sourceRegistry: policy(42161, [row("token", CIRCLE_SOURCE_TOKEN, 6, "circle-v2-evm-fast-42161-1329.v1"), row("native", null, 18, b.mechanism.reference)]) }));
  assert.throws(() => admitCircleFundingAssets(b, { ...a, sourceTokenUsageAtomic: "1000000000000000000" }));
});
test("legacy fee quote serialization remains exact and new schema is separate", () => {
  const legacy = quoteCircleFastFee(1329, [{ finalityThreshold: 1000, minimumFee: 1 }], now, now);
  const body = { schemaVersion: "apn.circle-fast-fee.v1", sourceDomain: 3, destinationDomain: 16, minimumFeeBps: "1", quotedFeeAtomic: "5",
    amountAtomic: "40100", maxFeeAtomic: "100", minMintAtomic: "40000", fetchedAtMs: now, expiresAtMs: now + 30_000,
    responseHash: hashObject([{ finalityThreshold: 1000, minimumFee: 1 }]) };
  assert.deepEqual(legacy, { ...body, integrityHash: hashObject(body) });
  assert.throws(() => assertCircleFundingFee(binding(), legacy, now));
});
