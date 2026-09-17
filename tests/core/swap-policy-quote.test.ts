import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_SWAP_PROTOCOL_REGISTRY, SWAP_MECHANISM_PIN_SCHEMA, compileAllowlistPolicyOverlay,
  compileSwapProtocolRegistry, createSwapQuote, evaluateAssetPolicy, loadAllowlistInventory,
  swapMechanismDigest, validateSwapProtocolRegistry, validateSwapQuote, type AllowlistPolicyOverlayInput,
  type SwapMechanismPin, type SwapQuoteInput,
} from "../../src/core.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const H = (letter: string) => letter.repeat(64);
const inventory = loadAllowlistInventory();

function pin(overrides: Partial<SwapMechanismPin> = {}): SwapMechanismPin {
  return { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
    chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "builder_api", constructorIdentity: "owner.api",
    constructorVersion: "1.0.0", routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: ["0x2222222222222222222222222222222222222222"],
    quoteSchemaVersion: "1.0.0", transactionSchemaVersion: "1.0.0", validationPolicyIdentity: "owner.validation",
    validationPolicyVersion: "1.0.0", ...overrides };
}
function overlay(mechanism: SwapMechanismPin = pin()): AllowlistPolicyOverlayInput {
  return { overlayVersion: "swap-owner.1", profile: "swap-test", account: ACCOUNT,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-19T00:00:00.000Z", admissions: [{
      chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "150", mechanism,
    }, { chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "100",
      dailyLimitAtomic: "150", mechanism }] };
}
function quote(overrides: Partial<SwapQuoteInput> = {}): SwapQuoteInput {
  return { profile: "swap-test", account: ACCOUNT, recipient: RECIPIENT,
    sourceAsset: { chain: "eip155:1", kind: "native", identifier: null },
    destinationAsset: { chain: "eip155:1", kind: "token", identifier: USDC }, inputAmountAtomic: "100",
    expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100,
    effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z",
    providerResponseHash: H("a"), routeHash: H("b"), unsignedTransactionPayloadHash: H("c"),
    simulation: { requestHash: H("d"), resultHash: H("e"), success: true, blockNumber: "100", blockHash: `0x${H("1")}`,
      headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" }, ...overrides };
}

test("swap overlay requires an exact immutable pin and stays independently dormant by default", () => {
  assert.equal(EMPTY_SWAP_PROTOCOL_REGISTRY.records.length, 0);
  const compiled = compileAllowlistPolicyOverlay(overlay());
  const asset = compiled.registry.chains[0]!.assets[0]!;
  assert.equal(asset.rails.swap, true); assert.deepEqual(asset.mechanismPins?.swap, pin());
  assert.equal(evaluateAssetPolicy(compiled.registry, { chain: "eip155:1", asset: { kind: "native", identifier: null },
    rail: "swap", amountAtomic: "100", dailyUsageAtomic: "50", asOfDate: "2026-09-18", asOf: "2026-09-18T00:01:00.000Z" }).dailyRemainingAtomic, "0");
  for (const mechanism of [undefined, { provider: "legacy", reference: "not-a-swap-pin" }, { ...pin(), excess: true }]) {
    const value: any = overlay(); value.admissions[0].mechanism = mechanism;
    assert.throws(() => compileAllowlistPolicyOverlay(value), { code: "APN_INVALID_INPUT" });
  }
  const direct: any = overlay(); direct.admissions[0].rail = "direct";
  assert.throws(() => compileAllowlistPolicyOverlay(direct), { code: "APN_INVALID_INPUT" });
});

test("protocol registry deterministically binds owner pins and rejects mismatches, duplicates, unversioned and tampered records", () => {
  const registry = compileSwapProtocolRegistry({ registryVersion: "owner.1", pins: [pin()] });
  assert.equal(registry.records[0]!.mechanismDigest, swapMechanismDigest(pin()));
  assert.deepEqual(validateSwapProtocolRegistry(structuredClone(registry)), registry);
  const badPins = [
    pin({ chain: "eip155:8453" }), pin({ networkFamily: "solana" }), pin({ protocolVersion: "latest" }),
    { ...pin(), unexpected: "field" }, { ...pin(), auxiliaryContractProgramIdentities: ["0x1111111111111111111111111111111111111111"] },
  ];
  for (const value of badPins) assert.throws(() => compileSwapProtocolRegistry({ registryVersion: "owner.1", pins: [value] }),
    { code: "APN_INVALID_INPUT" });
  assert.throws(() => compileSwapProtocolRegistry({ registryVersion: "owner.1", pins: [pin(), pin()] }), { code: "APN_INVALID_INPUT" });
  const tampered: any = structuredClone(registry); tampered.records[0].pin.routerProgramIdentity = "0x3333333333333333333333333333333333333333";
  assert.throws(() => validateSwapProtocolRegistry(tampered), { code: "APN_STATE_CORRUPT" });
  const proto = Object.create({ polluted: true }); Object.assign(proto, pin());
  assert.throws(() => compileSwapProtocolRegistry({ registryVersion: "owner.1", pins: [proto] }), { code: "APN_INVALID_INPUT" });
});

test("quote snapshot binds owner, exact assets, route, transaction, simulation, output and expiry", () => {
  const snapshot = createSwapQuote(quote()); assert.deepEqual(validateSwapQuote(structuredClone(snapshot)), snapshot);
  for (const mutate of [
    (v: any) => { v.routeHash = H("f"); }, (v: any) => { v.unsignedTransactionPayloadHash = H("f"); },
    (v: any) => { v.simulation.resultHash = H("f"); }, (v: any) => { v.simulation.success = false; },
    (v: any) => { v.account = RECIPIENT; }, (v: any) => { v.destinationAsset.identifier = "0x0000000000000000000000000000000000000001"; },
  ]) { const value: any = structuredClone(snapshot); mutate(value); assert.throws(() => validateSwapQuote(value), { code: "APN_STATE_CORRUPT" }); }
  for (const value of [quote({ minimumOutputAtomic: "96" }), quote({ slippageBps: 10001 }),
    quote({ inputAmountAtomic: "0" }), quote({ expiresAt: "2026-09-18T00:00:00.000Z" })]) {
    assert.throws(() => createSwapQuote(value), { code: "APN_INVALID_INPUT" });
  }
  const excess: any = createSwapQuote(quote()); excess.extra = true;
  assert.throws(() => validateSwapQuote(excess), { code: "APN_STATE_CORRUPT" });
  const proto = Object.create({ polluted: true }); Object.assign(proto, createSwapQuote(quote()));
  assert.throws(() => validateSwapQuote(proto), { code: "APN_STATE_CORRUPT" });
  const inputProto = Object.create({ polluted: true }); Object.assign(inputProto, quote());
  assert.throws(() => createSwapQuote(inputProto), { code: "APN_INVALID_INPUT" });
});
