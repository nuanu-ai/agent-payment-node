import assert from "node:assert/strict";
import test from "node:test";
import {
  assetPolicyDigest,
  evaluateAssetPolicy,
  sealAssetPolicyRegistry,
  validateAssetPolicyRegistry,
  type UnsignedAssetPolicyRegistry,
} from "../../src/asset-policy-registry.js";

const EVM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRON_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const allRails = { direct: true, gasless: true, x402: true, bridge: true, swap: false } as const;
const caps = { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "3000000" } as const;

function unsignedRegistry(): UnsignedAssetPolicyRegistry {
  return {
    schemaVersion: "apn.asset-policy-registry.v1",
    registryVersion: "2026-09-17.foundation.1",
    publishedAt: "2026-09-17T04:00:00.000Z",
    effectiveDate: "2026-09-18",
    chains: [
      { chain: "eip155:1", family: "evm", name: "Ethereum", assets: [
        { kind: "native", identifier: null, symbol: "ETH", decimals: 18, rails: allRails, caps },
        { kind: "token", identifier: EVM_USDC, symbol: "USDC", decimals: 6, rails: allRails, caps },
      ] },
      { chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", family: "solana", name: "Solana", assets: [
        { kind: "native", identifier: null, symbol: "SOL", decimals: 9, rails: { ...allRails, x402: false }, caps },
        { kind: "token", identifier: SOLANA_USDC, symbol: "USDC", decimals: 6, rails: allRails, caps },
      ] },
      { chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", family: "tron", name: "TRON", assets: [
        { kind: "native", identifier: null, symbol: "TRX", decimals: 6, rails: { ...allRails, gasless: false }, caps },
        { kind: "token", identifier: TRON_USDT, symbol: "USDT", decimals: 6, rails: allRails, caps },
      ] },
    ],
  };
}

test("asset registry seals a deterministic versioned and dated policy digest", () => {
  const unsigned = unsignedRegistry();
  const first = sealAssetPolicyRegistry(unsigned);
  const second = sealAssetPolicyRegistry({
    effectiveDate: unsigned.effectiveDate,
    chains: unsigned.chains.map((chain) => ({
      assets: chain.assets.map((asset) => ({
        caps: { dailyLimitAtomic: asset.caps!.dailyLimitAtomic, maximumPerTransferAtomic: asset.caps!.maximumPerTransferAtomic },
        rails: { swap: asset.rails.swap, bridge: asset.rails.bridge, x402: asset.rails.x402,
          gasless: asset.rails.gasless, direct: asset.rails.direct },
        decimals: asset.decimals, symbol: asset.symbol, identifier: asset.identifier, kind: asset.kind,
      })),
      name: chain.name, family: chain.family, chain: chain.chain,
    })),
    publishedAt: unsigned.publishedAt,
    registryVersion: unsigned.registryVersion,
    schemaVersion: unsigned.schemaVersion,
  });
  assert.equal(first.policyDigest, second.policyDigest);
  assert.equal(first.policyDigest, assetPolicyDigest(unsigned));
  assert.equal(validateAssetPolicyRegistry(first), first);
  assert.match(first.policyDigest, /^[a-f0-9]{64}$/u);
});

test("shared evaluator admits exact native and token identities at both cap boundaries", () => {
  const registry = sealAssetPolicyRegistry(unsignedRegistry());
  const native = evaluateAssetPolicy(registry, {
    chain: "eip155:1", asset: { kind: "native", identifier: null }, rail: "direct",
    amountAtomic: "1000000", dailyUsageAtomic: "2000000", asOfDate: "2026-09-18",
  });
  assert.equal(native.asset.symbol, "ETH");
  assert.equal(native.dailyRemainingAtomic, "0");
  assert.equal(native.policyDigest, registry.policyDigest);
  const token = evaluateAssetPolicy(registry, {
    chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    asset: { kind: "token", identifier: SOLANA_USDC }, rail: "bridge",
    amountAtomic: "1", dailyUsageAtomic: "0", asOfDate: "2026-09-19",
  });
  assert.equal(token.asset.identifier, SOLANA_USDC);
  assert.equal(token.dailyRemainingAtomic, "2999999");
});

test("evaluator fails closed for unknown network, unlisted asset, unsupported rail and pre-effective policy", () => {
  const registry = sealAssetPolicyRegistry(unsignedRegistry());
  const common = { amountAtomic: "1", dailyUsageAtomic: "0", asOfDate: "2026-09-18" } as const;
  assert.throws(() => evaluateAssetPolicy(registry, {
    ...common, chain: "eip155:8453", asset: { kind: "native", identifier: null }, rail: "direct",
  }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => evaluateAssetPolicy(registry, {
    ...common, chain: "eip155:1", asset: { kind: "token", identifier: "0x0000000000000000000000000000000000000001" }, rail: "direct",
  }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => evaluateAssetPolicy(registry, {
    ...common, chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    asset: { kind: "native", identifier: null }, rail: "x402",
  }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => evaluateAssetPolicy(registry, {
    ...common, asOfDate: "2026-09-17", chain: "eip155:1", asset: { kind: "native", identifier: null }, rail: "direct",
  }), { code: "APN_OPERATION_BLOCKED" });
});

test("evaluator enforces per-transfer and cumulative daily atomic caps", () => {
  const registry = sealAssetPolicyRegistry(unsignedRegistry());
  const input = { chain: "eip155:1", asset: { kind: "token", identifier: EVM_USDC }, rail: "gasless",
    asOfDate: "2026-09-18" } as const;
  assert.throws(() => evaluateAssetPolicy(registry, { ...input, amountAtomic: "1000001", dailyUsageAtomic: "0" }),
    { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => evaluateAssetPolicy(registry, { ...input, amountAtomic: "1", dailyUsageAtomic: "3000000" }),
    { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => evaluateAssetPolicy(registry, { ...input, amountAtomic: "2", dailyUsageAtomic: "2999999" }),
    { code: "APN_OPERATION_BLOCKED" });
});

test("registry rejects ambiguous native identities, non-canonical token addresses and malformed limits", () => {
  const cases: Array<(registry: any) => void> = [
    (registry) => { registry.chains[0].assets[0].identifier = "native"; },
    (registry) => { registry.chains[0].assets[1].identifier = EVM_USDC.toLowerCase(); },
    (registry) => { registry.chains[1].assets[1].identifier = "1111111111111111111111111111111O"; },
    (registry) => { registry.chains[2].assets[1].identifier = `${TRON_USDT.slice(0, -1)}1`; },
    (registry) => { registry.chains[0].assets[0].caps.maximumPerTransferAtomic = "3000001"; },
    (registry) => { registry.chains[0].assets[0].caps.dailyLimitAtomic = "01"; },
    (registry) => { registry.chains[0].assets.push(structuredClone(registry.chains[0].assets[0])); },
    (registry) => { registry.chains.push(structuredClone(registry.chains[0])); },
    (registry) => { registry.effectiveDate = "2026-02-30"; },
  ];
  for (const mutate of cases) {
    const registry = structuredClone(unsignedRegistry()) as any;
    mutate(registry);
    assert.throws(() => sealAssetPolicyRegistry(registry), { code: "APN_INVALID_INPUT" });
  }
});

test("digest tampering, native-token confusion and non-canonical evaluation input are refused", () => {
  const registry = sealAssetPolicyRegistry(unsignedRegistry());
  assert.throws(() => validateAssetPolicyRegistry({ ...registry, registryVersion: "changed" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => evaluateAssetPolicy(registry, {
    chain: "eip155:1", asset: { kind: "token", identifier: EVM_USDC.toLowerCase() }, rail: "direct",
    amountAtomic: "1", dailyUsageAtomic: "0", asOfDate: "2026-09-18",
  }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => evaluateAssetPolicy(registry, {
    chain: "eip155:1", asset: { kind: "token", identifier: "0x0000000000000000000000000000000000000000" }, rail: "direct",
    amountAtomic: "1", dailyUsageAtomic: "0", asOfDate: "2026-09-18",
  }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => evaluateAssetPolicy(registry, {
    chain: "eip155:1", asset: { kind: "native", identifier: EVM_USDC }, rail: "direct",
    amountAtomic: "1", dailyUsageAtomic: "0", asOfDate: "2026-09-18",
  } as any), { code: "APN_INVALID_INPUT" });
  assert.throws(() => evaluateAssetPolicy(registry, {
    chain: "eip155:1", asset: { kind: "native", identifier: null, alias: "ETH" }, rail: "direct",
    amountAtomic: "1", dailyUsageAtomic: "0", asOfDate: "2026-09-18",
  } as any), { code: "APN_INVALID_INPUT" });
  assert.throws(() => evaluateAssetPolicy(registry, null as any), { code: "APN_INVALID_INPUT" });
});
