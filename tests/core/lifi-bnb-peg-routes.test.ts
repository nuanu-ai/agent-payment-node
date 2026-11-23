/**
 * Captured LI.FI routes (2026-11-23, unsigned public API) for the Binance-Peg USDT and USDC of BNB Smart Chain against
 * their 6-decimal peers. Across and Stargate V2 both route every pair; APN admits Across only. These tests drive the
 * captures through route parsing, materialization, the finite decoder, the token economics and the log proofs, with each
 * leg in its own decimals.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress } from "viem";
import type { Address, Hex } from "../../src/model.js";
import { acrossBridgeAbi, EVENT_TOPICS, stargateBridgeAbi } from "../../src/lifi/abi.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeOutputAsSource, bridgeRequestScale } from "../../src/lifi/denomination.js";
import type { BridgeMaterialization, BridgeRouteRequest } from "../../src/lifi/model.js";
import { bridgeDestinationProof, bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { materializeBridgeRoute, parseBridgeRoutes, validateRouteEconomics } from "../../src/lifi/routes.js";
import { validateBridgeRequest } from "../../src/lifi/asset-registry.js";
import { lifiCapture } from "./lifi-capture.js";
import { addressWord, makeDestinationReceipt, makeSourceReceipt, mutateEvent } from "./lifi-event-fixtures.js";

type Json = Record<string, any>;
type Pair = "eth-usdc-bsc" | "bsc-usdc-eth" | "eth-usdt-bsc" | "bsc-usdt-eth" | "base-usdc-bsc" | "bsc-usdc-arb";
const capture = lifiCapture("lifi-bnb-peg-across-20261123.json") as Json;
const DEAD = getAddress("0x000000000000000000000000000000000000dead");
const BSC = { USDT: getAddress("0x55d398326f99059fF775485246999027B3197955"), USDC: getAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d") } as const;
const USDC = { 1: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), 8453: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  42161: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831") } as const;
const USDT_ETHEREUM = getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7");
/** Each pair's legs (chain, token, decimals), and what the captured Across call deposits and leaves unitemized. */
const PAIRS: Readonly<Record<Pair, { from: readonly [1 | 56 | 8453, Address, number]; to: readonly [1 | 56 | 42161, Address, number];
  deposit: string; minimum: string; implicit: string }>> = {
  "eth-usdc-bsc": { from: [1, USDC[1], 6], to: [56, BSC.USDC, 18], deposit: "19944584000000000000", minimum: "19944584000000000000", implicit: "0" },
  "bsc-usdc-eth": { from: [56, BSC.USDC, 18], to: [1, USDC[1], 6], deposit: "19912833", minimum: "19912827", implicit: "820973750014" },
  "eth-usdt-bsc": { from: [1, USDT_ETHEREUM, 6], to: [56, BSC.USDT, 18], deposit: "19944786000000000000", minimum: "19944786000000000000", implicit: "0" },
  "bsc-usdt-eth": { from: [56, BSC.USDT, 18], to: [1, USDT_ETHEREUM, 6], deposit: "19914289", minimum: "19914277", implicit: "213982500010" },
  "base-usdc-bsc": { from: [8453, USDC[8453], 6], to: [56, BSC.USDC, 18], deposit: "19944584000000000000", minimum: "19944584000000000000", implicit: "0" },
  "bsc-usdc-arb": { from: [56, BSC.USDC, 18], to: [42161, USDC[42161], 6], deposit: "19941820", minimum: "19941815", implicit: "820973750013" },
};

function pegRequest(pair: Pair, over: Partial<BridgeRouteRequest> = {}): BridgeRouteRequest {
  const p = PAIRS[pair];
  return validateBridgeRequest({ fromChainId: p.from[0], toChainId: p.to[0], fromToken: p.from[1], toToken: p.to[1],
    amountAtomic: (20n * 10n ** BigInt(p.from[2])).toString(), recipient: DEAD, minOutputAtomic: (19n * 10n ** BigInt(p.to[2])).toString(),
    maxNativeDebitWei: "20000000000000000", maxRouteFeeAtomic: (10n ** BigInt(p.from[2])).toString(), slippageBps: 50, ...over });
}
function captured(pair: Pair, over: Partial<BridgeRouteRequest> = {}, edit: (step: Json) => void = () => {}) {
  const request = pegRequest(pair, over), c = capture.pairs[pair];
  const routes = parseBridgeRoutes({ status: 200, body: JSON.stringify(c.routes) }, request, DEAD);
  const across = routes.find((route) => route.choice.tool === "across")!, step = structuredClone(c.acrossStep) as Json;
  edit(step);
  return { request, routes, ...materializeBridgeRoute(across, { status: 200, body: JSON.stringify(step) }, request, DEAD) };
}
function mutateCall(m: BridgeMaterialization, edit: (args: any[]) => void): BridgeMaterialization {
  const decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: m.transaction.data }), args = structuredClone(decoded.args) as unknown as any[];
  edit(args);
  return { ...m, transaction: { ...m.transaction, data: encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never }) } };
}

for (const pair of Object.keys(PAIRS) as Pair[]) test(`captured ${pair}: Across decodes at both precisions, Stargate stays unreviewed`, () => {
  const p = PAIRS[pair], { request, routes, materialization: m, implicitProtocolFeeAtomic } = captured(pair);
  assert.deepEqual([capture.pairs[pair].acrossStep.action.fromToken.decimals, capture.pairs[pair].acrossStep.action.toToken.decimals], [p.from[2], p.to[2]]);
  assert.deepEqual(routes.map((route) => [route.choice.tool, route.choice.preparable, route.choice.unavailableReason]),
    [["across", true, null], ["stargateV2", false, "asset_tool_unreviewed"]]);
  assert.equal(m.minimumOutputAtomic, p.minimum);
  // Every included fee is the source asset on the source chain; the unitemized remainder is in source atomic units.
  assert.ok(m.feeCosts.every((fee) => fee.included && fee.chainId === request.fromChainId && fee.asset === request.fromToken));
  const included = m.feeCosts.reduce((sum, fee) => sum + BigInt(fee.amountAtomic), 0n);
  assert.equal(implicitProtocolFeeAtomic, p.implicit);
  assert.equal(included + bridgeOutputAsSource(BigInt(m.quotedOutputAtomic), bridgeRequestScale(request)) + BigInt(implicitProtocolFeeAtomic),
    BigInt(request.amountAtomic));
  const d = decodeBridgeCall(m);
  assert.equal(d.protocol.kind, "across");
  if (d.protocol.kind !== "across") return;
  // The facet deposits minAmount x multiplier / 1e18: equal to the calldata output from 6 decimals, a few units above it
  // from 18 because LI.FI rounds the multiplier up.
  assert.equal(d.protocol.outputAmountAtomic, p.deposit);
  assert.ok(BigInt(d.protocol.outputAmountAtomic) >= BigInt(d.minimumOutputAtomic));
  assert.deepEqual([d.protocol.sendingAssetId, d.protocol.receivingAssetId], [addressWord(p.from[1]), addressWord(p.to[1])]);
});

test("the owner's route fee cap binds the loss at the source precision, rounded up, in both directions", () => {
  // 18 to 6: 20 USDC minus the 19.912827 USDC floor is exactly 87173000000000000 BSC atomic units.
  const down = captured("bsc-usdc-eth").materialization;
  assert.doesNotThrow(() => validateRouteEconomics({ ...down, request: { ...down.request, maxRouteFeeAtomic: "87173000000000000" } }));
  assert.throws(() => validateRouteEconomics({ ...down, request: { ...down.request, maxRouteFeeAtomic: "87172999999999999" } }),
    { code: "APN_FEE_BUDGET_EXCEEDED", message: /bridge_output_or_token_fee_limit/u });
  assert.doesNotThrow(() => captured("bsc-usdc-eth", { maxRouteFeeAtomic: "87173000000000000" }));
  assert.throws(() => captured("bsc-usdc-eth", { maxRouteFeeAtomic: "87172999999999999" }), /output_economics/u);
  // 6 to 18: 20 USDC minus 19.944584 is 55416 Ethereum atomic units.
  const up = captured("eth-usdc-bsc").materialization;
  assert.doesNotThrow(() => validateRouteEconomics({ ...up, request: { ...up.request, maxRouteFeeAtomic: "55416" } }));
  assert.throws(() => validateRouteEconomics({ ...up, request: { ...up.request, maxRouteFeeAtomic: "55415" } }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  // The owner floor is in destination units and must not exceed the materialized minimum.
  assert.doesNotThrow(() => captured("eth-usdc-bsc", { minOutputAtomic: "19944584000000000000" }));
  assert.throws(() => captured("eth-usdc-bsc", { minOutputAtomic: "19944584000000000001" }), /output_economics/u);
  assert.throws(() => captured("bsc-usdc-eth", { minOutputAtomic: "19912828" }), /output_economics/u);
  // An output worth more than the principal is refused at the finer precision.
  assert.throws(() => validateRouteEconomics({ ...up, quotedOutputAtomic: "20000000000000000001" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
});

test("the Across multiplier must be the least one whose deposit reaches the calldata output", () => {
  const refused = (m: BridgeMaterialization) => assert.throws(() => decodeBridgeCall(m), /across_semantics/u);
  for (const pair of ["bsc-usdc-eth", "eth-usdc-bsc"] as const) {
    const m = captured(pair).materialization;
    const multiplier = (decodeFunctionData({ abi: acrossBridgeAbi, data: m.transaction.data }).args as unknown as any[])[2].outputAmountMultiplier as bigint;
    refused(mutateCall(m, (a) => { a[2].outputAmountMultiplier = multiplier + 1n; }));
    refused(mutateCall(m, (a) => { a[2].outputAmountMultiplier = multiplier - 1n; }));
    // Read as one denomination (1e18), the deposit would be off by 10^12 either way.
    refused(mutateCall(m, (a) => { a[2].outputAmountMultiplier = 1_000_000_000_000_000_000n; }));
    refused(mutateCall(m, (a) => { a[2].outputAmount = a[2].outputAmount - 1n; }));
    refused(mutateCall(m, (a) => { a[2].receivingAssetId = addressWord(USDC[8453]); }));
  }
  // From 18 decimals a multiplier above 10^6 would deposit more value than the route bridged.
  const m = captured("bsc-usdc-eth").materialization;
  refused(mutateCall(m, (a) => { a[2].outputAmountMultiplier = 1_000_001n; }));
});

test("LI.FI metadata naming the wrong decimals or contract for a Binance-Peg leg is refused", () => {
  const refused = (pair: Pair, edit: (step: Json) => void, reason: RegExp) => assert.throws(() => captured(pair, {}, edit), reason);
  refused("eth-usdc-bsc", (step) => { step.action.toToken.decimals = 6; }, /admitted_asset_metadata/u);
  refused("bsc-usdc-eth", (step) => { step.action.fromToken.decimals = 6; }, /admitted_asset_metadata/u);
  // The included bridge step is bound by the step identity the route was offered with.
  refused("eth-usdc-bsc", (step) => { step.includedSteps[1].action.toToken.decimals = 6; }, /materialized_step_identity_changed/u);
  refused("bsc-usdc-eth", (step) => { step.estimate.feeCosts[0].token.decimals = 6; }, /fee_asset/u);
  refused("eth-usdc-bsc", (step) => { step.action.toToken.address = BSC.USDT; }, /admitted_asset_metadata/u);
  // A scaled pair's included fees are source fees: a destination-chain fee row cannot share one sum.
  refused("bsc-usdc-eth", (step) => { step.estimate.feeCosts[1].token = { ...step.estimate.feeCosts[1].token, chainId: 1, address: USDC[1], decimals: 6 }; },
    /included_fee_asset/u);
  // A route row that names the wrong decimals is refused before any choice is offered.
  const routes = structuredClone(capture.pairs["eth-usdc-bsc"].routes) as Json;
  routes.routes[0].toToken.decimals = 6;
  assert.throws(() => parseBridgeRoutes({ status: 200, body: JSON.stringify(routes) }, pegRequest("eth-usdc-bsc"), DEAD), /admitted_asset_metadata/u);
});

test("the source deposit and the destination fill are proved in each leg's own decimals", () => {
  for (const pair of ["bsc-usdc-eth", "eth-usdc-bsc", "bsc-usdt-eth", "eth-usdt-bsc"] as const) {
    const p = PAIRS[pair], m = captured(pair).materialization, d = decodeBridgeCall(m), sourceReceipt = makeSourceReceipt(d);
    const source = bridgeSourceProof(m, d, sourceReceipt);
    assert.equal(source.correlation.kind === "across" ? source.correlation.outputAmountAtomic : null, p.deposit);
    // The chain deposits the recomputed output; a log carrying the calldata's output (from 18 decimals) or a 10^12 slip is not this deposit.
    const deposited = sourceReceipt.logs.findIndex((log) => log.topics[0] === EVENT_TOPICS.fundsDeposited);
    assert.ok(deposited >= 0);
    const withDeposit = (outputAmount: bigint) => ({ ...sourceReceipt, logs: sourceReceipt.logs.map((log, index) =>
      index === deposited ? mutateEvent(log, "FundsDeposited", { outputAmount }) : log) });
    if (p.deposit !== p.minimum) assert.throws(() => bridgeSourceProof(m, d, withDeposit(BigInt(p.minimum))), /FundsDeposited/u);
    assert.throws(() => bridgeSourceProof(m, d, withDeposit(BigInt(p.deposit) * 10n ** 12n)), /FundsDeposited/u);
    const destinationReceipt = makeDestinationReceipt(d, source);
    const delivered = bridgeDestinationProof(source, m, d, destinationReceipt);
    assert.deepEqual([delivered.chainId, delivered.token, delivered.recipient, delivered.amountAtomic], [p.to[0], p.to[1], DEAD, p.deposit]);
    const transfer = destinationReceipt.logs.findIndex((log) => log.address === p.to[1]);
    const withTransfer = (value: bigint) => ({ ...destinationReceipt, logs: destinationReceipt.logs.map((log, index) =>
      index === transfer ? mutateEvent(log, "Transfer", { value }) : log) });
    for (const value of [BigInt(p.deposit) * 10n ** 12n, BigInt(p.deposit) / 10n ** 12n, BigInt(p.deposit) - 1n]) {
      assert.throws(() => bridgeDestinationProof(source, m, d, withTransfer(value)), /destination_token_movement/u);
    }
  }
});

test("Stargate calldata for a Binance-Peg pair is refused by the decoder, not only by the route gate", () => {
  const m = captured("bsc-usdc-eth").materialization, a = decodeFunctionData({ abi: acrossBridgeAbi, data: m.transaction.data }).args as unknown as any[];
  const data = encodeFunctionData({ abi: stargateBridgeAbi, functionName: "swapAndStartBridgeTokensViaStargate", args: [{ ...a[0], bridge: "stargateV2" }, a[1],
    { assetId: 1, sendParams: { dstEid: 30101, to: addressWord(DEAD), amountLD: a[0].minAmount, minAmountLD: BigInt(m.minimumOutputAtomic),
      extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" }, fee: { nativeFee: 1n, lzTokenFee: 0n }, refundAddress: DEAD }] as never });
  assert.equal(data.slice(0, 10), "0xa6010a66");
  assert.throws(() => decodeBridgeCall({ ...m, tool: "stargateV2", transaction: { ...m.transaction, data: data as Hex, valueAtomic: "1" } }),
    /stargate_scaled_pair_unreviewed/u);
});
