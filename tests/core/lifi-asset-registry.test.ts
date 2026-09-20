import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import type { Address } from "../../src/model.js";
import { BRIDGE_ASSET_REGISTRY, BRIDGE_CHAINS, bridgeAssetPair, bridgeCaip2, bridgeChain, bridgeDecimal,
  bridgeNativeCoin, bridgePeerToken, bridgeTokenRow, validateBridgeRequest } from "../../src/lifi/asset-registry.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { bridgeReceipt } from "../../src/lifi/receipt.js";
import { BRIDGE_FEE_HEADROOM_BPS, BRIDGE_FEE_HEADROOM_POLICY, BRIDGE_ZERO_ADDRESS, bridgeHeadroomWei } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";
import { LIFI_RECIPIENT, LifiTestProvider, lifiFixture, lifiSteps, type LifiJson } from "./lifi-helpers.js";

/** Pinned independently of the registry so the test fails if a row's address is ever edited. */
const USDC = { 1: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  8453: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  42161: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831") } as const;
const WBTC = { 1: getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"),
  42161: getAddress("0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f") } as const;
const WBTC_ARBITRUM_BEACON = getAddress("0xE72ba9418b5f2Ce0A6a40501Fe77c6839Aa37333");
const EIP1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const DAI_ETHEREUM = getAddress("0x6B175474E89094C44Da98b954EedeAC495271d0F");
const request = (over: Partial<Record<string, unknown>> = {}) => ({ fromChainId: 1, toChainId: 8453,
  fromToken: USDC[1], toToken: USDC[8453], amountAtomic: "10000000", recipient: LIFI_RECIPIENT,
  minOutputAtomic: "9000000", maxNativeDebitWei: "20000000000000000", maxRouteFeeAtomic: "1000000", slippageBps: 50, ...over });

test("LI.FI registry admits exactly the reviewed chains, first-class native coins and token rows", () => {
  assert.deepEqual([...BRIDGE_CHAINS], [1, 56, 143, 8453, 42161, 59144]);
  for (const chainId of BRIDGE_CHAINS) {
    const row = BRIDGE_ASSET_REGISTRY[chainId];
    assert.equal(row.caip2, `eip155:${chainId}`);
    const native = bridgeNativeCoin(chainId);
    assert.deepEqual({ kind: native.kind, chainId: native.chainId, symbol: native.symbol, coinKey: native.coinKey, decimals: native.decimals,
      pairKey: native.pairKey, stargate: native.stargate, listing: native.listing },
    { kind: "native", chainId, symbol: chainId === 56 ? "BNB" : chainId === 143 ? "MON" : "ETH",
      coinKey: chainId === 56 ? "BNB" : chainId === 143 ? "MON" : "ETH",
      decimals: 18, pairKey: chainId === 56 ? "bnb" : chainId === 143 ? "mon" : "eth", stargate: null, listing: "frozen_list" });
    assert.ok(row.tokens.every((asset) => asset.kind === "erc20" && asset.address !== BRIDGE_ZERO_ADDRESS));
  }
  assert.deepEqual(BRIDGE_CHAINS.map((id) => BRIDGE_ASSET_REGISTRY[id].tokens.map((t) => `${t.symbol}/${t.coinKey}/${t.decimals}`)),
    [["USDC/USDC/6", "USDT/USDT/6", "WBTC/WBTC/8"], [], [], ["USDC/USDC/6"], ["USDC/USDC/6", "WBTC/WBTC/8"], []]);
  assert.equal(bridgeTokenRow(1, USDC[1]).code.upgradeability, "legacy_proxy");
  assert.equal(bridgeTokenRow(8453, USDC[8453]).code.upgradeability, "legacy_proxy");
  assert.equal(bridgeTokenRow(42161, USDC[42161]).code.upgradeability, "legacy_proxy");
  assert.equal(bridgeTokenRow(1, WBTC[1]).code.upgradeability, "immutable");
  assert.equal(bridgeTokenRow(42161, WBTC[42161]).code.upgradeability, "beacon_proxy");
  assert.deepEqual([...bridgeTokenRow(1, USDC[1]).peers], [8453, 42161]);
  assert.deepEqual([...bridgeTokenRow(1, WBTC[1]).peers], [42161]);
  assert.equal(bridgeTokenRow(1, USDC[1]).stargate?.assetId, 1);
  assert.equal(bridgeTokenRow(1, WBTC[1]).stargate, null);
  for (const chainId of BRIDGE_CHAINS) for (const asset of BRIDGE_ASSET_REGISTRY[chainId].tokens) {
    for (const peer of asset.peers) {
      const other = bridgePeerToken(asset, peer);
      assert.equal(other.pairKey, asset.pairKey); assert.equal(other.decimals, asset.decimals);
      assert.ok(other.peers.includes(chainId), `${asset.symbol} peer sets must be symmetric`);
    }
  }
  // A native coin is never a token with a sentinel address: as a token the provider's zero address is refused outright,
  // and as a route leg it names the native coin, which pairs only with the native coin of a peer chain.
  for (const chainId of BRIDGE_CHAINS) assert.throws(() => bridgeTokenRow(chainId, BRIDGE_ZERO_ADDRESS), /native_sentinel_is_not_a_token/u);
  assert.throws(() => validateBridgeRequest(request({ fromToken: BRIDGE_ZERO_ADDRESS })), /admitted_asset_pair/u);
});

test("LI.FI refuses a chain the registry does not admit", () => {
  for (const value of [10, 137, 0, 43114, 1.5, "1", null, undefined]) assert.throws(() => bridgeChain(value), /chain_identity/u);
  for (const value of ["eip155:10", "eip155:137", "eip155:43114", "eip155:1 ", "EIP155:1", "solana:mainnet", 1, null]) {
    assert.throws(() => bridgeCaip2(value), /bridge_chain_CAIP2/u);
  }
  assert.throws(() => bridgeTokenRow(10, USDC[1]), /chain_identity/u);
  assert.throws(() => validateBridgeRequest(request({ toChainId: 10, toToken: USDC[8453] })), { code: "APN_INVALID_INPUT" });
  // Base admits no WBTC row, so that direction is refused even though both chains are admitted.
  assert.throws(() => bridgeDeployment(1, 8453, "across", WBTC[1]), /finite_chain/u);
  assert.throws(() => bridgeTokenRow(8453, WBTC[1]), /asset_not_on_frozen_list/u);
});

test("LI.FI refuses an asset the registry does not admit", () => {
  assert.throws(() => bridgeTokenRow(1, DAI_ETHEREUM), /asset_not_on_frozen_list/u);
  assert.throws(() => validateBridgeRequest(request({ fromToken: DAI_ETHEREUM })), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bridgeDeployment(1, 8453, "across", DAI_ETHEREUM), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  // Mismatched pair keys and mismatched decimals are both refused.
  assert.throws(() => bridgeAssetPair({ fromChainId: 1, toChainId: 42161, fromToken: USDC[1], toToken: WBTC[42161] }), /admitted_asset_pair/u);
  assert.throws(() => bridgeAssetPair({ fromChainId: 1, toChainId: 1, fromToken: USDC[1], toToken: USDC[1] }), /admitted_asset_pair/u);
  // Stargate pool assets other than the reviewed assetId 1 stay refused.
  assert.throws(() => bridgeDeployment(1, 42161, "stargateV2", WBTC[1]), /stargate_pool_asset_unreviewed/u);
  assert.throws(() => bridgeDeployment(42161, 1, "stargateV2", WBTC[42161]), /stargate_pool_asset_unreviewed/u);
});

test("LI.FI amounts parse at the admitted asset's own precision, not at a fixed six places", () => {
  assert.equal(bridgeDecimal("10.123456", 6, true), "10123456");
  assert.equal(bridgeDecimal("1.00000001", 8, true), "100000001");
  assert.equal(bridgeDecimal("0.00000001", 8, true), "1");
  assert.throws(() => bridgeDecimal("1.0000001", 6, true), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bridgeDecimal("1.000000001", 8, true), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bridgeDecimal("1.0", 0, true), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bridgeDecimal("1", 19, true), /asset_decimals/u);
});

test("LI.FI native coin is a first-class fee asset on a Stargate route and never the bridged principal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await lifiFixture(temporary.root);
  const { operation } = await s.prepare("stargateV2");
  const m = operation.intent.materialization, r = m.request;
  const native = m.feeCosts.filter((fee) => !fee.included);
  assert.equal(native.length, 1);
  assert.equal(native[0]!.asset, "native");
  assert.equal(native[0]!.chainId, r.fromChainId);
  assert.equal(native[0]!.amountAtomic, m.transaction.valueAtomic);
  assert.equal(bridgeNativeCoin(r.fromChainId).decimals, 18);
  assert.ok(m.feeCosts.filter((fee) => fee.included).length > 0);
  assert.ok(m.feeCosts.filter((fee) => fee.included)
    .every((fee) => fee.asset === (fee.chainId === r.fromChainId ? r.fromToken : r.toToken)));
  const receipt = bridgeReceipt(operation);
  assert.equal(receipt.asset.native_principal_admitted, false);
  assert.equal(receipt.asset.from.native_coin.symbol, "ETH");
  assert.equal(receipt.asset.from.native_coin.decimals, 18);
  assert.equal(receipt.asset.from.symbol, "USDC");
});

for (const boundary of ["inside", "outside"] as const) {
  test(`LI.FI fresh price just ${boundary} the owner-approved maximum ${boundary === "inside" ? "still sends" : "refuses before signing"}`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const s = await lifiFixture(temporary.root);
    const { id, operation } = await s.prepare();
    const loads = s.wrapping.loads;
    for (const effect of operation.effects) {
      const e = effect.envelope, c = e.economics, f = e.feeCeiling;
      assert.equal(f.policy, BRIDGE_FEE_HEADROOM_POLICY);
      assert.equal(f.headroomBps, BRIDGE_FEE_HEADROOM_BPS);
      assert.equal(f.quotedMaxFeePerGasAtomic, s.source.gasPrice);
      assert.equal(c.maxFeePerGasAtomic, bridgeHeadroomWei(f.quotedMaxFeePerGasAtomic));
      assert.equal(c.maxPriorityFeePerGasAtomic, bridgeHeadroomWei(f.quotedMaxPriorityFeePerGasAtomic));
      assert.ok(BigInt(c.maxFeePerGasAtomic) > BigInt(f.quotedMaxFeePerGasAtomic));
    }
    const approvedMaximum = BigInt(operation.effects[0]!.envelope.economics.maxFeePerGasAtomic);
    s.approval.confirm = async (input) => {
      s.approval.calls.push(input);
      s.source.gasPrice = (boundary === "inside" ? approvedMaximum : approvedMaximum + 1n).toString();
      return true;
    };
    const result = await s.core.execute({ command: "bridge.approve", operationId: id });
    assert.equal(result.ok, true, result.error?.message);
    const record = (await s.core.bridges.records.findOperation(id))!;
    if (boundary === "inside") {
      assert.equal(record.state, "completed");
      assert.equal(s.source.submissions.length, 2);
      assert.ok(s.wrapping.loads > loads);
    } else {
      assert.equal(record.state, "failed_before_effect");
      assert.equal(record.failure!.reason, "unsent_apn_fee_budget_exceeded");
      assert.equal(s.source.submissions.length, 0);
      assert.equal(s.wrapping.loads, loads);
      assert.ok(record.effects.every((e) => e.phase === "unsealed"));
    }
  });
}

test("LI.FI admits a WBTC route on a second chain with its own decimals and beacon-proxy pins", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date("2026-09-08T12:00:00.000Z");
  const steps = retoken(await lifiSteps("arb-eth", now), [
    { from: USDC[42161], to: WBTC[42161], decimals: 8 }, { from: USDC[1], to: WBTC[1], decimals: 8 },
  ]);
  const s = await lifiFixture(temporary.root, "arb-eth", { now, provider: new LifiTestProvider(steps, now) });
  assert.equal(s.request.fromChainId, 42161); assert.equal(s.request.toChainId, 1);
  assert.equal(s.request.fromToken, WBTC[42161]); assert.equal(s.request.toToken, WBTC[1]);
  // The same asset has no reviewed Stargate pool, so selecting that tool fails closed on the real prepare path and
  // persists no operation; this runs first so the later success is not what blocks it.
  const quotes = await s.core.execute({ command: "bridge.routes", profile: s.profile, request: s.request });
  assert.equal(quotes.ok, true, quotes.error?.message);
  const refused = await s.core.execute({ command: "bridge.prepare", profile: s.profile,
    quote: (quotes.data as { quote_hash: string }).quote_hash, route: "route-stargateV2", idempotencyKey: "wbtc-stargate-0001" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  const { operation } = await s.prepare("across");
  assert.equal(operation.intent.decoded.sourceToken, WBTC[42161]);
  assert.equal(operation.intent.decoded.destinationToken, WBTC[1]);
  assert.equal(operation.intent.sourceAccount.token, WBTC[42161]);
  const receipt = bridgeReceipt(operation);
  assert.equal(receipt.asset.from.symbol, "WBTC"); assert.equal(receipt.asset.from.decimals, 8);
  assert.equal(receipt.asset.from.upgradeability, "beacon_proxy");
  assert.equal(receipt.asset.to.upgradeability, "immutable");
  // The beacon proxy pins the proxy, its beacon and the beacon's implementation; the immutable row pins code only.
  const source = bridgeDeployment(42161, 1, "across", WBTC[42161]);
  assert.equal(source.token, WBTC[42161]);
  assert.ok(source.code.some((row) => row.address === WBTC_ARBITRUM_BEACON));
  assert.ok(source.reads.some((row) => row.kind === "storage" && row.address === WBTC[42161] && row.data === EIP1967_BEACON_SLOT));
  assert.ok(source.reads.some((row) => row.expected === `0x${"0".repeat(63)}8`), "decimals() must be pinned to 8");
  const destination = bridgeDeployment(1, 42161, "across", WBTC[1]);
  assert.equal(destination.code.filter((row) => row.address === WBTC[1]).length, 1);
  assert.ok(!destination.reads.some((row) => row.kind === "storage" && row.address === WBTC[1]));
});

/** Rewrites a captured USDC materialization onto another admitted asset, including inside the encoded calldata. */
function retoken(steps: readonly LifiJson[], rows: readonly { from: Address; to: Address; decimals: number }[]): LifiJson[] {
  let text = JSON.stringify(steps);
  for (const row of rows) {
    text = text.split(row.from).join(row.to);
    text = text.split(row.from.slice(2).toLowerCase()).join(row.to.slice(2).toLowerCase());
  }
  const parsed = JSON.parse(text) as LifiJson[];
  const decimals = new Map(rows.map((row) => [row.to as string, row.decimals] as const));
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) walk(entry); return; }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.address === "string" && decimals.has(record.address) && typeof record.decimals === "number") {
      record.decimals = decimals.get(record.address)!;
    }
    for (const entry of Object.values(record)) walk(entry);
  };
  walk(parsed);
  return parsed;
}
