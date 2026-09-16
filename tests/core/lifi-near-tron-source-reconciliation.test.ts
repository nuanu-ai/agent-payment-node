import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, type AbiParameter, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "../../src/canonical.js";
import { FEE_RECIPIENT } from "../../src/lifi/abi.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceBinding } from "../../src/lifi/non-evm-source-journal.js";
import { reconcileNearTronBaseSource } from "../../src/lifi/near-tron-source-reconciliation.js";
import { inspectNearBaseTronQuoteOffline } from "../../src/lifi/near-tron-offline.js";
import { nearSourceEventsAbi } from "../../src/lifi/near-tron-source-receipt.js";
import type { BridgeProtocolReceipt, BridgeTransactionProof } from "../../src/lifi/model.js";
import type { BridgeRpcPort } from "../../src/lifi/ports.js";
import { BRIDGE_DIAMOND } from "../../src/lifi/validation.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const origin = "https://base.example";
const frozenQuote = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/base-tron-near-synthetic-20260916.json"), "utf8"));
frozenQuote.action.fromAddress = account.address;
frozenQuote.transactionRequest.from = account.address;
const oldRefundWord = `${"0".repeat(24)}${"1".repeat(40)}`;
const refundOffset = frozenQuote.transactionRequest.data.lastIndexOf(oldRefundWord);
assert.ok(refundOffset > 0);
frozenQuote.transactionRequest.data = frozenQuote.transactionRequest.data.slice(0, refundOffset) +
  `${"0".repeat(24)}${account.address.slice(2).toLowerCase()}` + frozenQuote.transactionRequest.data.slice(refundOffset + oldRefundWord.length);
const binding = { sender: account.address, tronRecipient: "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV",
  sourceAmountAtomic: "100000000", maxFeeAtomic: "250000", minOutputAtomic: "97000000" };
const inspected = inspectNearBaseTronQuoteOffline(frozenQuote, binding);
const data = frozenQuote.transactionRequest.data as Hex;
const block = { numberAtomic: "123", hash: `0x${"ab".repeat(32)}` as Hex, timestampAtomic: "1" };
const safe = { numberAtomic: "125", hash: `0x${"cd".repeat(32)}` as Hex, timestampAtomic: "2" };
const staged: NonEvmSourceBinding = { profileHash: "a".repeat(64), operationId: "b".repeat(64), draftIntegrityHash: "c".repeat(64),
  route: "base_usdc_to_tron_usdt_lifi_near_intents", createdAt: "2026-09-16T00:00:00.000Z", maxSourceNativeDebitWei: "1000000000000000",
  sourceCall: { chainId: 8453, from: account.address, to: BRIDGE_DIAMOND, valueAtomic: "0", data,
    dataSha256: sha256(Buffer.from(data.slice(2), "hex")), type: "eip1559", nonceAtomic: "7", gasLimitAtomic: "100000",
    maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", accessList: [] },
  admissionProof: { kind: "synthetic_untrusted", claimedValidationHash: "d".repeat(64), note: "offline test" } };
function event(address: `0x${string}`, name: string, args: Record<string, unknown>) {
  const item = getAbiItem({ abi: nearSourceEventsAbi as any, name: name as any }) as any;
  const inputs = item.inputs as readonly (AbiParameter & { indexed?: boolean })[];
  return { address, topics: encodeEventTopics({ abi: [item] as any, eventName: name as never, args: args as never }) as readonly Hex[],
    data: encodeAbiParameters(inputs.filter(x => !x.indexed), inputs.filter(x => !x.indexed).map(x => args[x.name!]) as never) };
}
function logs() {
  const b = { transactionId: frozenQuote.transactionId, bridge: "near", integrator: "lifi-api",
    referrer: "0x0000000000000000000000000000000000000000", sendingAssetId: inspected.sourceToken,
    receiver: "0x11f111f111f111F111f111f111F111f111f111F1", minAmount: BigInt(inspected.bridgeAmountAtomic),
    destinationChainId: BigInt(inspected.facetDestinationChainId), hasSourceSwaps: true, hasDestinationCall: false };
  return [event(inspected.sourceToken, "Transfer", { from: account.address, to: BRIDGE_DIAMOND, value: 100000000n }),
    event(inspected.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: FEE_RECIPIENT, value: 250000n }),
    event(inspected.sourceToken, "Transfer", { from: BRIDGE_DIAMOND, to: inspected.depositAddress, value: BigInt(inspected.bridgeAmountAtomic) }),
    event(BRIDGE_DIAMOND, "NEARIntentsBridgeStarted", { transactionId: frozenQuote.transactionId, quoteId: inspected.quoteId,
      depositAddress: inspected.depositAddress, sendingAssetId: inspected.sourceToken, amount: BigInt(inspected.bridgeAmountAtomic),
      deadline: BigInt(inspected.deadline), minAmountOut: BigInt(inspected.facetMinimumOutputAtomic) }),
    event(BRIDGE_DIAMOND, "BridgeToNonEVMChainBytes32", { transactionId: frozenQuote.transactionId,
      destinationChainId: BigInt(inspected.facetDestinationChainId), receiver: inspected.facetNonEvmReceiver }),
    event(BRIDGE_DIAMOND, "LiFiTransferStarted", { bridgeData: b })];
}
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
async function setup() {
  const tmp = await temporaryState(), repo = new NonEvmSourceJournalRepository(tmp.root);
  let j = await repo.stage(staged);
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, "2026-09-16T00:00:01.000Z");
  const raw = await account.signTransaction({ chainId: 8453, to: BRIDGE_DIAMOND, data, value: 0n, nonce: 7,
    gas: 100000n, maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 1000000n, type: "eip1559" });
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, raw, "7", "2026-09-16T00:00:02.000Z");
  j = await repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, "2026-09-16T00:00:03.000Z");
  const receipt: Mutable<BridgeProtocolReceipt> = { chainId: 8453, transactionHash: j.transactionHash as Hex,
    blockHash: block.hash, blockNumberAtomic: block.numberAtomic, logs: logs() };
  const tx = { chainId: 8453, transactionHash: j.transactionHash as Hex, block, safeBlock: safe, rpcOrigin: origin,
    from: account.address, to: BRIDGE_DIAMOND, nonceAtomic: "7", valueAtomic: "0", dataHash: staged.sourceCall.dataSha256,
    gasLimitAtomic: "100000", maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", status: "success",
    logsHash: hashObject(receipt.logs) } as Mutable<BridgeTransactionProof>;
  const rpc = { chainId: 8453, origin, observe: async () => ({ transaction: tx, receipt }) } as Pick<BridgeRpcPort, "chainId" | "origin" | "observe">;
  const input = { journal: j, repository: repo, rpc, frozenQuote, binding, expectedRpcOrigin: origin,
    observedAt: "2026-09-16T00:00:04.000Z" };
  return { tmp, repo, j, receipt, tx, rpc, input };
}
test("matching source events and quote persist untrusted proof only", async t => {
  const f = await setup(); t.after(f.tmp.cleanup);
  const j = await reconcileNearTronBaseSource(f.input);
  assert.equal(j.phase, "source_observed_untrusted");
  assert.equal(j.safeSourceProof?.provenance, "rpc_observed_untrusted_near_tron_base_source_v1");
  assert.equal(j.executionAdmitted, false); assert.equal(j.submissionAttempts, 1);
  assert.equal((j.safeSourceProof as { bridgeCompletion: boolean }).bridgeCompletion, false);
  assert.equal("destinationProof" in j, false);
  assert.equal((await f.repo.load(j.profileHash, j.operationId))?.integrityHash, j.integrityHash);
  await assert.rejects(f.repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, f.input.observedAt), { code: "APN_OPERATION_BLOCKED" });
});
test("missing safe block, mismatched envelope, quote, event, and reorg clear source observation", async t => {
  const mutations: Array<(f: Awaited<ReturnType<typeof setup>>) => void> = [
    f => { f.tx.safeBlock = null; }, f => { f.tx.from = BRIDGE_DIAMOND; }, f => { f.tx.to = account.address; },
    f => { f.tx.valueAtomic = "1"; }, f => { f.tx.dataHash = "e".repeat(64); }, f => { f.tx.nonceAtomic = "8"; },
    f => { f.tx.gasLimitAtomic = "99999"; }, f => { f.tx.maxFeePerGasAtomic = "2"; },
    f => { f.tx.maxPriorityFeePerGasAtomic = "2"; }, f => { f.tx.logsHash = "e".repeat(64); },
    f => { f.receipt.blockHash = `0x${"ff".repeat(32)}`; },
    f => { f.receipt.logs = f.receipt.logs.slice(0, -1); f.tx.logsHash = hashObject(f.receipt.logs); },
  ];
  for (const mutate of mutations) {
    const f = await setup(); t.after(f.tmp.cleanup); mutate(f);
    const j = await reconcileNearTronBaseSource(f.input);
    assert.equal(j.phase, "unknown_finality"); assert.equal(j.safeSourceProof, null);
  }
  const f = await setup(); t.after(f.tmp.cleanup);
  const good = await reconcileNearTronBaseSource(f.input);
  f.tx.block = { ...block, hash: `0x${"ee".repeat(32)}` }; f.receipt.blockHash = f.tx.block.hash;
  const reorg = await reconcileNearTronBaseSource({ ...f.input, journal: good, observedAt: "2026-09-16T00:00:05.000Z" });
  assert.equal(reorg.phase, "unknown_finality"); assert.equal(reorg.safeSourceProof, null);
});
test("caller quote changes and fabricated revert cannot grant source confirmation", async t => {
  const f = await setup(); t.after(f.tmp.cleanup);
  const changed = structuredClone(frozenQuote); changed.estimate.toAmountMin = "1";
  const mismatch = await reconcileNearTronBaseSource({ ...f.input, frozenQuote: changed });
  assert.equal(mismatch.phase, "unknown_finality");
  f.tx.status = "reverted";
  const reverted = await reconcileNearTronBaseSource({ ...f.input, journal: mismatch, observedAt: "2026-09-16T00:00:05.000Z" });
  assert.equal(reverted.phase, "source_observed_untrusted"); assert.equal(reverted.safeSourceProof?.status, "reverted");
  assert.equal((reverted.safeSourceProof as { protocolProofHash: string | null }).protocolProofHash, null);
});
test("valid but changed caller quote metadata clears earlier observation", async t => {
  const f = await setup(); t.after(f.tmp.cleanup);
  const good = await reconcileNearTronBaseSource(f.input);
  const changed = structuredClone(frozenQuote); changed.id = "different-saved-quote-id";
  const result = await reconcileNearTronBaseSource({ ...f.input, journal: good, frozenQuote: changed,
    observedAt: "2026-09-16T00:00:05.000Z" });
  assert.equal(result.phase, "unknown_finality"); assert.equal(result.safeSourceProof, null);
});
test("status drift and loss of safe block clear a prior untrusted observation", async t => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof setup>>) => { f.tx.status = "reverted"; },
    (f: Awaited<ReturnType<typeof setup>>) => { f.tx.safeBlock = null; },
  ]) {
    const f = await setup(); t.after(f.tmp.cleanup);
    const observed = await reconcileNearTronBaseSource(f.input);
    assert.equal(observed.phase, "source_observed_untrusted");
    mutate(f);
    const changed = await reconcileNearTronBaseSource({ ...f.input, journal: observed,
      observedAt: "2026-09-16T00:00:05.000Z" });
    assert.equal(changed.phase, "unknown_finality"); assert.equal(changed.safeSourceProof, null);
    assert.equal(changed.executionAdmitted, false);
  }
});
