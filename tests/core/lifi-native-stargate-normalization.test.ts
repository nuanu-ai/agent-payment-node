import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeFunctionData, encodeFunctionData, getAddress } from "viem";
import { EVENT_TOPICS, feeForwarderAbi, FEE_RECIPIENT, stargateBridgeAbi } from "../../src/lifi/abi.js";
import { BRIDGE_ASSET_REGISTRY } from "../../src/lifi/asset-registry.js";
import { decodeBridgeCall } from "../../src/lifi/decode.js";
import type { BridgeMaterialization, BridgeProtocolReceipt, BridgeSourceProof } from "../../src/lifi/model.js";
import { bridgeDestinationProof, bridgeSourceProof, type NativeStargateDestinationPin } from "../../src/lifi/protocol-evidence.js";
import { parseReceiptLogs } from "../../src/lifi/rpc-proof-codec.js";
import { materializeBridgeRoute, parseBridgeRoutes } from "../../src/lifi/routes.js";
import { BRIDGE_DIAMOND, BRIDGE_ZERO_WORD } from "../../src/lifi/validation.js";
import { eventLog, mutateEvent } from "./lifi-event-fixtures.js";

const captured = JSON.parse(readFileSync(new URL("../../../tests/core/lifi-fixtures/native-stargate-paid-source-20261007.json", import.meta.url), "utf8"));
const selected = parseBridgeRoutes(captured.quoteResponse, captured.request, captured.sender).find(row => row.choice.routeId === "658caddf-d3b2-4a90-9f81-97b718e55b8b")!;
const m = materializeBridgeRoute(selected, captured.stepResponse, captured.request, captured.sender).materialization;
const d = decodeBridgeCall(m), raw = captured.sourceReceipt;
const block = { numberAtomic: BigInt(raw.blockNumber).toString(), hash: raw.blockHash, timestampAtomic: BigInt(raw.logs[0].blockTimestamp).toString() };
const receipt: BridgeProtocolReceipt = { chainId: 1, transactionHash: raw.transactionHash, blockNumberAtomic: block.numberAtomic,
  blockHash: block.hash, logs: parseReceiptLogs(raw.logs, raw.transactionHash, block, BigInt(raw.transactionIndex)) };
const pool = BRIDGE_ASSET_REGISTRY[1].nativeCoin.stargate!.router;
const sentIndex = receipt.logs.findIndex(log => log.address === pool);
const sent = receipt.logs[sentIndex]!;
const actual = 99000000000000n;
const guid = "0xdff1500dee8e9be8adb5eb00c60c3cb42f76fc1dd90233d708778480816f3afa" as const;
const basePool = BRIDGE_ASSET_REGISTRY[8453].nativeCoin.stargate!.router;
const received = eventLog(basePool, "OFTReceived", { guid, srcEid: 30101, toAddress: d.recipient, amountReceivedLD: 98000000000000n });
// Synthetic destination evidence exercises continuation validation; the retained fixture proves source only.
const destination: BridgeProtocolReceipt = { chainId: 8453, transactionHash: `0x${"33".repeat(32)}`,
  blockNumberAtomic: "123", blockHash: `0x${"44".repeat(32)}`, logs: [received] };
const deployment = { chainId: 8453, peerChainId: 1, tool: "stargateV2", block: {
  numberAtomic: destination.blockNumberAtomic, hash: destination.blockHash, timestampAtomic: "2" }, rpcOrigin: "https://offline.example",
  contractHash: "a".repeat(64), codeHash: "b".repeat(64), configurationHash: "c".repeat(64) } as const;
const pin: NativeStargateDestinationPin = { pool: basePool, frozenDeployment: deployment, observedDeployment: deployment,
  frozenPoolCodeHash: BRIDGE_ASSET_REGISTRY[8453].nativeCoin.stargate!.routerCodeHash,
  observedPoolCodeHash: BRIDGE_ASSET_REGISTRY[8453].nativeCoin.stargate!.routerCodeHash };
function source(replacement = sent, materialization = m): BridgeSourceProof {
  return bridgeSourceProof(materialization, decodeBridgeCall(materialization), { ...receipt,
    logs: receipt.logs.map((log, index) => index === sentIndex ? replacement : log) });
}
function continuation(proof: BridgeSourceProof, result = destination) { return bridgeDestinationProof(proof, m, d, result, pin); }

test("retained successful paid source preserves frozen amount and resumes stored correlation into destination proof", () => {
  assert.equal(raw.status, "0x1");
  assert.deepEqual(d, captured.frozenDecoded);
  const proof = source();
  assert.equal(proof.transactionHash, captured.provenance.sourceTransactionHash);
  assert.equal(proof.bridgeAmountAtomic, "99750000000000");
  assert.equal(proof.correlation.kind, "stargateV2");
  if (proof.correlation.kind !== "stargateV2") throw Error("unexpected correlation");
  assert.equal(proof.correlation.amountSentAtomic, actual.toString());
  assert.equal(proof.correlation.amountReceivedAtomic, "98000000000000");
  assert.equal(proof.correlation.guid, guid);
  // JSON round trip represents the persisted correlation used by recovery, not an ephemeral decoder value.
  assert.equal(continuation(JSON.parse(JSON.stringify(proof))).amountAtomic, "98000000000000");
});

test("paid source rejects any sent amount other than the exact pinned shared-decimal normalization", () => {
  for (const amountSentLD of [actual - 1n, actual + 1n, 99750000000000n, actual - 1000000000000n]) {
    assert.throws(() => source(mutateEvent(sent, "OFTSent", { amountSentLD })), { code: "APN_RPC_PROTOCOL" });
  }
  // Adjust the unsigned fixture's fee split to make its raw bridge amount exactly shared-unit aligned.
  const call = decodeFunctionData({ abi: stargateBridgeAbi, data: m.transaction.data });
  const args = structuredClone(call.args) as any;
  const alignedFee = 1000000000000n;
  args[0].minAmount = actual;
  args[1][0].callData = encodeFunctionData({ abi: feeForwarderAbi, functionName: "forwardNativeFees",
    args: [[{ recipient: FEE_RECIPIENT, amount: alignedFee }]] });
  args[2].sendParams.amountLD = actual;
  const aligned: BridgeMaterialization = { ...m, feeCosts: m.feeCosts.map(row => row.included ?
    { ...row, amountAtomic: alignedFee.toString() } : row), transaction: { ...m.transaction,
    data: encodeFunctionData({ abi: stargateBridgeAbi, functionName: "swapAndStartBridgeTokensViaStargate", args }) } };
  const logs = receipt.logs.map(log => log.topics[0] === EVENT_TOPICS.lifiTransferStarted ?
    mutateEvent(log, "LiFiTransferStarted", { bridgeData: { ...args[0], minAmount: actual } }) :
    log.topics[0] === EVENT_TOPICS.feesForwarded ? mutateEvent(log, "FeesForwarded", {
      distributions: [{ recipient: FEE_RECIPIENT, amount: alignedFee }] }) : log);
  const exact = bridgeSourceProof(aligned, decodeBridgeCall(aligned), { ...receipt, logs });
  assert.equal(exact.bridgeAmountAtomic, actual.toString());
  assert.equal(exact.correlation.kind === "stargateV2" && exact.correlation.amountSentAtomic, actual.toString());

});

test("paid source keeps canonical pool, unique event, GUID, destination EID, diamond and minimum guards", () => {
  for (const change of [{ guid: BRIDGE_ZERO_WORD }, { dstEid: 30110 }, { fromAddress: d.sender },
    { amountReceivedLD: 97509999999999n }]) {
    assert.throws(() => source(mutateEvent(sent, "OFTSent", change)), { code: "APN_RPC_PROTOCOL" });
  }
  assert.throws(() => source({ ...sent, address: getAddress("0xc026395860Db2d07ee33e05fE50ed7bD583189C7") }), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => bridgeSourceProof(m, d, { ...receipt, logs: [...receipt.logs, sent] }), { code: "APN_RPC_PROTOCOL" });
});

test("stored paid source correlation and destination tuple reject altered identities and amounts", () => {
  const proof = source();
  for (const change of [{ amountSentAtomic: "99750000000000" }, { amountSentAtomic: (actual - 1n).toString() },
    { amountSentAtomic: (actual + 1n).toString() }, { sender: BRIDGE_DIAMOND }, { recipient: d.sender },
    { destinationEid: 30110 }, { sourceEid: 30110 }, { guid: BRIDGE_ZERO_WORD }, { amountReceivedAtomic: "97509999999999" }]) {
    assert.throws(() => continuation({ ...proof, correlation: { ...proof.correlation, ...change } as typeof proof.correlation }), { code: "APN_RPC_PROTOCOL" });
  }
  for (const change of [{ guid: `0x${"66".repeat(32)}` }, { srcEid: 30110 }, { toAddress: d.sender },
    { amountReceivedLD: 97999999999999n }, { amountReceivedLD: 97509999999999n }]) {
    assert.throws(() => continuation(proof, { ...destination, logs: [mutateEvent(received, "OFTReceived", change)] }), { code: "APN_RPC_PROTOCOL" });
  }
  const otherGuid = `0x${"66".repeat(32)}` as const;
  const otherSource = source(mutateEvent(sent, "OFTSent", { guid: otherGuid }));
  // GUID belongs to the canonical source event; continuation requires that same event-derived GUID.
  assert.throws(() => continuation(otherSource), { code: "APN_RPC_PROTOCOL" });
  assert.equal(continuation(otherSource, { ...destination,
    logs: [mutateEvent(received, "OFTReceived", { guid: otherGuid })] }).amountAtomic, "98000000000000");
});

test("pinned native precision fails closed on invalid ordering and zero normalization", () => {
  const asset = BRIDGE_ASSET_REGISTRY[1].nativeCoin.stargate! as { sharedDecimals: number };
  const original = asset.sharedDecimals;
  try {
    for (const sharedDecimals of [-1, 19, 0, NaN, Infinity, 6.5]) {
      asset.sharedDecimals = sharedDecimals;
      assert.throws(() => source(), { code: "APN_RPC_PROTOCOL" });
      // Stored-correlation continuation must use the same precision validation.
      asset.sharedDecimals = original;
      const proof = source();
      asset.sharedDecimals = sharedDecimals;
      assert.throws(() => continuation(proof), { code: "APN_RPC_PROTOCOL" });
    }
  } finally { asset.sharedDecimals = original; }
});
