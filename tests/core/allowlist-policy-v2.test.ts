import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSET_POLICY_REGISTRY_SCHEMA_V2,
  compileAllowlistPolicyOverlayV2,
  evaluateAssetPolicy,
  parseAllowlistPolicyFile,
  sealAssetPolicyRegistry,
  validateAssetPolicyRegistry,
  type SwapMechanismPin,
  type UnsignedAssetPolicyRegistry,
} from "../../src/core.js";
import { EVM_OWNER, SOLANA, SOLANA_OWNER, TRON, TRON_OWNER, ownerAdmissions, overlayV2, uniswapPin } from "./allowlist-policy-fixtures.js";

const at = (asOf: string) => ({ asOfDate: asOf.slice(0, 10), asOf });

test("one revision seals many assets x rails across EVM, TRON and Solana, merging rails of one asset with per-rail caps", () => {
  const { overlay, registry } = compileAllowlistPolicyOverlayV2(overlayV2());
  assert.deepEqual(compileAllowlistPolicyOverlayV2(structuredClone(overlayV2())), { overlay, registry });
  assert.equal(registry.schemaVersion, ASSET_POLICY_REGISTRY_SCHEMA_V2);
  assert.deepEqual(registry.chains.map((chain) => chain.chain), ["eip155:1", SOLANA, TRON]);
  const eth = registry.chains[0]!.assets.find((asset) => asset.kind === "native")!;
  assert.deepEqual(eth.rails, { direct: true, gasless: false, x402: false, bridge: false, swap: true });
  assert.deepEqual(eth.railCaps, {
    direct: { maximumPerTransferAtomic: "1200000000000000", dailyLimitAtomic: "4000000000000000" },
    swap: { maximumPerTransferAtomic: "2000000000000000", dailyLimitAtomic: "4000000000000000" },
  });
  assert.equal(eth.caps, undefined);
  assert.deepEqual(eth.mechanismPins, { swap: uniswapPin() });
  const input = { chain: "eip155:1", asset: { kind: "native", identifier: null }, dailyUsageAtomic: "0", ...at("2026-09-18T02:00:00.000Z") } as const;
  assert.throws(() => evaluateAssetPolicy(registry, { ...input, rail: "direct", amountAtomic: "1500000000000000" }), { code: "APN_OPERATION_BLOCKED" });
  const swap = evaluateAssetPolicy(registry, { ...input, rail: "swap", amountAtomic: "1500000000000000" });
  assert.deepEqual(swap.caps, eth.railCaps?.swap); assert.deepEqual(swap.asset.mechanismPins?.swap, uniswapPin());
  // The caller's usage is the asset's combined usage on every rail, so another rail's spend narrows this rail.
  assert.throws(() => evaluateAssetPolicy(registry, { ...input, rail: "swap", amountAtomic: "1000000000000000",
    dailyUsageAtomic: "3500000000000000" }), { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => evaluateAssetPolicy(registry, { ...input, rail: "gasless", amountAtomic: "1" }), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(evaluateAssetPolicy(registry, { chain: TRON, asset: { kind: "native", identifier: null }, rail: "direct",
    amountAtomic: "8900000", dailyUsageAtomic: "0", ...at("2026-09-18T02:00:00.000Z") }).dailyRemainingAtomic, "20800000");
  assert.equal(evaluateAssetPolicy(registry, { chain: SOLANA, asset: { kind: "native", identifier: null }, rail: "direct",
    amountAtomic: "1", dailyUsageAtomic: "0", ...at("2026-09-18T02:00:00.000Z") }).family, "solana");
});

test("owner accounts must name exactly the admitted families with canonical addresses", () => {
  for (const accounts of [{ evm: EVM_OWNER, tron: TRON_OWNER }, { evm: EVM_OWNER, tron: TRON_OWNER, solana: SOLANA_OWNER, extra: "x" },
    { evm: EVM_OWNER.toLowerCase(), tron: TRON_OWNER, solana: SOLANA_OWNER }, { evm: EVM_OWNER, tron: EVM_OWNER, solana: SOLANA_OWNER }]) {
    assert.throws(() => compileAllowlistPolicyOverlayV2(overlayV2({ accounts } as never)), { code: "APN_INVALID_INPUT" });
  }
  const evmOnly = compileAllowlistPolicyOverlayV2(overlayV2({ accounts: { evm: EVM_OWNER }, admissions: ownerAdmissions().slice(0, 3) }));
  assert.deepEqual(evmOnly.overlay.accounts, { evm: EVM_OWNER });
  assert.throws(() => compileAllowlistPolicyOverlayV2(overlayV2({ accounts: { evm: EVM_OWNER, tron: TRON_OWNER },
    admissions: ownerAdmissions().slice(0, 3) })), { code: "APN_INVALID_INPUT" });
});

test("swap admissions require the exact swap mechanism pin for their own network", () => {
  const swap = (mechanism: unknown) => overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [{ chain: "eip155:1", kind: "native",
    rail: "swap", maximumPerTransferAtomic: "1", dailyLimitAtomic: "2", mechanism } as never] });
  assert.equal(compileAllowlistPolicyOverlayV2(swap(uniswapPin())).registry.chains[0]!.assets[0]!.rails.swap, true);
  for (const mechanism of [undefined, { provider: "uniswap", reference: "legacy" }, { ...uniswapPin(), extra: true },
    uniswapPin({ protocolVersion: "unversioned" })]) {
    assert.throws(() => compileAllowlistPolicyOverlayV2(swap(mechanism)), { code: "APN_INVALID_INPUT" });
  }
  const sunswap: SwapMechanismPin = { ...uniswapPin(), protocolFamily: "sunswap_tron", networkFamily: "tron", chain: TRON,
    routerProgramIdentity: "TXHwnAuEUFnzk474xAKnY9DmemrZ8AsxpF", auxiliaryContractProgramIdentities: [] };
  assert.throws(() => compileAllowlistPolicyOverlayV2(swap(sunswap)), (error: any) => error.details?.reason === "swap_mechanism_chain_mismatch");
  assert.throws(() => compileAllowlistPolicyOverlayV2(overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [{ chain: "eip155:1",
    kind: "native", rail: "direct", maximumPerTransferAtomic: "1", dailyLimitAtomic: "2", mechanism: uniswapPin() }] })),
  { code: "APN_INVALID_INPUT" });
});

test("caps are never defaulted: missing, null, zero, inverted or extra cap fields are refused", () => {
  const base = { chain: "eip155:1", kind: "native", rail: "direct" };
  for (const row of [{ ...base, dailyLimitAtomic: "2" }, { ...base, maximumPerTransferAtomic: "1" },
    { ...base, maximumPerTransferAtomic: null, dailyLimitAtomic: "2" }, { ...base, maximumPerTransferAtomic: "0", dailyLimitAtomic: "2" },
    { ...base, maximumPerTransferAtomic: "3", dailyLimitAtomic: "2" }, { ...base, maximumPerTransferAtomic: "1", dailyLimitAtomic: "2", cap: "3" }]) {
    assert.throws(() => compileAllowlistPolicyOverlayV2(overlayV2({ accounts: { evm: EVM_OWNER }, admissions: [row as never] })),
      { code: "APN_INVALID_INPUT" });
  }
  assert.throws(() => compileAllowlistPolicyOverlayV2(overlayV2({ admissions: [...ownerAdmissions(), ownerAdmissions()[0]!] })),
    (error: any) => error.details?.reason === "duplicate_admission");
  assert.throws(() => parseAllowlistPolicyFile({ schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "a", accounts: {},
    effectiveAt: "2026-09-18T01:00:00.000Z" }), (error: any) => error.details?.reason === "invalid_policy_file");
});

test("a v2 registry refuses rail caps that do not exactly match the admitted rails", () => {
  const registry = compileAllowlistPolicyOverlayV2(overlayV2()).registry;
  const { policyDigest: _digest, ...unsigned } = structuredClone(registry) as any;
  for (const mutate of [
    (value: any) => { delete value.chains[0].assets[0].railCaps.swap; },
    (value: any) => { value.chains[0].assets[0].railCaps.gasless = { maximumPerTransferAtomic: "1", dailyLimitAtomic: "1" }; },
    (value: any) => { value.chains[0].assets[0].caps = { maximumPerTransferAtomic: "1", dailyLimitAtomic: "1" }; },
    (value: any) => { value.chains[0].assets[0].railCaps.direct.dailyLimitAtomic = "1"; },
    (value: any) => { value.schemaVersion = "apn.asset-policy-registry.v1"; },
  ]) {
    const value = structuredClone(unsigned); mutate(value);
    assert.throws(() => sealAssetPolicyRegistry(value as UnsignedAssetPolicyRegistry), { code: "APN_INVALID_INPUT" });
  }
  assert.throws(() => validateAssetPolicyRegistry({ ...registry, policyDigest: "0".repeat(64) }), { code: "APN_INVALID_INPUT" });
});

test("sealed order is code-unit order, so the registry bytes never depend on the process locale", () => {
  const natives = ["eip155:1", "eip155:137", "eip155:143", "eip155:1329", "eip155:56", "eip155:8453", "eip155:43114"];
  const input = overlayV2({ accounts: { evm: EVM_OWNER }, admissions: natives.map((chain) => ({ chain, kind: "native" as const,
    rail: "direct" as const, maximumPerTransferAtomic: "1", dailyLimitAtomic: "2" })) });
  const expected = compileAllowlistPolicyOverlayV2(input).registry;
  assert.deepEqual(expected.chains.map((chain) => chain.chain), [...natives].sort());
  const original = String.prototype.localeCompare;
  const numeric = new Intl.Collator("en-u-kn-true");
  String.prototype.localeCompare = function (this: string, other: string) { return numeric.compare(this, other); } as typeof original;
  try { assert.equal(compileAllowlistPolicyOverlayV2(input).registry.policyDigest, expected.policyDigest); }
  finally { String.prototype.localeCompare = original; }
});
