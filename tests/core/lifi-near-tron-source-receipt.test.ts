import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type AbiParameter } from "viem";
import type { Address, Hex } from "../../src/model.js";
import { nearSourceEventsAbi, inspectNearBaseTronSourceReceiptOffline, type NearSafeSourceReceipt, type NearSourceTransaction } from "../../src/lifi/near-tron-source-receipt.js";
import { inspectNearBaseTronQuoteOffline } from "../../src/lifi/near-tron-offline.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import { FEE_RECIPIENT } from "../../src/lifi/abi.js";

const quote = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/base-tron-near-synthetic-20260916.json"), "utf8"));
const binding = { sender: "0x1111111111111111111111111111111111111111" as const,
  tronRecipient: "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV", sourceAmountAtomic: "100000000", maxFeeAtomic: "250000", minOutputAtomic: "97000000" };
const inspected = inspectNearBaseTronQuoteOffline(quote, binding);
const tx: NearSourceTransaction = { chainId: 8453, hash: `0x${"12".repeat(32)}`, from: binding.sender,
  to: BRIDGE_DIAMOND, input: quote.transactionRequest.data, valueAtomic: "0" };
function event(address: Address, name: string, args: Record<string, any>) {
  const item = getAbiItem({ abi: nearSourceEventsAbi as any, name: name as any }) as any;
  const inputs = item.inputs as readonly (AbiParameter & { indexed?: boolean })[];
  return { address, topics: encodeEventTopics({ abi: [item] as any, eventName: name as never, args: args as never }) as readonly Hex[],
    data: encodeAbiParameters(inputs.filter(x => !x.indexed), inputs.filter(x => !x.indexed).map(x => args[x.name!]) as never) };
}
const b = { transactionId: quote.transactionId, bridge: "near", integrator: "lifi-api",
  referrer: "0x0000000000000000000000000000000000000000", sendingAssetId: inspected.sourceToken,
  receiver: "0x11f111f111f111F111f111f111F111f111f111F1", minAmount: BigInt(inspected.bridgeAmountAtomic),
  destinationChainId: BigInt(inspected.facetDestinationChainId), hasSourceSwaps: true, hasDestinationCall: false };
const near = { transactionId: quote.transactionId, quoteId: inspected.quoteId, depositAddress: inspected.depositAddress,
  sendingAssetId: inspected.sourceToken, amount: BigInt(inspected.bridgeAmountAtomic), deadline: BigInt(inspected.deadline),
  minAmountOut: BigInt(inspected.facetMinimumOutputAtomic) };
const nonEvm = { transactionId: quote.transactionId, destinationChainId: BigInt(inspected.facetDestinationChainId), receiver: inspected.facetNonEvmReceiver };
function receipt(): NearSafeSourceReceipt { return { chainId: 8453, transactionHash: tx.hash, status: "success", safe: true,
  blockNumberAtomic: "123", blockHash: `0x${"ab".repeat(32)}`, logs: [
    event(inspected.sourceToken, "Transfer", { from: binding.sender, to: BRIDGE_DIAMOND, value: 100000000n }),
    event(inspected.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: FEE_RECIPIENT, value: 250000n }),
    event(inspected.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: inspected.depositAddress, value: BigInt(inspected.bridgeAmountAtomic) }),
    event(BRIDGE_DIAMOND, "NEARIntentsBridgeStarted", near),
    event(BRIDGE_DIAMOND, "BridgeToNonEVMChainBytes32", nonEvm),
    event(BRIDGE_DIAMOND, "LiFiTransferStarted", { bridgeData: b }),
  ] }; }
function refused(r: NearSafeSourceReceipt, t: NearSourceTransaction = tx, q: unknown = quote) {
  assert.throws(() => inspectNearBaseTronSourceReceiptOffline(q, binding, t, r), { code: "APN_RPC_PROTOCOL" });
}
test("safe receipt yields a source deposit candidate with delivery unverified", () => {
  const proof = inspectNearBaseTronSourceReceiptOffline(quote, binding, tx, receipt());
  assert.equal(proof.depositAddress, inspected.depositAddress);
  assert.equal(proof.bridgeAmountAtomic, "99750000");
  assert.equal(proof.recipientDelivery, "unverified");
  assert.equal(proof.status, "unverified");
  assert.equal(proof.executionAdmitted, false);
  assert.equal(proof.bridgeCompletion, false);
});
test("transaction identity, success and safe receipt are required", () => {
  refused({ ...receipt(), status: "reverted" } as any);
  refused({ ...receipt(), safe: false } as any);
  refused({ ...receipt(), transactionHash: `0x${"cd".repeat(32)}` });
  refused(receipt(), { ...tx, to: binding.sender });
  refused(receipt(), { ...tx, input: "0x3110c7b9" });
});
test("missing, duplicate, ambiguous and mismatched protocol logs are rejected", () => {
  const r = receipt();
  for (let i = 2; i < r.logs.length; i++) refused({ ...r, logs: r.logs.filter((_, n) => n !== i) });
  for (let i = 2; i < r.logs.length; i++) refused({ ...r, logs: [...r.logs, r.logs[i]!] });
  refused({ ...r, logs: r.logs.map((x, i) => i === 3 ? event(BRIDGE_DIAMOND, "NEARIntentsBridgeStarted", { ...near, quoteId: `0x${"cd".repeat(32)}` }) : x) });
  refused({ ...r, logs: r.logs.map((x, i) => i === 4 ? event(BRIDGE_DIAMOND, "BridgeToNonEVMChainBytes32", { ...nonEvm, receiver: `0x${"cd".repeat(32)}` }) : x) });
  refused({ ...r, logs: r.logs.map((x, i) => i === 5 ? event(BRIDGE_DIAMOND, "LiFiTransferStarted", { bridgeData: { ...b, minAmount: 1n } }) : x) });
  refused({ ...r, logs: r.logs.map((x, i) => i === 2 ? event(inspected.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: inspected.depositAddress, value: 1n }) : x) });
});
