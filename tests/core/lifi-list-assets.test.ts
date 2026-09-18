import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAbiItem, getAddress } from "viem";
import type { AbiParameter } from "viem";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import type { Address, Hex } from "../../src/model.js";
import { acrossBridgeAbi, bridgeEventsAbi, FEE_FORWARDER, FEE_RECIPIENT, feeForwarderAbi } from "../../src/lifi/abi.js";
import { BRIDGE_ASSET_REGISTRY, BRIDGE_CHAINS, bridgeAssetPair, bridgeAssetRow, bridgeTokenRow, validateBridgeRequest } from "../../src/lifi/asset-registry.js";
import { bridgeCapabilities } from "../../src/lifi/catalog.js";
import { bindBridgeCommand } from "../../src/lifi/command-catalog.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { bridgeApprovalRequired, freezeBridgeEnvelopes } from "../../src/lifi/economics.js";
import type { BridgeAccountSnapshot, BridgeLog, BridgeMaterialization, BridgeProtocolReceipt, BridgeRouteRequest, DecodedBridgeCall } from "../../src/lifi/model.js";
import type { BridgeRpcPort } from "../../src/lifi/ports.js";
import { bridgeDestinationProof, bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { materializeBridgeRoute, parseBridgeRoutes } from "../../src/lifi/routes.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS, BRIDGE_ZERO_WORD } from "../../src/lifi/validation.js";

type Json = Record<string, any>;
type Pair = "eth-base" | "eth-arb";
/** Pinned independently of the registry so a silent edit of any row fails here. */
const OWNER = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
const USDC = { 1: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), 8453: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  42161: getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831") } as const;
const USDT = getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7");
const USDT0_ARBITRUM = getAddress("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9");
const WETH = { 1: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), 8453: getAddress("0x4200000000000000000000000000000000000006"),
  42161: getAddress("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1") } as const;
const SPOKE = { 1: getAddress("0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5"), 8453: getAddress("0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64"),
  42161: getAddress("0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A") } as const;
const RELAYER = getAddress("0x2222222222222222222222222222222222222222");
const HASH = `0x${"ab".repeat(32)}` as Hex;
const ONE_MILLI_ETH = "1000000000000000";

async function capture(): Promise<Json> {
  return JSON.parse(await readFile(resolve("tests/core/lifi-fixtures", "lifi-list-assets-read-only-20260918.json"), "utf8")) as Json;
}
function nativeRequest(pair: Pair, over: Partial<BridgeRouteRequest> = {}): BridgeRouteRequest {
  return validateBridgeRequest({ fromChainId: 1, toChainId: pair === "eth-base" ? 8453 : 42161, fromToken: BRIDGE_ZERO_ADDRESS,
    toToken: BRIDGE_ZERO_ADDRESS, amountAtomic: ONE_MILLI_ETH, recipient: OWNER, minOutputAtomic: "990000000000000",
    maxNativeDebitWei: "2000000000000000", maxRouteFeeAtomic: "10000000000000", slippageBps: 50, ...over });
}
async function nativeRoute(pair: Pair, editStep: (step: Json) => void = () => {}) {
  const c = (await capture()).native[pair], request = nativeRequest(pair);
  const routes = parseBridgeRoutes({ status: 200, body: JSON.stringify(c.routes) }, request, OWNER);
  const across = routes.find((r) => r.choice.tool === "across")!, step = structuredClone(c.acrossStep) as Json;
  editStep(step);
  return { request, routes, ...materializeBridgeRoute(across, { status: 200, body: JSON.stringify(step) }, request, OWNER) };
}
function mutateData(m: BridgeMaterialization, edit: (args: any[]) => void): BridgeMaterialization {
  const decoded = decodeFunctionData({ abi: acrossBridgeAbi, data: m.transaction.data });
  const args = structuredClone(decoded.args) as unknown as any[];
  edit(args);
  return { ...m, transaction: { ...m.transaction, data: encodeFunctionData({ abi: acrossBridgeAbi, functionName: decoded.functionName, args: args as never }) } };
}
function word(address: Address): Hex { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}` as Hex; }

test("the bridge registry is the frozen list's exact identities; WBTC stays a legacy pinned row", () => {
  const assets = loadAllowlistInventory().assets;
  for (const chainId of BRIDGE_CHAINS) {
    const row = BRIDGE_ASSET_REGISTRY[chainId], native = assets.find((a) => a.chain === row.caip2 && a.kind === "native")!;
    assert.equal(row.nativeCoin.symbol, native.symbol); assert.equal(row.nativeCoin.decimals, native.decimals);
    assert.deepEqual([...row.nativeCoin.peers].sort(), BRIDGE_CHAINS.filter((id) => id !== chainId).sort());
    assert.equal(row.nativeCoin.wrapped.address, WETH[chainId]);
    assert.equal(bridgeAssetRow(chainId, BRIDGE_ZERO_ADDRESS), row.nativeCoin);
    for (const token of row.tokens) {
      const listed = assets.find((a) => a.chain === row.caip2 && a.kind === "token" && a.identifier === token.address);
      if (token.symbol === "WBTC") { assert.equal(token.listing, "legacy_pinned"); assert.equal(listed, undefined); continue; }
      assert.equal(token.listing, "frozen_list"); assert.equal(listed?.symbol, token.symbol); assert.equal(listed?.decimals, token.decimals);
    }
  }
  const usdt = bridgeTokenRow(1, USDT);
  assert.deepEqual({ decimals: usdt.decimals, approval: usdt.approval, transferFee: usdt.transferFee, peers: usdt.peers, stargate: usdt.stargate },
    { decimals: 6, approval: "zero_first", transferFee: "tether_fee_zero", peers: [], stargate: null });
  assert.equal(usdt.code.upgradeability, "immutable");
  const capabilities = bridgeCapabilities();
  assert.ok(capabilities.chains.every((row) => row.native_coin.bridgeable_principal && row.native_coin.tools.join() === "across"));
});

test("unlisted, unpaired and mixed-kind legs are refused with a named reason", async () => {
  assert.throws(() => bridgeAssetRow(42161, USDT0_ARBITRUM), /asset_not_on_frozen_list/u);
  assert.throws(() => bridgeAssetPair({ fromChainId: 1, toChainId: 42161, fromToken: USDT, toToken: USDC[42161] }), /asset_has_no_listed_peer/u);
  assert.throws(() => bridgeAssetPair({ fromChainId: 1, toChainId: 8453, fromToken: BRIDGE_ZERO_ADDRESS, toToken: USDC[8453] }), /admitted_asset_pair/u);
  assert.throws(() => bridgeAssetPair({ fromChainId: 1, toChainId: 8453, fromToken: USDC[1], toToken: BRIDGE_ZERO_ADDRESS }), /admitted_asset_pair/u);
  assert.throws(() => bridgeTokenRow(1, BRIDGE_ZERO_ADDRESS), /native_sentinel_is_not_a_token/u);
  assert.throws(() => bridgeDeployment(1, 8453, "stargateV2", BRIDGE_ZERO_ADDRESS), /stargate_pool_asset_unreviewed/u);
  assert.throws(() => bridgeDeployment(1, 42161, "across", USDT), /finite_chain/u);
  // The live 1 USDT Ethereum -> Arbitrum quote delivers USDT0, which the frozen list does not name.
  const usdt = (await capture()).usdt["eth-arb"];
  assert.equal(usdt.acrossStep.action.toToken.address, USDT0_ARBITRUM);
  assert.equal(usdt.acrossStep.estimate.approvalReset, true);
  assert.throws(() => validateBridgeRequest({ fromChainId: 1, toChainId: 42161, fromToken: USDT, toToken: USDT0_ARBITRUM,
    amountAtomic: "1000000", recipient: OWNER, minOutputAtomic: "990000", maxNativeDebitWei: "1000000000000000",
    maxRouteFeeAtomic: "10000", slippageBps: 50 }, "APN_INVALID_INPUT"), { code: "APN_INVALID_INPUT", message: /asset_not_on_frozen_list/u });
  // The operator names the native coin as `native`; the provider's zero-address sentinel is never operator input.
  const flags = { "--profile": "p", "--from-chain": "eip155:1", "--to-chain": "eip155:8453", "--to": OWNER, "--amount": "0.001",
    "--min-output": "0.00099", "--max-native-debit-wei": "2000000000000000", "--max-route-fee": "0.00001", "--slippage-bps": "50" };
  const bound = bindBridgeCommand("bridge routes", { ...flags, "--from-token": "native", "--to-token": "native" }) as Json;
  assert.equal(bound.request.fromToken, BRIDGE_ZERO_ADDRESS); assert.equal(bound.request.amountAtomic, ONE_MILLI_ETH);
  assert.throws(() => bindBridgeCommand("bridge routes", { ...flags, "--from-token": BRIDGE_ZERO_ADDRESS, "--to-token": "native" }), /native_leg_is_named_native/u);
});

for (const pair of ["eth-base", "eth-arb"] as const) {
  test(`captured native ${pair} routes: Across decodes exactly as a value transfer and Stargate native is not preparable`, async () => {
    const to = pair === "eth-base" ? 8453 : 42161;
    const { routes, materialization: m, implicitProtocolFeeAtomic } = await nativeRoute(pair);
    assert.deepEqual(routes.map((r) => [r.choice.tool, r.choice.preparable, r.choice.unavailableReason]),
      [["across", true, null], ["stargateV2", false, "asset_tool_unreviewed"]]);
    const d = decodeBridgeCall(m);
    assert.equal(m.transaction.valueAtomic, ONE_MILLI_ETH); assert.equal(d.sourceValueAtomic, ONE_MILLI_ETH);
    assert.equal(d.sourceToken, BRIDGE_ZERO_ADDRESS); assert.equal(d.destinationToken, BRIDGE_ZERO_ADDRESS);
    assert.equal(d.feeAmountAtomic, "2500000000000"); assert.equal(d.bridgeAmountAtomic, "997500000000000");
    assert.equal(d.protocol.kind, "across");
    if (d.protocol.kind === "across") {
      assert.equal(d.protocol.sendingAssetId, word(WETH[1])); assert.equal(d.protocol.receivingAssetId, word(WETH[to]));
      assert.equal(d.protocol.outputAmountAtomic, m.minimumOutputAtomic);
    }
    assert.ok(m.feeCosts.length === 3 && m.feeCosts.every((fee) => fee.included && fee.asset === "native" && fee.chainId === 1));
    assert.equal(BigInt(implicitProtocolFeeAtomic) + m.feeCosts.reduce((s, f) => s + BigInt(f.amountAtomic), 0n) + BigInt(m.quotedOutputAtomic), BigInt(ONE_MILLI_ETH));
    assert.equal(bridgeApprovalRequired(m.request, "0"), false);
  });
}

test("the native decoder accepts only the exact Across native deposit", async () => {
  const { materialization: m } = await nativeRoute("eth-base");
  const refused = (value: BridgeMaterialization) => assert.throws(() => decodeBridgeCall(value), { code: "APN_PROVIDER_PROTOCOL" });
  refused({ ...m, transaction: { ...m.transaction, valueAtomic: "0" } });
  refused({ ...m, transaction: { ...m.transaction, valueAtomic: (BigInt(ONE_MILLI_ETH) - 1n).toString() } });
  refused(mutateData(m, (a) => { a[2].sendingAssetId = word(USDC[1]); }));
  refused(mutateData(m, (a) => { a[2].receivingAssetId = BRIDGE_ZERO_WORD; }));
  refused(mutateData(m, (a) => { a[2].receivingAssetId = word(USDC[8453]); }));
  refused(mutateData(m, (a) => { a[0].sendingAssetId = WETH[1]; }));
  refused(mutateData(m, (a) => { a[1][0].sendingAssetId = WETH[1]; a[1][0].receivingAssetId = WETH[1]; }));
  refused(mutateData(m, (a) => {
    a[1][0].callData = encodeFunctionData({ abi: feeForwarderAbi, functionName: "forwardERC20Fees",
      args: [BRIDGE_ZERO_ADDRESS, [{ recipient: FEE_RECIPIENT, amount: 2_500_000_000_000n }]] });
  }));
  refused(mutateData(m, (a) => {
    a[1][0].callData = encodeFunctionData({ abi: feeForwarderAbi, functionName: "forwardNativeFees", args: [[{ recipient: RELAYER, amount: 2_500_000_000_000n }]] });
  }));
  // A token request can never reuse native calldata, and a native request refuses a token fee row.
  refused({ ...m, request: { ...m.request, fromToken: USDC[1], toToken: USDC[8453] } });
  refused({ ...m, feeCosts: m.feeCosts.map((fee, i) => i === 0 ? { ...fee, asset: BRIDGE_ZERO_ADDRESS } : fee) });
});

test("the provider must state that a native principal skips approval, and never ask for a reset", async () => {
  await assert.rejects(nativeRoute("eth-base", (step) => { delete step.estimate.skipApproval; }), /approval_semantics/u);
  await assert.rejects(nativeRoute("eth-base", (step) => { step.estimate.approvalReset = true; }), /approval_semantics/u);
  await assert.rejects(nativeRoute("eth-base", (step) => { step.transactionRequest.value = "0x0"; }), /native_fee_identity|transaction_envelope/u);
});

test("a native principal freezes one bridge effect: no approval, cap zero, principal outside the fee cap", async () => {
  const { materialization: m } = await nativeRoute("eth-base");
  const rpc = { chainId: 1, origin: "https://rpc-1.example",
    async estimate() { return { gasLimitAtomic: "300000", maxFeePerGasAtomic: "2000000000", maxPriorityFeePerGasAtomic: "1000000000" }; },
    async prices() { throw new Error("a native principal never freezes a provisional bridge"); },
    async feeQuote({ economics }: { economics: { maximumGasCostAtomic: string } }) {
      return { chainId: 1, l1DataFeeUpperWei: "0", operatorFeeUpperWei: "0", maximumExecutionFeeWei: economics.maximumGasCostAtomic,
        totalQuoteWei: economics.maximumGasCostAtomic, totalFeeEnforcedOnchain: false, blockNumberAtomic: "1", blockHash: HASH,
        rpcOrigin: "https://rpc-1.example", observedAt: "2026-09-18T07:34:00.000Z" };
    } } as unknown as BridgeRpcPort;
  const fee = BigInt(m.transaction.gasLimitAtomic) * 3_000_000_000n;
  const account = (native: bigint): BridgeAccountSnapshot => ({ chainId: 1, rpcOrigin: rpc.origin, block: { numberAtomic: "1", hash: HASH, timestampAtomic: "1" },
    owner: OWNER, token: BRIDGE_ZERO_ADDRESS, spender: BRIDGE_DIAMOND, balanceAtomic: native.toString(), nativeBalanceWei: native.toString(),
    allowanceAtomic: "0", latestNonceAtomic: "5", pendingNonceAtomic: "5" });
  const capped = (wei: bigint) => ({ ...m, request: { ...m.request, maxNativeDebitWei: wei.toString() } });
  const effects = await freezeBridgeEnvelopes(capped(fee), account(BigInt(ONE_MILLI_ETH) + fee), rpc);
  assert.deepEqual(effects.map((e) => [e.role, e.valueAtomic, e.provisionalGas, e.economics.nonceAtomic]), [["bridge", ONE_MILLI_ETH, false, "5"]]);
  await assert.rejects(freezeBridgeEnvelopes(capped(fee - 1n), account(BigInt(ONE_MILLI_ETH) + fee), rpc), /aggregate_native_debit/u);
  await assert.rejects(freezeBridgeEnvelopes(capped(fee), account(BigInt(ONE_MILLI_ETH) + fee - 1n), rpc), /aggregate_native_funding/u);
  await assert.rejects(freezeBridgeEnvelopes(capped(fee), account(BigInt(ONE_MILLI_ETH) - 1n), rpc), /source_asset_balance/u);
  assert.throws(() => bridgeApprovalRequired(m.request, "1"), /native_principal_allowance/u);
});

for (const pair of ["eth-base", "eth-arb"] as const) {
  test(`native ${pair} source wrap and destination unwrap are proved by exact logs`, async () => {
    const { materialization: m } = await nativeRoute(pair);
    const d = decodeBridgeCall(m), to = d.destinationChainId as 8453 | 42161;
    const source = sourceLogs(d);
    const proof = bridgeSourceProof(m, d, receipt(1, source));
    assert.equal(proof.correlation.kind, "across");
    for (const logs of [source.filter((l) => l.address !== WETH[1]),
      [...source.filter((l) => l.address !== WETH[1]), eventLog(WETH[1], "Deposit", { dst: SPOKE[1], wad: BigInt(d.bridgeAmountAtomic) - 1n })],
      [...source.filter((l) => l.address !== WETH[1]), eventLog(WETH[1], "Deposit", { dst: RELAYER, wad: BigInt(d.bridgeAmountAtomic) })]]) {
      assert.throws(() => bridgeSourceProof(m, d, receipt(1, logs)), /native_source_wrap/u);
    }
    const fill = fillLog(d, proof.correlation as Json), output = BigInt(d.minimumOutputAtomic);
    const unwrap = (from: Address, amount: bigint) => to === 8453 ? eventLog(WETH[to], "Withdrawal", { src: from, wad: amount })
      : eventLog(WETH[to], "Transfer", { from, to: BRIDGE_ZERO_ADDRESS, value: amount });
    const delivered = bridgeDestinationProof(proof, m, d, receipt(to, [fill, unwrap(SPOKE[to], output)]));
    assert.deepEqual([delivered.token, delivered.recipient, delivered.amountAtomic], [BRIDGE_ZERO_ADDRESS, OWNER, d.minimumOutputAtomic]);
    for (const logs of [[fill], [fill, unwrap(SPOKE[to], output - 1n)], [fill, unwrap(RELAYER, output)],
      [fill, unwrap(SPOKE[to], output), unwrap(SPOKE[to], output)],
      [fill, eventLog(WETH[to], "Transfer", { from: SPOKE[to], to: OWNER, value: output })]]) {
      assert.throws(() => bridgeDestinationProof(proof, m, d, receipt(to, logs)), /native_destination_unwrap/u);
    }
  });
}

function sourceLogs(d: DecodedBridgeCall): BridgeLog[] {
  if (d.protocol.kind !== "across") throw new Error("across only");
  return [
    eventLog(FEE_FORWARDER, "FeesForwarded", { token: BRIDGE_ZERO_ADDRESS, distributions: [{ recipient: FEE_RECIPIENT, amount: BigInt(d.feeAmountAtomic) }] }),
    eventLog(WETH[1], "Deposit", { dst: SPOKE[1], wad: BigInt(d.bridgeAmountAtomic) }),
    eventLog(SPOKE[1], "FundsDeposited", { inputToken: d.protocol.sendingAssetId, outputToken: d.protocol.receivingAssetId,
      inputAmount: BigInt(d.bridgeAmountAtomic), outputAmount: BigInt(d.protocol.outputAmountAtomic), destinationChainId: BigInt(d.destinationChainId),
      depositId: 77n, quoteTimestamp: Number(d.protocol.quoteTimestamp), fillDeadline: Number(d.protocol.fillDeadline), exclusivityDeadline: 0,
      depositor: d.protocol.refundAddress, recipient: d.protocol.receiverAddress, exclusiveRelayer: d.protocol.exclusiveRelayer, message: "0x" }),
    eventLog(BRIDGE_DIAMOND, "LiFiTransferStarted", { bridgeData: { transactionId: d.transactionId, bridge: "across", integrator: "lifi-api",
      referrer: BRIDGE_ZERO_ADDRESS, sendingAssetId: BRIDGE_ZERO_ADDRESS, receiver: d.recipient, minAmount: BigInt(d.bridgeAmountAtomic),
      destinationChainId: BigInt(d.destinationChainId), hasSourceSwaps: true, hasDestinationCall: false } }),
  ];
}
function fillLog(d: DecodedBridgeCall, c: Json): BridgeLog {
  return eventLog(SPOKE[d.destinationChainId as 8453 | 42161], "FilledRelay", { inputToken: c.inputToken, outputToken: c.outputToken,
    inputAmount: BigInt(c.inputAmountAtomic), outputAmount: BigInt(c.outputAmountAtomic), repaymentChainId: 1n, originChainId: 1n,
    depositId: BigInt(c.depositId), fillDeadline: Number(c.fillDeadline), exclusivityDeadline: 0, exclusiveRelayer: c.exclusiveRelayer,
    relayer: word(RELAYER), depositor: c.depositor, recipient: c.recipient, messageHash: BRIDGE_ZERO_WORD,
    relayExecutionInfo: { updatedRecipient: c.recipient, updatedMessageHash: BRIDGE_ZERO_WORD, updatedOutputAmount: BigInt(c.outputAmountAtomic), fillType: 0 } });
}
function receipt(chainId: 1 | 8453 | 42161, logs: readonly BridgeLog[]): BridgeProtocolReceipt {
  return { chainId, transactionHash: `0x${"12".repeat(32)}` as Hex, blockNumberAtomic: "123", blockHash: HASH, logs };
}
function eventLog(address: Address, eventName: string, args: Json): BridgeLog {
  const item = getAbiItem({ abi: bridgeEventsAbi as any, name: eventName as any }) as any;
  const inputs = item.inputs as readonly (AbiParameter & { indexed?: boolean })[];
  const topics = encodeEventTopics({ abi: [item] as any, eventName: eventName as never, args: args as never } as never) as readonly Hex[];
  const plain = inputs.filter((x) => !x.indexed) as readonly AbiParameter[];
  const log = { address, topics, data: encodeAbiParameters(plain, inputs.filter((x) => !x.indexed).map((x) => args[x.name!]) as never) };
  decodeEventLog({ abi: bridgeEventsAbi, eventName: eventName as never, data: log.data, topics: log.topics as [Hex, ...Hex[]], strict: true });
  return log;
}
