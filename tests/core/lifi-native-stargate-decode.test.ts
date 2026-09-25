import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeFunctionData, getAddress, toFunctionSelector } from "viem";
import { FEE_FORWARDER, FEE_RECIPIENT, STARGATE_SELECTOR, feeForwarderAbi, stargateBridgeAbi } from "../../src/lifi/abi.js";
import { bridgeAssetRow, bridgeAssetTool } from "../../src/lifi/asset-registry.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDestinationProof, bridgeSourceProof, type NativeStargateDestinationPin } from "../../src/lifi/protocol-evidence.js";
import { freezeBridgeEnvelopes } from "../../src/lifi/economics.js";
import type { BridgeAccountSnapshot, BridgeMaterialization, BridgeProtocolReceipt } from "../../src/lifi/model.js";
import type { BridgeRpcPort } from "../../src/lifi/ports.js";
import { validateRouteEconomics } from "../../src/lifi/routes.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import { eventLog, mutateEvent } from "./lifi-event-fixtures.js";

const OWNER = "0x1111111111111111111111111111111111111111";
const SOURCE = 200000000000000n;
const FIXED_FEE = 500000000000n;
const LZ_FEE = 191951159457037n;
const BRIDGED = SOURCE - FIXED_FEE;
const VALUE = SOURCE + LZ_FEE;
const NATIVE_POOL = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
const BASE_NATIVE_POOL = getAddress("0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7");
const GUID = `0x${"12".repeat(32)}` as const;

// Derived from the captured 2026-09-24 unsigned Ethereum -> Base LI.FI step. Identity fields are synthetic;
// the selector, ABI layout, asset ID, amounts, fee split, and 1508-byte encoding match the captured shape.
function fixture(options: { assetId?: number; nativeFee?: bigint; forwardedFee?: bigint; value?: bigint;
  cap?: bigint; feeRow?: bigint; destination?: 8453 | 42161 } = {}): BridgeMaterialization {
  const forwarded = options.forwardedFee ?? FIXED_FEE;
  const feeCall = encodeFunctionData({ abi: feeForwarderAbi, functionName: "forwardNativeFees",
    args: [[{ recipient: FEE_RECIPIENT, amount: forwarded }]] });
  const data = encodeFunctionData({ abi: stargateBridgeAbi, functionName: "swapAndStartBridgeTokensViaStargate",
    args: [{ transactionId: `0x${"ab".repeat(32)}`, bridge: "stargateV2", integrator: "lifi-api",
      referrer: BRIDGE_ZERO_ADDRESS, sendingAssetId: BRIDGE_ZERO_ADDRESS, receiver: OWNER,
      minAmount: BRIDGED, destinationChainId: BigInt(options.destination ?? 8453), hasSourceSwaps: true, hasDestinationCall: false },
    [{ callTo: FEE_FORWARDER, approveTo: FEE_FORWARDER, sendingAssetId: BRIDGE_ZERO_ADDRESS,
      receivingAssetId: BRIDGE_ZERO_ADDRESS, fromAmount: SOURCE, callData: feeCall, requiresDeposit: true }],
    { assetId: options.assetId ?? 13, sendParams: { dstEid: 30184,
      to: `0x${"0".repeat(24)}${OWNER.slice(2)}`, amountLD: BRIDGED, minAmountLD: 197010000000000n,
      extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" },
      fee: { nativeFee: options.nativeFee ?? LZ_FEE, lzTokenFee: 0n }, refundAddress: OWNER }] as never });
  return {
    routeId: "synthetic-route", stepId: "synthetic-step", tool: "stargateV2", sender: OWNER,
    request: { fromChainId: 1, toChainId: options.destination ?? 8453, fromToken: BRIDGE_ZERO_ADDRESS,
      toToken: BRIDGE_ZERO_ADDRESS, recipient: OWNER, amountAtomic: SOURCE.toString(),
      minOutputAtomic: "100000000000000", maxNativeDebitWei: (options.cap ?? SOURCE).toString(),
      maxRouteFeeAtomic: "100000000000000", slippageBps: 50 },
    approvalAddress: BRIDGE_DIAMOND, quotedOutputAtomic: "198000000000000", minimumOutputAtomic: "197010000000000",
    feeCosts: [
      { name: "LIFI Fixed Fee", chainId: 1, asset: "native", amountAtomic: FIXED_FEE.toString(), included: true },
      { name: "LayerZero native fee", chainId: 1, asset: "native", amountAtomic: (options.feeRow ?? LZ_FEE).toString(), included: false },
    ], includedStepIdentities: [],
    transaction: { chainId: 1, from: OWNER, to: BRIDGE_DIAMOND, data,
      valueAtomic: (options.value ?? VALUE).toString(), gasLimitAtomic: "1030900" },
    requestHash: "", responseHash: "", routeHash: "", stepHash: "", materializedStepHash: "", transactionDigest: "",
  } as BridgeMaterialization;
}

test("captured native Stargate ABI shape decodes principal and separate LayerZero fee offline", () => {
  const m = fixture();
  assert.equal(toFunctionSelector(stargateBridgeAbi[0]!), STARGATE_SELECTOR);
  assert.equal((m.transaction.data.length - 2) / 2, 1508);
  const decoded = decodeBridgeCall(m);
  assert.equal(decoded.selector, STARGATE_SELECTOR);
  assert.equal(decoded.bridgeAmountAtomic, BRIDGED.toString());
  assert.equal(decoded.feeAmountAtomic, FIXED_FEE.toString());
  assert.equal(decoded.sourceValueAtomic, VALUE.toString());
  assert.equal(decoded.protocol.kind, "stargateV2");
  if (decoded.protocol.kind !== "stargateV2") throw new Error("unreachable");
  assert.equal(decoded.protocol.assetId, 13);
  assert.equal(decoded.protocol.nativeFee, LZ_FEE.toString());
  assert.equal(validateRouteEconomics(m), "1500000000000");
  assert.equal(bridgeAssetTool(bridgeAssetRow(1, BRIDGE_ZERO_ADDRESS), "stargateV2")?.assetId, 13);
});

test("native Stargate fails closed on debit cap, asset ID and both fee bindings", () => {
  for (const bad of [
    fixture({ cap: LZ_FEE - 1n }), fixture({ value: SOURCE }), fixture({ value: VALUE + 1n }),
    fixture({ assetId: 1 }), fixture({ nativeFee: LZ_FEE + 1n }),
    fixture({ forwardedFee: FIXED_FEE + 1n }), fixture({ feeRow: LZ_FEE + 1n }),
    fixture({ destination: 42161 }),
  ]) assert.throws(() => decodeBridgeCall(bad), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => validateRouteEconomics(fixture({ feeRow: LZ_FEE + 1n })), { code: "APN_PROVIDER_PROTOCOL" });
});

function sourceReceipt(m: BridgeMaterialization): BridgeProtocolReceipt {
  const d = decodeBridgeCall(m);
  return { chainId: 1, transactionHash: `0x${"11".repeat(32)}`,
    blockNumberAtomic: "123", blockHash: `0x${"22".repeat(32)}`, logs: [
      eventLog(BRIDGE_DIAMOND, "LiFiTransferStarted", { bridgeData: {
        transactionId: d.transactionId, bridge: d.bridgeName, integrator: d.integrator, referrer: d.referrer,
        sendingAssetId: d.sourceToken, receiver: d.recipient, minAmount: BigInt(d.bridgeAmountAtomic),
        destinationChainId: BigInt(d.destinationChainId), hasSourceSwaps: true, hasDestinationCall: false } }),
      eventLog(FEE_FORWARDER, "FeesForwarded", { token: BRIDGE_ZERO_ADDRESS,
        distributions: [{ recipient: FEE_RECIPIENT, amount: FIXED_FEE }] }),
      eventLog(NATIVE_POOL, "OFTSent", { guid: GUID, dstEid: 30184, fromAddress: BRIDGE_DIAMOND,
        amountSentLD: BRIDGED, amountReceivedLD: 197010000000000n }),
    ] };
}

test("native Stargate source accepts the exact pool OFTSent without Across wrap or ERC20 transfers", () => {
  const official = JSON.parse(readFileSync(new URL("../../../data/stargate/2026-09-20/official-registry-and-abi.json", import.meta.url), "utf8"));
  assert.equal(official.sources[0].commit, "ce598b8d16472cd76ee47d30b8a40bc5c1b667bb");
  assert.equal(official.deployments.find((row: { chainId: number; asset: string }) => row.chainId === 1 && row.asset === "ETH").pool, NATIVE_POOL);
  const m = fixture(), d = decodeBridgeCall(m), receipt = sourceReceipt(m);
  const proof = bridgeSourceProof(m, d, receipt);
  assert.equal(proof.correlation.kind, "stargateV2");
  assert.equal(proof.correlation.guid, GUID);
  assert.equal(proof.correlation.sourceEid, 30101);
  assert.equal(proof.correlation.destinationEid, 30184);
  assert.equal(proof.correlation.recipient, OWNER);
  assert.equal(proof.bridgeAmountAtomic, BRIDGED.toString());
  assert.equal(d.sourceValueAtomic, (SOURCE + LZ_FEE).toString());
});

test("native Stargate source rejects wrong pool, GUID, EID, amount, sender, and duplicate events", () => {
  const m = fixture(), d = decodeBridgeCall(m), good = sourceReceipt(m), sent = good.logs[2]!;
  const invalid = [
    [{ ...sent, address: getAddress("0xc026395860Db2d07ee33e05fE50ed7bD583189C7") }],
    [mutateEvent(sent, "OFTSent", { guid: `0x${"00".repeat(32)}` })],
    [mutateEvent(sent, "OFTSent", { dstEid: 30110 })],
    [mutateEvent(sent, "OFTSent", { amountSentLD: BRIDGED - 1n })],
    [mutateEvent(sent, "OFTSent", { amountReceivedLD: 197009999999999n })],
    [mutateEvent(sent, "OFTSent", { fromAddress: OWNER })],
    [sent, sent],
  ];
  for (const replacement of invalid) assert.throws(() => bridgeSourceProof(m, d, { ...good,
    logs: [...good.logs.slice(0, 2), ...replacement] }), { code: "APN_RPC_PROTOCOL" });
});

test("native Stargate source rejects fee and msg.value mismatches and cannot use an Across receipt", () => {
  const m = fixture(), d = decodeBridgeCall(m), good = sourceReceipt(m);
  assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: [good.logs[0]!,
    mutateEvent(good.logs[1]!, "FeesForwarded", { distributions: [{ recipient: FEE_RECIPIENT, amount: FIXED_FEE + 1n }] }),
    good.logs[2]!] }), { code: "APN_RPC_PROTOCOL" });
  for (const bad of [fixture({ value: VALUE + 1n }), fixture({ nativeFee: LZ_FEE + 1n }), fixture({ feeRow: LZ_FEE + 1n })]) {
    assert.throws(() => bridgeSourceProof(bad, d, good));
  }
  assert.throws(() => bridgeSourceProof(m, d, { ...good, logs: good.logs.slice(0, 2) }),
    { code: "APN_RPC_PROTOCOL" });
});

test("native Stargate destination binds pinned Base pool, GUID, EIDs, recipient, amount and native delivery", () => {
  const m = fixture(), d = decodeBridgeCall(m), source = bridgeSourceProof(m, d, sourceReceipt(m));
  const amount = source.correlation.kind === "stargateV2" ? source.correlation.amountReceivedAtomic : "0";
  const received = eventLog(BASE_NATIVE_POOL, "OFTReceived", { guid: GUID, srcEid: 30101,
    toAddress: OWNER, amountReceivedLD: BigInt(amount) });
  const result: BridgeProtocolReceipt = { chainId: 8453, transactionHash: `0x${"33".repeat(32)}`,
    blockNumberAtomic: "123", blockHash: `0x${"44".repeat(32)}`, logs: [received],
    nativeTransfer: { transactionHash: `0x${"33".repeat(32)}`, from: BASE_NATIVE_POOL,
      to: OWNER, valueAtomic: amount, traceHash: "a".repeat(64) },
    nativeBalance: { recipient: OWNER,
      beforeBlock: { numberAtomic: "122", hash: `0x${"55".repeat(32)}`, timestampAtomic: "1" },
      afterBlock: { numberAtomic: "123", hash: `0x${"44".repeat(32)}`, timestampAtomic: "2" },
      beforeBalanceAtomic: "100", afterBalanceAtomic: (100n + BigInt(amount)).toString(), deltaAtomic: amount } };
  const observedDeployment = { chainId: 8453, peerChainId: 1, tool: "stargateV2",
    block: result.nativeBalance!.afterBlock, rpcOrigin: "https://offline.example",
    contractHash: "a".repeat(64), codeHash: "b".repeat(64), configurationHash: "c".repeat(64) } as const;
  const pin: NativeStargateDestinationPin = { pool: BASE_NATIVE_POOL,
    frozenDeployment: observedDeployment, observedDeployment,
    frozenPoolCodeHash: `0x${"dd".repeat(32)}`, observedPoolCodeHash: `0x${"dd".repeat(32)}` };
  const prove = (receipt: BridgeProtocolReceipt, deployment = pin) => bridgeDestinationProof(source, m, d, receipt, deployment);
  const proof = prove(result);
  assert.equal(proof.amountAtomic, amount);
  assert.equal(proof.nativeTransfer?.from, BASE_NATIVE_POOL);
  assert.equal(proof.nativeBalance?.deltaAtomic, amount);
  // A recipient can spend in the same block. Neither tracing nor a positive block delta is required.
  const noCorroboration = prove({ ...result, nativeTransfer: null, nativeBalance: null });
  assert.equal(noCorroboration.amountAtomic, amount);
  assert.equal(noCorroboration.nativeTransfer, null);
  assert.equal(noCorroboration.nativeBalance, null);
  const spentSameBlock = prove({ ...result, nativeTransfer: null, nativeBalance: {
    ...result.nativeBalance!, afterBalanceAtomic: "100", deltaAtomic: "0" } });
  assert.equal(spentSameBlock.amountAtomic, amount);
  assert.equal(spentSameBlock.nativeBalance?.deltaAtomic, "0");
  const netNegative = prove({ ...result, nativeTransfer: null, nativeBalance: {
    ...result.nativeBalance!, beforeBalanceAtomic: "200", afterBalanceAtomic: "100", deltaAtomic: "-100" } });
  assert.equal(netNegative.amountAtomic, amount);
  assert.equal(netNegative.nativeBalance, null);
  assert.throws(() => bridgeDestinationProof(source, m, d, result), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove(result, { ...pin, pool: NATIVE_POOL }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove(result, { ...pin, observedPoolCodeHash: `0x${"ee".repeat(32)}` }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove(result, { ...pin, observedDeployment: { ...observedDeployment,
    configurationHash: "e".repeat(64) } }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove(result, { ...pin, observedDeployment: { ...observedDeployment,
    block: { ...observedDeployment.block, hash: `0x${"ee".repeat(32)}` } } }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove({ ...result, logs: [{ ...received, address: NATIVE_POOL }] }), { code: "APN_RPC_PROTOCOL" });
  for (const change of [{ guid: `0x${"66".repeat(32)}` }, { srcEid: 30110 }, { toAddress: NATIVE_POOL },
    { amountReceivedLD: BigInt(amount) - 1n }]) {
    assert.throws(() => prove({ ...result, logs: [mutateEvent(received, "OFTReceived", change)] }), { code: "APN_RPC_PROTOCOL" });
  }
  const cached = eventLog(BASE_NATIVE_POOL, "UnreceivedTokenCached", { guid: GUID, index: 0, srcEid: 30101,
    receiver: OWNER, amountLD: BigInt(amount), composeMsg: "0x" });
  assert.throws(() => prove({ ...result, logs: [cached] }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove({ ...result, logs: [cached, received] }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove({ ...result, logs: [received, received] }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove({ ...result, nativeTransfer: { ...result.nativeTransfer!, valueAtomic: "1" } }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => prove({ ...result, nativeBalance: { ...result.nativeBalance!, deltaAtomic: "1" } }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => bridgeDestinationProof({ ...source, correlation: { ...source.correlation,
    destinationEid: 30110 } as typeof source.correlation }, m, d, result, pin), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => bridgeDestinationProof({ ...source, correlation: { ...source.correlation,
    sender: NATIVE_POOL } as typeof source.correlation }, m, d, result, pin), { code: "APN_RPC_PROTOCOL" });
});

test("native Stargate fee cap excludes principal but aggregate gas plus LayerZero fee remains bounded", async () => {
  const m = fixture();
  const origin = "https://rpc.example";
  const blockHash = `0x${"ab".repeat(32)}`;
  const rpc = { chainId: 1, origin,
    async estimate() { return { gasLimitAtomic: m.transaction.gasLimitAtomic,
      maxFeePerGasAtomic: "1000000", maxPriorityFeePerGasAtomic: "500000" }; },
    async prices() { throw new Error("native principal requires no approval"); },
    async feeQuote({ economics }: { economics: { maximumGasCostAtomic: string } }) {
      return { chainId: 1, l1DataFeeUpperWei: "0", operatorFeeUpperWei: "0", maximumExecutionFeeWei: economics.maximumGasCostAtomic,
        totalQuoteWei: economics.maximumGasCostAtomic, totalFeeEnforcedOnchain: false, blockNumberAtomic: "1", blockHash,
        rpcOrigin: origin, observedAt: "2026-09-24T00:00:00.000Z" };
    } } as unknown as BridgeRpcPort;
  const balance = 600000000000000n;
  const account = { chainId: 1, rpcOrigin: origin, block: { numberAtomic: "1", hash: blockHash, timestampAtomic: "1" },
    owner: OWNER, token: BRIDGE_ZERO_ADDRESS, spender: BRIDGE_DIAMOND, balanceAtomic: balance.toString(), nativeBalanceWei: balance.toString(),
    allowanceAtomic: "0", latestNonceAtomic: "5", pendingNonceAtomic: "5" } as BridgeAccountSnapshot;
  const gasFee = BigInt(m.transaction.gasLimitAtomic) * 1500000n;
  const effects = await freezeBridgeEnvelopes(m, account, rpc);
  assert.deepEqual(effects.map((effect) => [effect.role, effect.valueAtomic]), [["bridge", VALUE.toString()]]);
  assert.equal(effects[0]!.feeQuote.totalQuoteWei, gasFee.toString());
  await assert.rejects(freezeBridgeEnvelopes({ ...m, request: { ...m.request,
    maxNativeDebitWei: (LZ_FEE + gasFee - 1n).toString() } }, account, rpc),
  (error: any) => error.code === "APN_FEE_BUDGET_EXCEEDED" && error.details.reason === "aggregate_native_debit");
});
