import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeFunctionData } from "viem";
import { deploymentAbi, FEE_FORWARDER, FEE_FORWARDER_SELECTOR, FEE_FORWARDER_V2_0, RECORDED_FEE_FORWARDERS } from "../../src/lifi/abi.js";
import { bridgeFeeForwarder, decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDeploymentCheck } from "../../src/lifi/deployment-check.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import type { BridgeMaterialization, BridgeProtocolReceipt } from "../../src/lifi/model.js";
import { bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { parseReceiptLogs } from "../../src/lifi/rpc-proof-codec.js";
import { materializeBridgeRoute, parseBridgeRoutes } from "../../src/lifi/routes.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import { feeForwarderV20Materialization, readdressFeeForwarder } from "./lifi-capture.js";

// The paid Ethereum -> Base native Stargate source of 2026-10-07: its call and its receipt name FeeForwarder v2.0.0.
const captured = JSON.parse(readFileSync(new URL("../../../tests/core/lifi-fixtures/native-stargate-paid-source-20261007.json", import.meta.url), "utf8"));
const ROUTE = "658caddf-d3b2-4a90-9f81-97b718e55b8b";
function materialize(capture: typeof captured): BridgeMaterialization {
  const selected = parseBridgeRoutes(capture.quoteResponse, capture.request, capture.sender).find(row => row.choice.routeId === ROUTE)!;
  return materializeBridgeRoute(selected, capture.stepResponse, capture.request, capture.sender).materialization;
}
const fresh = materialize(JSON.parse(readdressFeeForwarder(JSON.stringify(captured))));
const stored = feeForwarderV20Materialization(fresh);
const raw = captured.sourceReceipt;
const block = { numberAtomic: BigInt(raw.blockNumber).toString(), hash: raw.blockHash, timestampAtomic: BigInt(raw.logs[0].blockTimestamp).toString() };
const receipt: BridgeProtocolReceipt = { chainId: 1, transactionHash: raw.transactionHash, blockNumberAtomic: block.numberAtomic,
  blockHash: block.hash, logs: parseReceiptLogs(raw.logs, raw.transactionHash, block, BigInt(raw.transactionIndex)) };
const word = (address: string) => address.slice(2).toLowerCase();
function withForwarders(m: BridgeMaterialization, callTo: string, approveTo: string): BridgeMaterialization {
  const [head, middle, tail] = m.transaction.data.split(word(FEE_FORWARDER));
  return { ...m, transaction: { ...m.transaction, data: `${head}${word(callTo)}${middle}${word(approveTo)}${tail}` as BridgeMaterialization["transaction"]["data"] } };
}

test("the current FeeForwarder is v2.1.0: the source check reads its Diamond allowlisting and the pins hold its code", () => {
  assert.equal(FEE_FORWARDER, "0xDe2b920506EE931a6A2ABDF566526220214FBbAE");
  assert.deepEqual(RECORDED_FEE_FORWARDERS, [FEE_FORWARDER, FEE_FORWARDER_V2_0]);
  for (const chainId of [1, 8453, 42161] as const) {
    const peer = chainId === 1 ? 42161 : 1, token = chainId === 1 ? "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" : chainId === 8453
      ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
    const d = bridgeDeployment(chainId, peer, "across", token);
    assert.equal(d.feeForwarder, FEE_FORWARDER);
    assert.deepEqual(d.code.find(row => row.address === FEE_FORWARDER),
      { address: FEE_FORWARDER, codeHash: "0x99a76627aece8903612e0246c10f13a46e511a0a074d9a4e68987a28c78ebd52" });
    const allowlisted: string = encodeFunctionData({ abi: deploymentAbi, functionName: "isContractSelectorWhitelisted",
      args: [FEE_FORWARDER, FEE_FORWARDER_SELECTOR] as const });
    const check = bridgeDeploymentCheck(chainId, peer, "across", token, "source");
    assert.equal(check.reads.filter(row => row.address === BRIDGE_DIAMOND && row.data === allowlisted && row.expected === `0x${"0".repeat(63)}1`).length, 1);
    assert.equal(check.reads.some(row => row.address === FEE_FORWARDER || row.data.includes(word(FEE_FORWARDER_V2_0))), false);
    assert.equal(d.code.some(row => row.address === FEE_FORWARDER_V2_0) || d.reads.some(row => row.data.includes(word(FEE_FORWARDER_V2_0))), false);
  }
});

test("a fresh route through the replaced FeeForwarder is refused at materialization, before any read or effect", () => {
  assert.throws(() => materialize(captured), { code: "APN_PROVIDER_PROTOCOL", message: /fee_forwarder_retired/u });
  assert.equal(bridgeFeeForwarder(fresh), FEE_FORWARDER);
});

test("a record prepared through v2.0.0 still decodes to its frozen call and names v2.0.0", () => {
  assert.equal(bridgeFeeForwarder(stored), FEE_FORWARDER_V2_0);
  assert.deepEqual(decodeBridgeCall(stored), captured.frozenDecoded);
  // The fee step's call is the same through either FeeForwarder: only the call's data hash differs.
  const { dataHash: _current, ...currentCall } = decodeBridgeCall(fresh), { dataHash: _stored, ...storedCall } = decodeBridgeCall(stored);
  assert.deepEqual(currentCall, storedCall);
});

test("a FeeForwarder outside the recorded two, or a fee step whose approval and call targets differ, is refused", () => {
  const unknown = "0x1111111111111111111111111111111111111111";
  for (const [callTo, approveTo] of [[unknown, unknown], [FEE_FORWARDER, FEE_FORWARDER_V2_0], [FEE_FORWARDER_V2_0, FEE_FORWARDER], [FEE_FORWARDER, unknown]] as const) {
    assert.throws(() => decodeBridgeCall(withForwarders(fresh, callTo, approveTo)), { code: "APN_PROVIDER_PROTOCOL", message: /fee_swap/u });
  }
  assert.throws(() => bridgeFeeForwarder(withForwarders(fresh, unknown, unknown)), { code: "APN_PROVIDER_PROTOCOL", message: /fee_swap/u });
});

test("the source proof takes FeesForwarded only from the FeeForwarder the stored call names", () => {
  assert.equal(bridgeSourceProof(stored, decodeBridgeCall(stored), receipt).transactionHash, captured.provenance.sourceTransactionHash);
  // The same receipt cannot prove a call through the current FeeForwarder, and a log moved to it cannot prove v2.0.0.
  assert.throws(() => bridgeSourceProof(fresh, decodeBridgeCall(fresh), receipt), /FeesForwarded/u);
  const moved = { ...receipt, logs: receipt.logs.map(log => log.address === FEE_FORWARDER_V2_0 ? { ...log, address: FEE_FORWARDER } : log) };
  assert.equal(receipt.logs.filter(log => log.address === FEE_FORWARDER_V2_0).length, 1);
  assert.throws(() => bridgeSourceProof(stored, decodeBridgeCall(stored), moved), /FeesForwarded/u);
});

test("a step LI.FI built after the switch names v2.1.0 at the same calldata place and selector as the recorded captures", () => {
  const live = JSON.parse(readFileSync(new URL("../../../tests/core/lifi-fixtures/lifi-arbitrum-ethereum-usdc-stargate-20261104.json", import.meta.url), "utf8"));
  const selected = parseBridgeRoutes(live.routeResponse, live.request, live.sender).find(row => row.choice.tool === "stargateV2" && row.choice.preparable)!;
  const m = materializeBridgeRoute(selected, live.stepResponse, live.request, live.sender).materialization;
  assert.equal(bridgeFeeForwarder(m), FEE_FORWARDER);
  const recorded = JSON.parse(readFileSync(new URL("../../../tests/core/lifi-fixtures/lifi-stargate-taxi-step-transactions-20260908.json", import.meta.url), "utf8"));
  const before = (Object.values(recorded.rows) as { step: { transactionRequest: { data: string } } }[])[0]!.step.transactionRequest.data.toLowerCase();
  const after = m.transaction.data;
  assert.equal(after.slice(0, 10), before.slice(0, 10));
  assert.equal(after.indexOf(word(FEE_FORWARDER)), before.indexOf(word(FEE_FORWARDER_V2_0)));
  assert.equal(after.indexOf(FEE_FORWARDER_SELECTOR.slice(2)), before.indexOf(FEE_FORWARDER_SELECTOR.slice(2)));
});
