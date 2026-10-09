import { consumedApprovalTimestamp } from "./consumed-approval-timestamp.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./catalog.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import { circleHex, circleRecord, circleUint, verifyCircleApproval } from "./protocol.js";
import { assertRetirementObservedEnvelope, approvalReceiptIdentity } from "./burn-retirement-rpc.js";
import { verifyConsumedNonce, CONSUMER_HASH, assertConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { verifyCleanup85PublicWire, cleanup85Reanchor } from "./cleanup85-public-proof.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import type { CircleRpc } from "./rpc.js";
/** Only frozen cleanup85/86 proof replay. Initial admission continues to use the stricter current
 * account checks. Later legitimate account activity cannot invalidate canonical historical state. */
export async function verifyCleanup85HistoricalAcceptance(source: CircleRpc, op: CircleOperationV1, proof: CircleNonceRetirementProof): Promise<void> {
  const p = proof.cleanup85Recovery!; await source.identity();
  let approval = await source.observation(op.effects[0]!.transactionHash!, "finalized"); if (approval === null) circleBlocked("cleanup85_historical_approval_not_finalized");
  approval = consumedApprovalTimestamp(approval, op); assertRetirementObservedEnvelope(op.effects[0]!, approval.transaction);
  await verifyCleanup85PublicWire(approval, op.effects[0]!.envelope, op.effects[0]!.transactionHash!);
  const approvalTag = { blockHash: circleHex(circleRecord(approval.receipt).blockHash, 32), requireCanonical: true as const }, approvalProof = verifyCircleApproval(approval, false, String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], approvalTag))), usdcBalanceAtomic = String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], approvalTag));
  const consumer = await source.observation(CONSUMER_HASH, "finalized"); if (consumer === null) circleBlocked("cleanup85_historical_consumer_not_finalized");
  await verifyCleanup85PublicWire(consumer, { from: CIRCLE_SOURCE_OWNER, to: "0x02EC4C5ec5d05c3c60495549e833cE318A230149", nonceAtomic: "84", valueAtomic: "10000000000000", data: "0x", gasLimitAtomic: "25878", maxFeePerGasAtomic: "60066000", maxPriorityFeePerGasAtomic: "0", chainId: 42161, envelopeHash: "historical-consumer-public-wire" }, CONSUMER_HASH, true);
  const evidence = { approvalProof, consumerProof: verifyConsumedNonce(consumer), usdcBalanceAtomic };
  assertConsumedBurnEvidence(evidence, op);
  if (approvalReceiptIdentity(evidence.approvalProof) !== approvalReceiptIdentity(p.approvalProof) || approvalReceiptIdentity(evidence.consumerProof) !== approvalReceiptIdentity(p.consumerProof)) circleBlocked("cleanup85_historical_source_identity_changed");
  const included = await source.block("0x" + BigInt(p.cleanupProof.blockNumberAtomic).toString(16));
  const head = await source.block("0x" + BigInt(proof.finalizedBlockNumberAtomic).toString(16)), current = await source.block("finalized"), zero = "0x" + "0".repeat(64);
  if (circleHex(head.hash, 32) !== proof.finalizedBlockHash || circleUint(head.number).toString() !== proof.finalizedBlockNumberAtomic || circleHex(head.hash, 32) === zero || circleHex(current.hash, 32) === zero || circleHex(included.hash, 32) !== p.cleanupProof.blockHash || circleUint(included.number).toString() !== p.cleanupProof.blockNumberAtomic || circleUint(included.timestamp) === 0n || circleUint(head.timestamp) < circleUint(included.timestamp) || circleUint(head.number) < BigInt(p.consumerProof.blockNumberAtomic) || circleUint(head.number) < BigInt(p.cleanupProof.blockNumberAtomic) || circleUint(current.number) < circleUint(head.number) || circleUint(current.timestamp) < circleUint(head.timestamp)) circleBlocked("cleanup85_historical_acceptance_head_changed");
  const tag = { blockHash: circleHex(head.hash, 32), requireCanonical: true as const }, nonce = BigInt(proof.finalizedNonceAtomic);
  const [historicalNonce, balance, allowance, latest, pending, finalized] = await Promise.all([source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, tag]), source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], tag), source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "latest"]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "pending"]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, { blockHash: circleHex(current.hash, 32), requireCanonical: true }])]);
  if (circleUint(historicalNonce) !== nonce || String(balance) !== "97924" || String(allowance) !== "0" || [latest, pending, finalized].some(x => circleUint(x) < nonce)) circleBlocked("cleanup85_historical_acceptance_state_changed");
  await cleanup85Reanchor(source, approval); await cleanup85Reanchor(source, consumer);
  for (const old of [included, head, current]) { const fresh = await source.block(String(old.number)); if (circleHex(fresh.hash, 32) !== circleHex(old.hash, 32) || circleUint(fresh.number) !== circleUint(old.number) || circleUint(fresh.timestamp) !== circleUint(old.timestamp)) circleBlocked("cleanup85_historical_acceptance_reorg"); }
}
