import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { compileAllowlistPolicyOverlayV2 } from "../../src/allowlist-policy-v2.js";
import { allowlistDecisionLines } from "../../src/allowlist-policy-activation.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { evaluateAssetPolicy, sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { compileSwapProtocolRegistry } from "../../src/swap/protocol-registry.js";
import { SWAP_MECHANISM_PIN_SCHEMA, swapMechanismDigest, type SwapMechanismPin } from "../../src/swap/pin.js";
import { admittedSwapProtocol, assetAdmitsSwapMechanism, swapRouteDigest, swapRouteOf, validateSwapAdmissionMechanism } from "../../src/swap/route-admission.js";
import { createSwapQuote, type SwapQuoteInput } from "../../src/swap/quote.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { GuardedSwapService } from "../../src/swap/service.js";
import { ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207, ORCA_KEYLESS_PROTOCOL_REGISTRY } from "../../src/swap/orca-solana/pins.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN } from "../../src/legacy/orca-stable/mechanism.js";
import { UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_WBTC_MECHANISM_PIN } from "../../src/swap/uniswap-v3/pins.js";
import { JUPITER_V1_ROUTES as JUPITER_V1_CURRENT_ROUTES, JUPITER_V1_KNOWN_ROUTES as JUPITER_V1_FINITE_ROUTES } from "../../src/swap/jupiter-solana/v1-route-config.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const H = (c: string) => c.repeat(64), inventory = loadAllowlistInventory();
const lane: SwapMechanismPin = { schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "uniswap_ethereum", networkFamily: "evm",
  chain: "eip155:1", protocolVersion: "2.2.0", constructorKind: "sdk", constructorIdentity: "apn.sdk", constructorVersion: "2.0.0",
  routerProgramIdentity: "0x1111111111111111111111111111111111111111", auxiliaryContractProgramIdentities: ["0x2222222222222222222222222222222222222222"],
  quoteSchemaVersion: "2.0.0", transactionSchemaVersion: "2.0.0", validationPolicyIdentity: "apn.validation", validationPolicyVersion: "2.0.0" };
/** What an older APN release printed for the same route: every internal version differs. */
const olderRelease: SwapMechanismPin = { ...lane, protocolVersion: "2.1.0", constructorVersion: "1.0.0", quoteSchemaVersion: "1.0.0",
  transactionSchemaVersion: "1.0.0", validationPolicyVersion: "1.0.0" };
const otherPool: SwapMechanismPin = { ...lane, auxiliaryContractProgramIdentities: ["0x3333333333333333333333333333333333333333"] };
const quote: SwapQuoteInput = { profile: "route-swap", account: ACCOUNT, recipient: ACCOUNT,
  sourceAsset: { chain: "eip155:1", kind: "native", identifier: null }, destinationAsset: { chain: "eip155:1", kind: "token", identifier: USDC },
  inputAmountAtomic: "100", expectedOutputAtomic: "100", minimumOutputAtomic: "99", slippageBps: 100,
  effectiveAt: "2026-09-18T00:00:00.000Z", expiresAt: "2026-09-18T00:05:00.000Z", providerResponseHash: H("a"),
  routeHash: H("b"), unsignedTransactionPayloadHash: H("c"), simulation: { requestHash: H("d"), resultHash: H("e"), success: true,
    blockNumber: "100", blockHash: `0x${H("1")}`, headBlockNumber: "101", maxHeadDrift: 2, gasEstimate: "100000" } };

function v1Policy(source: unknown, destination: unknown) {
  const overlay = { overlayVersion: "route-swap.1", profile: "route-swap", account: ACCOUNT, datasetVersion: inventory.dataset.version,
    datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256, effectiveAt: "2026-09-18T00:00:00.000Z",
    expiresAt: "2026-09-19T00:00:00.000Z", admissions: [
      { chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", ...(source as object) },
      { chain: "eip155:1", kind: "token", identifier: USDC, rail: "swap", maximumPerTransferAtomic: "100", dailyLimitAtomic: "100", ...(destination as object) },
    ] } as AllowlistPolicyOverlayInput;
  return compileAllowlistPolicyOverlay(overlay).registry;
}
async function prepare(root: string, policy: unknown, pins: readonly SwapMechanismPin[], key: string) {
  const service = new GuardedSwapService(new SwapOperationRepository(root), new AssetUsageLedger(root));
  const { schemaVersion: _s, profileHash: _p, quoteHash: _q, ...input } = createSwapQuote(structuredClone(quote));
  return await service.prepare({ quote: input, assetPolicy: policy, protocolRegistry: compileSwapProtocolRegistry({ registryVersion: "route.1", pins }),
    idempotencyKey: key, approvalCapAtomic: "0", now: new Date("2026-09-18T00:01:00.000Z") });
}

test("route identity ignores APN-internal versions and separates routers and pools", () => {
  assert.equal(swapRouteDigest(lane), swapRouteDigest(olderRelease));
  assert.equal(swapRouteDigest(lane), swapRouteDigest(swapRouteOf(lane)));
  assert.notEqual(swapRouteDigest(lane), swapRouteDigest(otherPool));
  assert.equal(swapRouteDigest(ORCA_KEYLESS_MECHANISM_PIN), swapRouteDigest(ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207));
  assert.notEqual(swapRouteDigest(ORCA_KEYLESS_MECHANISM_PIN), swapRouteDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN));
  assert.notEqual(swapRouteDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN), swapRouteDigest(UNISWAP_WBTC_MECHANISM_PIN));
  for (const current of JUPITER_V1_CURRENT_ROUTES) {
    const generations = JUPITER_V1_FINITE_ROUTES.filter((route) => route.pool === current.pool);
    assert.ok(generations.length >= 2);
    assert.ok(generations.every((route) => swapRouteDigest(route.mechanismPin) === swapRouteDigest(current.mechanismPin)));
  }
  assert.equal(new Set(JUPITER_V1_CURRENT_ROUTES.map((route) => swapRouteDigest(route.mechanismPin))).size, 4);
  assert.throws(() => validateSwapAdmissionMechanism({ ...swapRouteOf(lane), chain: "eip155:8453" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => validateSwapAdmissionMechanism({ ...swapRouteOf(lane), auxiliaryContractProgramIdentities: [lane.routerProgramIdentity] }),
    { code: "APN_INVALID_INPUT" });
});

test("a pin printed by an older release still admits the current lane; another pool never does", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const op = await prepare(temporary.root, v1Policy({ mechanism: olderRelease }, { mechanism: swapRouteOf(lane) }), [lane], "route-admission-0001");
  assert.equal(op.mechanismDigest, swapMechanismDigest(lane));
  await assert.rejects(prepare(temporary.root, v1Policy({ mechanism: otherPool }, { mechanism: lane }), [lane], "route-admission-0002"),
    { code: "APN_OPERATION_BLOCKED", message: /Source asset/u });
  await assert.rejects(prepare(temporary.root, v1Policy({ mechanism: lane }, { mechanism: otherPool }), [lane], "route-admission-0003"),
    { code: "APN_OPERATION_BLOCKED", message: /Destination asset/u });
});

test("one asset row admits several swap routes, and the installed lane picks its own", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const policy = v1Policy({ mechanisms: [swapRouteOf(otherPool), swapRouteOf(lane)] }, { mechanisms: [otherPool, lane] });
  const native = evaluateAssetPolicy(policy, { chain: "eip155:1", asset: { kind: "native", identifier: null }, rail: "swap",
    amountAtomic: "1", dailyUsageAtomic: "0", asOfDate: "2026-09-18", asOf: "2026-09-18T00:01:00.000Z" });
  assert.equal(native.asset.mechanismOptions?.swap?.length, 2);
  assert.ok(assetAdmitsSwapMechanism(native.asset, lane) && assetAdmitsSwapMechanism(native.asset, otherPool));
  assert.equal((await prepare(temporary.root, policy, [lane], "route-admission-0004")).mechanismDigest, swapMechanismDigest(lane));
  assert.equal((await prepare(temporary.root, policy, [otherPool], "route-admission-0005")).mechanismDigest, swapMechanismDigest(otherPool));
  assert.throws(() => admittedSwapProtocol(compileSwapProtocolRegistry({ registryVersion: "both.1", pins: [lane, { ...otherPool,
    transactionSchemaVersion: "3.0.0", constructorIdentity: "apn.other" }] }), "eip155:1", native.asset, native.asset), { code: "APN_OPERATION_BLOCKED" });
});

test("swap alternatives are validated: two to sixteen distinct routes, no single pin beside them", () => {
  assert.throws(() => v1Policy({ mechanisms: [lane] }, { mechanism: lane }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => v1Policy({ mechanisms: [lane, olderRelease] }, { mechanism: lane }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => v1Policy({ mechanism: lane, mechanisms: [lane, otherPool] }, { mechanism: lane }), { code: "APN_INVALID_INPUT" });
  const policy = v1Policy({ mechanisms: [lane, otherPool] }, { mechanism: lane });
  const { policyDigest: _digest, ...body } = policy;
  const row = body.chains[0]!.assets.find((asset) => asset.kind === "native")!;
  const tamper = (patch: object) => sealAssetPolicyRegistry({ ...body, chains: [{ ...body.chains[0]!, assets: body.chains[0]!.assets.map((asset) =>
    asset === row ? { ...asset, ...patch } : asset) }] });
  assert.throws(() => tamper({ mechanismPins: { swap: lane } }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => tamper({ mechanismOptions: {} }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => tamper({ rails: { ...row.rails, swap: false }, caps: row.caps }), { code: "APN_INVALID_INPUT" });
});

test("a v2 policy file admits Orca and Jupiter on SOL and USDC at once and shows every route to the owner", () => {
  const routes = [swapRouteOf(ORCA_KEYLESS_MECHANISM_PIN), swapRouteOf(JUPITER_V1_CURRENT_ROUTES[0]!.mechanismPin)];
  const chain = ORCA_KEYLESS_MECHANISM_PIN.chain, compiled = compileAllowlistPolicyOverlayV2({ overlayVersion: "sol-routes.1", profile: "route-swap",
    accounts: { solana: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" }, datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256,
    inventorySha256: inventory.inventorySha256, effectiveAt: "2026-10-16T00:00:00.000Z", admissions: [
      { chain, kind: "native", rail: "swap", maximumPerTransferAtomic: "50000000", dailyLimitAtomic: "100000000", mechanisms: routes },
      { chain, kind: "token", identifier: SOLANA_USDC, rail: "swap", maximumPerTransferAtomic: "50000000", dailyLimitAtomic: "100000000", mechanisms: routes },
    ] });
  const native = compiled.registry.chains[0]!.assets.find((asset) => asset.kind === "native")!;
  assert.ok(assetAdmitsSwapMechanism(native, ORCA_KEYLESS_MECHANISM_PIN));
  assert.ok(JUPITER_V1_FINITE_ROUTES.filter((route) => route.pool === JUPITER_V1_CURRENT_ROUTES[0]!.pool)
    .every((route) => assetAdmitsSwapMechanism(native, route.mechanismPin)));
  assert.equal(admittedSwapProtocol(ORCA_KEYLESS_PROTOCOL_REGISTRY, chain, native, native).mechanismDigest, swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN));
  const lines = allowlistDecisionLines({ action: "activate", profile: "route-swap", accounts: { solana: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" },
    currentActiveRevision: null, fingerprint: H("f"), code: "x", record: { schemaVersion: "apn.allowlist-policy-record.v2", revision: 1,
      status: "staged_unadmitted", preparedAt: "2026-10-16T00:00:00.000Z", overlay: compiled.overlay, registry: compiled.registry, recordDigest: H("e") } } as never,
    "2026-10-16T00:01:00.000Z");
  assert.equal(lines.filter((line) => line.includes(`route digest ${swapRouteDigest(routes[0])}`)).length, 2);
  assert.equal(lines.filter((line) => line.includes(`route digest ${swapRouteDigest(routes[1])}`)).length, 2);
});
