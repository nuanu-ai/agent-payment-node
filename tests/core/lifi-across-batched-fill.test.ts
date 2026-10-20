import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { canonicalJson, hashObject, sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { EVENT_TOPICS, FEE_RECIPIENT } from "../../src/lifi/abi.js";
import { bridgeProtocolEmitter } from "../../src/lifi/deployments.js";
import type { BridgeLog, BridgeMaterialization, BridgeProtocolReceipt, BridgeSourceProof, DecodedBridgeCall } from "../../src/lifi/model.js";
import { bridgeDestinationProof } from "../../src/lifi/protocol-evidence.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";
import type { Hex } from "../../src/model.js";
import { temporaryState } from "./helpers.js";
import { addressWord, eventArgs, mutateEvent } from "./lifi-event-fixtures.js";
import { lifiFixture } from "./lifi-helpers.js";
import { findStored } from "./stored-operations.js";

/** QA 0.5.51 operation 14b9c3b6…: Base ETH -> Ethereum ETH; the relayer filled it in one transaction with two BNB-origin fills. */
const LIVE = JSON.parse(readFileSync("tests/core/fixtures/across-qa0551-batched-fill.json", "utf8")) as {
  operationId: string; sourceProof: BridgeSourceProof; destinationReceipt: BridgeProtocolReceipt;
  route: { sender: string; recipient: string; lifiTransactionId: Hex } };
const FILLED_RELAY = EVENT_TOPICS.filledRelay;
const SPOKE = bridgeProtocolEmitter(1, "across", BRIDGE_ZERO_ADDRESS);

/** The stored decode of this route, as far as the destination proof reads it (it is bound to the stored source proof). */
function liveDecoded(): DecodedBridgeCall {
  const c = LIVE.sourceProof.correlation as Extract<BridgeSourceProof["correlation"], { kind: "across" }>;
  const sender = getAddress(LIVE.route.sender), recipient = getAddress(LIVE.route.recipient);
  return { tool: "across", selector: "0x00000000", transactionId: LIVE.route.lifiTransactionId, bridgeName: "across", integrator: "lifi-api",
    referrer: BRIDGE_ZERO_ADDRESS, sender, recipient, sourceChainId: 8453, destinationChainId: 1, sourceToken: BRIDGE_ZERO_ADDRESS,
    destinationToken: BRIDGE_ZERO_ADDRESS, sourceAmountAtomic: LIVE.sourceProof.sourceAmountAtomic, bridgeAmountAtomic: LIVE.sourceProof.bridgeAmountAtomic,
    feeAmountAtomic: LIVE.sourceProof.feeForwardedAtomic, feeRecipient: FEE_RECIPIENT, minimumOutputAtomic: c.outputAmountAtomic,
    sourceValueAtomic: LIVE.sourceProof.sourceAmountAtomic, dataHash: "0".repeat(64),
    protocol: { kind: "across", receiverAddress: addressWord(recipient), refundAddress: addressWord(sender), sendingAssetId: c.inputToken,
      receivingAssetId: c.outputToken, outputAmountAtomic: c.outputAmountAtomic, outputAmountMultiplier: "0", exclusiveRelayer: c.exclusiveRelayer,
      quoteTimestamp: c.quoteTimestamp, fillDeadline: c.fillDeadline, exclusivityParameter: "0", message: c.message } };
}
const NO_MATERIALIZATION = {} as BridgeMaterialization;
const fills = (logs: readonly BridgeLog[]) => logs.filter((log) => log.address === SPOKE && log.topics[0] === FILLED_RELAY);
const ours = (log: BridgeLog) => eventArgs(log, "FilledRelay").depositId === 6348686n;
const refused = (logs: readonly BridgeLog[], reason: string) => assert.throws(() => bridgeDestinationProof(LIVE.sourceProof, NO_MATERIALIZATION, liveDecoded(),
  { ...LIVE.destinationReceipt, logs }), (error: ApnError) => error.code === "APN_RPC_PROTOCOL" && error.message === `Bridge validation failed: ${reason}.`, reason);

test("the captured batched destination receipt proves the stored Across deposit among unrelated fills", () => {
  const receipt = LIVE.destinationReceipt;
  assert.equal(fills(receipt.logs).length, 3); assert.equal(fills(receipt.logs).filter(ours).length, 1);
  const proof = bridgeDestinationProof(LIVE.sourceProof, NO_MATERIALIZATION, liveDecoded(), receipt);
  assert.equal(proof.transactionHash, "0x984463526e3e5b8cbac65e17f3644a677f542c3a4bb652a0f5a0f681c235dc7b");
  assert.equal(proof.amountAtomic, "784559463424677"); assert.equal(proof.recipient, getAddress(LIVE.route.recipient));
  assert.equal(proof.correlationHash, sha256(canonicalJson(LIVE.sourceProof.correlation)));
  // The same fill alone proves the same delivery: the unrelated fills neither help nor hurt.
  const alone = receipt.logs.filter((log) => !fills(receipt.logs).includes(log) || ours(log));
  assert.deepEqual({ ...bridgeDestinationProof(LIVE.sourceProof, NO_MATERIALIZATION, liveDecoded(), { ...receipt, logs: alone }), logsHash: null },
    { ...proof, logsHash: null });
});

test("batched fills still refuse a missing, duplicated or altered correlated fill and an unproven unwrap", () => {
  const logs = LIVE.destinationReceipt.logs, index = logs.findIndex((log) => fills(logs).includes(log) && ours(log));
  refused(logs.filter((_, i) => i !== index), "destination_fill_unmatched");
  refused([...logs, logs[index]!], "destination_fill_ambiguous");
  refused(logs.map((log, i) => i === index ? mutateEvent(log, "FilledRelay", { depositId: 6348687n }) : log), "destination_fill_unmatched");
  refused(logs.map((log, i) => i === index ? mutateEvent(log, "FilledRelay", { originChainId: 56n }) : log), "destination_fill_unmatched");
  for (const change of [{ recipient: addressWord(getAddress("0x89a8a883abfe1e6088cbc150397620c1e2284796")) }, { outputAmount: 784559463424676n },
    { inputAmount: 1n }, { relayExecutionInfo: { ...eventArgs(logs[index]!, "FilledRelay").relayExecutionInfo, updatedOutputAmount: 1n } }])
    refused(logs.map((log, i) => i === index ? mutateEvent(log, "FilledRelay", change) : log), "FilledRelay");
  const withdrawal = logs.findIndex((log) => log.topics[0] === EVENT_TOPICS.wrappedWithdrawal);
  refused(logs.map((log, i) => i === withdrawal ? mutateEvent(log, "Withdrawal", { wad: 784559463424676n }) : log), "native_destination_unwrap");
  refused(logs.filter((_, i) => i !== withdrawal), "native_destination_unwrap");
  assert.throws(() => bridgeDestinationProof(LIVE.sourceProof, NO_MATERIALIZATION, liveDecoded(), { ...LIVE.destinationReceipt, chainId: 8453 }),
    { code: "APN_RPC_PROTOCOL" });
});

test("an Across operation left unknown by the batch rejection completes through the normal resume, same source effect and hold", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await lifiFixture(temporary.root);
  const { id } = await s.prepare(), observe = s.destination.observe.bind(s.destination);
  // 0.5.51 rejected the batched receipt: the operation is left in unknown_finality like the captured one.
  s.destination.observe = async () => { throw new ApnError("APN_RPC_PROTOCOL", "Bridge validation failed: FilledRelay_count."); };
  assert.equal((await s.core.execute({ command: "bridge.approve", operationId: id })).ok, true);
  const stuck = (await findStored(s.core.bridges.records, id))!;
  assert.deepEqual([stuck.state, stuck.failure?.reason, stuck.destinationProof], ["unknown_finality", "destination_observation_unavailable", null]);
  const sent = [...s.source.submissions];
  // The destination receipt is the relayer's batch: the captured unrelated fills and their token movements around ours.
  const destinationToken = stuck.intent.decoded.destinationToken, emitter = bridgeProtocolEmitter(stuck.intent.decoded.destinationChainId, "across", destinationToken);
  const unrelated = LIVE.destinationReceipt.logs.slice(0, 4).map((log) => ({ ...log,
    address: log.topics[0] === FILLED_RELAY ? emitter : destinationToken }));
  s.destination.observe = async (...args: Parameters<typeof observe>) => {
    const found = await observe(...args); if (found === null) return null;
    const logs = [...unrelated, ...found.receipt.logs];
    return { transaction: { ...found.transaction, logsHash: hashObject(logs) }, receipt: { ...found.receipt, logs } };
  };
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const completed = (await findStored(s.core.bridges.records, id))!;
  assert.deepEqual([completed.state, completed.terminal, completed.operationId], ["completed", true, id]);
  assert.equal(completed.destinationProof?.amountAtomic, (stuck.sourceProof!.correlation as { outputAmountAtomic: string }).outputAmountAtomic);
  assert.deepEqual(s.source.submissions, sent, "nothing is signed or sent again");
  assert.deepEqual(completed.effects.map((effect) => effect.transactionHash), stuck.effects.map((effect) => effect.transactionHash));
  assert.equal(completed.usageLease?.reservationId, stuck.usageLease?.reservationId);
  const lease = completed.usageLease!, ledger = await new AssetUsageLedger(temporary.root).load({ account: lease.account, chain: lease.chain, asset: lease.asset }, lease.reservationId);
  assert.equal(ledger?.state, "finalized");
  const status = await s.core.execute({ command: "operation.status", operationId: id });
  assert.equal((status.operation as { terminal: boolean }).terminal, true);
});
