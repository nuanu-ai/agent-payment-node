import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeFunctionData } from "viem";
import { deploymentAbi, FEE_FORWARDER, FEE_FORWARDER_SELECTOR, FEE_FORWARDER_V2_0, RECORDED_FEE_FORWARDERS } from "../../src/lifi/abi.js";
import { bridgeFeeForwarder, decodeBridgeCall } from "../../src/lifi/decode.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { bridgeApprovalPolicyHash, guardBridgeEffect } from "../../src/lifi/economics.js";
import type { BridgeMaterialization, BridgeProtocolReceipt } from "../../src/lifi/model.js";
import type { BridgeRpcPort } from "../../src/lifi/ports.js";
import { bridgeSourceProof } from "../../src/lifi/protocol-evidence.js";
import { parseReceiptLogs } from "../../src/lifi/rpc-proof-codec.js";
import { materializeBridgeRoute, parseBridgeRoutes } from "../../src/lifi/routes.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";
import { feeForwarderV20Materialization, readdressFeeForwarder } from "./lifi-capture.js";
import { preparedWbtc } from "./lifi-wbtc-authority-helpers.js";

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

test("the current FeeForwarder is v2.1.0 and its code, Diamond allowlisting and owner are what the source check pins", () => {
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
    assert.equal(d.reads.filter(row => row.address === BRIDGE_DIAMOND && row.data === allowlisted).length, 1);
    assert.equal(d.reads.filter(row => row.address === FEE_FORWARDER && row.data === "0x8da5cb5b").length, 1);
    assert.equal(d.reads.some(row => row.data.includes(word(FEE_FORWARDER_V2_0))) || d.code.some(row => row.address === FEE_FORWARDER_V2_0), false);
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

test("an unsent operation prepared through v2.0.0 must be prepared again before any read or signature", async (t) => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const now = new Date("2026-10-09T03:44:00.000Z"), prepared = (await preparedWbtc(temp.root, now)).op;
  const materialization = feeForwarderV20Materialization(prepared.intent.materialization);
  const op = { ...prepared, intent: { ...prepared.intent, materialization, policyHash: bridgeApprovalPolicyHash(materialization) } };
  const unread = new Proxy({}, { get: () => { throw new Error("no RPC read before the refusal"); } }) as BridgeRpcPort;
  await assert.rejects(guardBridgeEffect(op, "approval", unread, unread, () => now.getTime()),
    { code: "APN_REPREPARE_REQUIRED", message: /fee_forwarder_retired/u });
});
