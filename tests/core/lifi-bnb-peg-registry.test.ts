/**
 * Owner order 2026-11-23: the Binance-Peg USDT and USDC of BNB Smart Chain (18 decimals each) bridge through LI.FI to the
 * same pair key's 6-decimal rows: USDT with Ethereum, USDC with Ethereum, Base and Arbitrum, both directions, over Across.
 * These tests pin the registry rows, the 18/6 pair admission and its refusals, amount parsing and comparison at each
 * leg's own precision, and the BNB Smart Chain source pins.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import type { Address } from "../../src/model.js";
import type { BridgeChainId } from "../../src/lifi/chains.js";
import { BINANCE_PEG_POLICY_ASSETS } from "../../src/binance-peg-policy-assets.js";
import { BRIDGE_ASSET_REGISTRY, bridgeAssetPair, bridgeAssetRow, bridgeExecutionSourceCaip2, bridgeExecutionSourceLeg, bridgeLegScale,
  bridgePeerToken, bridgeScaledPair, validateBridgeRequest, type BridgeTokenAsset } from "../../src/lifi/asset-registry.js";
import { assertBridgeRegistryListed } from "../../src/lifi/asset-listing.js";
import { bridgeCapabilities } from "../../src/lifi/catalog.js";
import { bindBridgeCommand } from "../../src/lifi/command-catalog.js";
import { bridgeLossAsSource, bridgeOutputAsSource, bridgeOutputExceedsSource, bridgeRequestScale } from "../../src/lifi/denomination.js";
import { bridgeDeploymentCheck } from "../../src/lifi/deployment-check.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";

/** Pinned independently of the registry, so an edited row fails here. */
const BSC = { USDT: getAddress("0x55d398326f99059fF775485246999027B3197955"), USDC: getAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d") } as const;
const USDC = { 1: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), 8453: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  42161: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831") } as const;
const USDT_ETHEREUM = getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7");
const USDT0_ARBITRUM = getAddress("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9");
const WBTC_ETHEREUM = getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599");
/** Binance-Peg ETH on BNB Smart Chain: a real contract nobody admitted. */
const BSC_ETH = getAddress("0x2170Ed0880ac9A755fd29B2688956BD959F933F8");
const BSC_SPOKE = getAddress("0x4e8e101924ede233c13e2d8622dc8aed2872d505");
const WBNB = getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
const ACROSS_FACET = getAddress("0xAd3f1634a917924cBb54A0F76e43ca035D2B6BCd");
const RECIPIENT = getAddress("0x4444444444444444444444444444444444444444");
const word = (value: Address | bigint) => `0x${(typeof value === "bigint" ? value.toString(16) : value.slice(2).toLowerCase()).padStart(64, "0")}`;

function token(chainId: number, address: Address): BridgeTokenAsset {
  const row = bridgeAssetRow(chainId, address);
  if (row.kind !== "erc20") throw new Error("expected a token row");
  return row;
}
function request(fromChainId: BridgeChainId, fromToken: Address, toChainId: BridgeChainId, toToken: Address, over: Record<string, unknown> = {}) {
  const from = token(fromChainId, fromToken).decimals, to = token(toChainId, toToken).decimals;
  return { fromChainId, toChainId, fromToken, toToken, amountAtomic: (20n * 10n ** BigInt(from)).toString(), recipient: RECIPIENT,
    minOutputAtomic: (19n * 10n ** BigInt(to)).toString(), maxNativeDebitWei: "20000000000000000",
    maxRouteFeeAtomic: (10n ** BigInt(from)).toString(), slippageBps: 50, ...over };
}

test("BNB Smart Chain lists the owner-admitted Binance-Peg USDT and USDC as reviewed supplement rows, over Across only", () => {
  const supplement = new Map(BINANCE_PEG_POLICY_ASSETS.map((row) => [row.identifier, row]));
  for (const [address, symbol, peers] of [[BSC.USDC, "USDC", [1, 8453, 42161]], [BSC.USDT, "USDT", [1]]] as const) {
    const row = token(56, address), listed = supplement.get(address)!;
    assert.deepEqual([row.symbol, row.coinKey, row.pairKey, row.decimals, row.listing], [listed.symbol, symbol, symbol.toLowerCase(), 18, "reviewed_supplement"]);
    assert.equal(listed.decimals, 18);
    assert.deepEqual({ across: row.acrossSupported, stargate: row.stargate, approval: row.approval, transferFee: row.transferFee, peers: [...row.peers] },
      { across: true, stargate: null, approval: "standard", transferFee: "none", peers: [...peers] });
  }
  assert.deepEqual(token(56, BSC.USDT).code, { upgradeability: "immutable",
    codeHash: "0x97a48aa4c129657440dafdacd4c836389734d28cc4a0ca7403e68da660a74a59" });
  assert.deepEqual(token(56, BSC.USDC).code, { upgradeability: "eip1967_proxy",
    codeHash: "0x56069ff2fd59ae482f7984aa894b6d3bc84cb910354dcda9cd6c828d61526914",
    implementation: getAddress("0xba5fe23f8a3a24bed3236f05f2fcf35fd0bf0b5c"),
    implementationCodeHash: "0xd2d7cf7504e1cb572af28476d45907fc30bee1297917bed153e6fbba125821a3",
    admin: getAddress("0xd2f93484f2d319194cba95c5171b18c1d8cfd6c4") });
  // The 6-decimal peers name BNB Smart Chain back; Tether on Ethereum has no other peer.
  assert.deepEqual([...token(1, USDT_ETHEREUM).peers], [56]);
  for (const chainId of [1, 8453, 42161] as const) assert.ok(token(chainId, USDC[chainId]).peers.includes(56));
  const bnb = bridgeCapabilities().chains.find((row) => row.chain === "eip155:56")!;
  assert.deepEqual(bnb.native_coin.tools, ["across"]);
  assert.deepEqual(bnb.tokens.map((row) => [row.token, row.symbol, row.decimals, row.tools, row.listing, row.peers]), [
    [BSC.USDC, "USDC", 18, ["across"], "reviewed_supplement", ["eip155:1", "eip155:8453", "eip155:42161"]],
    [BSC.USDT, "USDT", 18, ["across"], "reviewed_supplement", ["eip155:1"]]]);
});

test("a Binance-Peg row that drifts from the reviewed supplement is an installation fault", () => {
  const drift = (edit: (row: Record<string, unknown>) => void) => {
    const registry = structuredClone(BRIDGE_ASSET_REGISTRY) as any;
    edit(registry[56].tokens.find((row: BridgeTokenAsset) => row.address === BSC.USDC));
    assert.throws(() => assertBridgeRegistryListed(registry), { code: "APN_INTERNAL" });
  };
  drift((row) => { row.decimals = 6; });
  drift((row) => { row.address = BSC_ETH; });
  drift((row) => { row.symbol = "USDT"; });
  drift((row) => { row.pairKey = "usdt"; });
  drift((row) => { row.stargate = BRIDGE_ASSET_REGISTRY[1].tokens[0]!.stargate; });
  drift((row) => { row.approval = "zero_first"; });
  drift((row) => { row.listing = "frozen_list"; });
  // The unchanged registry passes.
  assert.doesNotThrow(() => assertBridgeRegistryListed(structuredClone(BRIDGE_ASSET_REGISTRY) as any));
});

test("each Binance-Peg row pairs with its 6-decimal peer in both directions; nothing else crosses decimals", () => {
  const pairs = [[56, BSC.USDC, 1, USDC[1]], [1, USDC[1], 56, BSC.USDC], [56, BSC.USDC, 8453, USDC[8453]], [8453, USDC[8453], 56, BSC.USDC],
    [56, BSC.USDC, 42161, USDC[42161]], [42161, USDC[42161], 56, BSC.USDC], [56, BSC.USDT, 1, USDT_ETHEREUM], [1, USDT_ETHEREUM, 56, BSC.USDT]] as const;
  for (const [fromChainId, fromToken, toChainId, toToken] of pairs) {
    const pair = bridgeAssetPair({ fromChainId, toChainId, fromToken, toToken });
    assert.deepEqual([pair.from.decimals, pair.to.decimals], fromChainId === 56 ? [18, 6] : [6, 18]);
    assert.equal(bridgeScaledPair(pair.from, pair.to), true);
    assert.deepEqual(bridgeLegScale(pair.from, pair.to), fromChainId === 56 ? { source: 1n, destination: 10n ** 12n } : { source: 10n ** 12n, destination: 1n });
    assert.doesNotThrow(() => validateBridgeRequest(request(fromChainId, fromToken, toChainId, toToken)));
  }
  assert.equal(bridgePeerToken(token(56, BSC.USDC), 1).address, USDC[1]);
  assert.equal(bridgePeerToken(token(1, USDT_ETHEREUM), 56).address, BSC.USDT);
  assert.equal(bridgePeerToken(token(8453, USDC[8453]), 56).address, BSC.USDC);
  // A same-decimals pair is not scaled; a different pair key or a forged row never is.
  assert.equal(bridgeScaledPair(token(1, USDC[1]), token(8453, USDC[8453])), false);
  assert.deepEqual(bridgeLegScale(token(1, USDC[1]), token(8453, USDC[8453])), { source: 1n, destination: 1n });
  assert.equal(bridgeScaledPair(token(56, BSC.USDT), token(1, USDC[1])), false);
  assert.equal(bridgeScaledPair({ ...token(56, BSC.USDC), decimals: 8 }, token(1, USDC[1])), false);
  assert.equal(bridgeScaledPair({ ...token(56, BSC.USDC), listing: "frozen_list" }, token(1, USDC[1])), false);
  assert.throws(() => bridgeLegScale(token(1, WBTC_ETHEREUM), token(1, USDC[1])), /admitted_asset_pair/u);
});

test("Binance-Peg pairs refuse another pair key, an unadmitted contract, a non-canonical spelling and native BNB", () => {
  const refused = (fromChainId: BridgeChainId, fromToken: Address, toChainId: BridgeChainId, toToken: Address, reason: RegExp) =>
    assert.throws(() => bridgeAssetPair({ fromChainId, toChainId, fromToken, toToken }), reason);
  refused(56, BSC.USDT, 8453, USDC[8453], /admitted_asset_pair/u);
  refused(56, BSC.USDT, 1, USDC[1], /admitted_asset_pair/u);
  refused(56, BSC.USDC, 1, USDT_ETHEREUM, /admitted_asset_pair/u);
  refused(56, BSC.USDC, 56, BSC.USDT, /admitted_asset_pair/u);
  refused(56, BSC.USDT, 42161, USDT0_ARBITRUM, /asset_not_on_frozen_list/u);
  refused(56, BSC_ETH, 1, BRIDGE_ZERO_ADDRESS, /asset_not_on_frozen_list/u);
  refused(56, BRIDGE_ZERO_ADDRESS, 1, BRIDGE_ZERO_ADDRESS, /admitted_asset_pair/u);
  refused(1, USDC[1], 56, BRIDGE_ZERO_ADDRESS, /admitted_asset_pair/u);
  assert.throws(() => validateBridgeRequest(request(56, BSC.USDC, 1, USDC[1], { fromToken: BSC.USDC.toLowerCase() })), /canonical_addresses/u);
  assert.throws(() => validateBridgeRequest(request(1, USDC[1], 56, BSC.USDC, { toToken: BSC.USDC.toLowerCase() })), /canonical_addresses/u);
});

test("amounts parse at each leg's own precision and the output floor compares at the finer one", () => {
  const flags = (from: string, fromToken: Address, to: string, toToken: Address, over: Record<string, string> = {}) => ({
    "--profile": "p", "--from-chain": from, "--to-chain": to, "--from-token": fromToken, "--to-token": toToken, "--amount": "20",
    "--to": RECIPIENT, "--min-output": "19.9", "--max-native-debit-wei": "20000000000000000", "--max-route-fee": "0.1", "--slippage-bps": "50", ...over });
  const bound = (input: Record<string, string>) => (bindBridgeCommand("bridge routes", input) as any).request;
  const up = bound(flags("eip155:1", USDC[1], "eip155:56", BSC.USDC));
  assert.deepEqual([up.amountAtomic, up.minOutputAtomic, up.maxRouteFeeAtomic], ["20000000", "19900000000000000000", "100000"]);
  const down = bound(flags("eip155:56", BSC.USDC, "eip155:1", USDC[1]));
  assert.deepEqual([down.amountAtomic, down.minOutputAtomic, down.maxRouteFeeAtomic], ["20000000000000000000", "19900000", "100000000000000000"]);
  const usdt = bound(flags("eip155:56", BSC.USDT, "eip155:1", USDT_ETHEREUM, { "--amount": "1.000000000000000001", "--min-output": "0.9" }));
  assert.deepEqual([usdt.amountAtomic, usdt.minOutputAtomic], ["1000000000000000001", "900000"]);
  // A 6-decimal floor takes no seventh digit; a floor above the principal is refused at the finer precision.
  assert.throws(() => bound(flags("eip155:56", BSC.USDC, "eip155:1", USDC[1], { "--min-output": "19.9000001" })), /asset_decimal_amount/u);
  assert.throws(() => bound(flags("eip155:1", USDC[1], "eip155:56", BSC.USDC, { "--min-output": "20.000000000000000001" })), /output_or_slippage/u);
  assert.equal(bound(flags("eip155:1", USDC[1], "eip155:56", BSC.USDC, { "--min-output": "20" })).minOutputAtomic, "20000000000000000000");
  assert.throws(() => validateBridgeRequest(request(1, USDC[1], 56, BSC.USDC, { minOutputAtomic: "20000000000000000001" })), /output_or_slippage/u);
  assert.throws(() => validateBridgeRequest(request(56, BSC.USDC, 1, USDC[1], { minOutputAtomic: "20000001" })), /output_or_slippage/u);
  assert.doesNotThrow(() => validateBridgeRequest(request(56, BSC.USDC, 1, USDC[1], { minOutputAtomic: "20000000" })));
});

test("denomination helpers compare exactly and round only against the owner", () => {
  const up = bridgeRequestScale({ fromChainId: 1, toChainId: 56, fromToken: USDC[1], toToken: BSC.USDC });
  assert.deepEqual(up, { source: 10n ** 12n, destination: 1n, scaled: true });
  assert.equal(bridgeOutputAsSource(19_944_583_999_999_999_999n, up), 19_944_583n);
  assert.equal(bridgeLossAsSource(20_000_000n, 19_944_583_999_999_999_999n, up), 55_417n);
  assert.equal(bridgeLossAsSource(20_000_000n, 19_944_584_000_000_000_000n, up), 55_416n);
  assert.equal(bridgeOutputExceedsSource(20_000_000n, 20_000_000_000_000_000_001n, up), true);
  assert.equal(bridgeOutputExceedsSource(20_000_000n, 20_000_000_000_000_000_000n, up), false);
  const down = bridgeRequestScale({ fromChainId: 56, toChainId: 1, fromToken: BSC.USDC, toToken: USDC[1] });
  assert.deepEqual(down, { source: 1n, destination: 10n ** 12n, scaled: true });
  assert.equal(bridgeOutputAsSource(19_912_827n, down), 19_912_827_000_000_000_000n);
  assert.equal(bridgeLossAsSource(20_000_000_000_000_000_000n, 19_912_827n, down), 87_173_000_000_000_000n);
  assert.equal(bridgeOutputExceedsSource(20_000_000_000_000_000_000n, 20_000_001n, down), true);
  const same = bridgeRequestScale({ fromChainId: 1, toChainId: 8453, fromToken: USDC[1], toToken: USDC[8453] });
  assert.deepEqual(same, { source: 1n, destination: 1n, scaled: false });
  assert.equal(bridgeLossAsSource(10_000_000n, 9_990_000n, same), 10_000n);
});

test("BNB Smart Chain is an Across source for its Binance-Peg rows only; native BNB stays destination-only", () => {
  assert.deepEqual([bridgeExecutionSourceLeg(56, BSC.USDC), bridgeExecutionSourceLeg(56, BSC.USDT), bridgeExecutionSourceLeg(56, BRIDGE_ZERO_ADDRESS),
    bridgeExecutionSourceLeg(143, BRIDGE_ZERO_ADDRESS), bridgeExecutionSourceLeg(1, BRIDGE_ZERO_ADDRESS)], [true, true, false, false, true]);
  assert.deepEqual([bridgeExecutionSourceCaip2("eip155:56", "token"), bridgeExecutionSourceCaip2("eip155:56", "native"),
    bridgeExecutionSourceCaip2("eip155:1", "native"), bridgeExecutionSourceCaip2("eip155:59144", "token")], [true, false, true, false]);
  const source = bridgeDeployment(56, 1, "across", BSC.USDC);
  assert.deepEqual([source.diamond, source.protocolEmitter, source.quoteTimeBufferAtomic, source.fillDeadlineBufferAtomic],
    [BRIDGE_DIAMOND, BSC_SPOKE, "3600", "21600"]);
  assert.ok(source.code.some((row) => row.address === BRIDGE_DIAMOND && row.codeHash === "0x828f8a0694bfba25c80a406283f149d701cdc944acbbc18b57315cf157db9220"));
  assert.ok(source.code.some((row) => row.address === ACROSS_FACET && row.codeHash === "0xc4d421a71c7be08e990bd0b88fdf61afb6ed1b3c60afed6899cad8deebb42e5e"));
  // The light check at the send head: FeeForwarder allowlisting, exact 18 decimals, the facet routing to the BSC SpokePool
  // and WBNB, and the SpokePool time buffers. Implementation slots and code hashes are records, not live reads.
  const check = bridgeDeploymentCheck(56, 1, "across", BSC.USDC, "source");
  assert.equal(check.reads.length, 7);
  assert.ok(check.reads.every((row) => row.kind === "call"));
  const expected = new Set(check.reads.map((row) => `${row.address}:${row.expected}`));
  for (const row of [`${BSC.USDC}:${word(18n)}`, `${ACROSS_FACET}:${word(BSC_SPOKE)}`, `${ACROSS_FACET}:${word(WBNB)}`,
    `${BSC_SPOKE}:${word(3600n)}`, `${BSC_SPOKE}:${word(21600n)}`]) assert.ok(expected.has(row), row);
  // A destination token leg on BSC reads nothing before the send; native BNB keeps the composite's routing check.
  assert.equal(bridgeDeploymentCheck(56, 1, "across", BSC.USDC, "destination").reads.length, 0);
  assert.ok(bridgeDeploymentCheck(56, 1, "across", BRIDGE_ZERO_ADDRESS, "destination").reads.length > 0);
  assert.throws(() => bridgeDeployment(56, 8453, "across", BRIDGE_ZERO_ADDRESS), /bnb_composite_finite_direction/u);
  assert.throws(() => bridgeDeployment(56, 8453, "across", BSC.USDT), /finite_chain/u);
  // No Stargate pool of these tokens is reviewed, in either direction.
  assert.throws(() => bridgeDeployment(56, 1, "stargateV2", BSC.USDC), /stargate_pool_asset_unreviewed/u);
  assert.throws(() => bridgeDeployment(1, 56, "stargateV2", USDC[1]), /stargate_chain_unreviewed/u);
});
