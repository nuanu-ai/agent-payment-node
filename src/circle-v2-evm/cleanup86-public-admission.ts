import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./catalog.js";
import { circleBlocked } from "./operation-model.js";
import { circleHex, circleUint, circleRecord, type CircleObservation } from "./protocol.js";
import type { ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import type { CircleRpc } from "./rpc.js";
import { CLEANUP85_HASH } from "./cleanup85-recovery-store.js";
import { SEALED_BURN_HASH } from "./burn-retirement.js";
/** Historical full verification is retained only within the invocation. Every later boundary
 * reanchors those exact canonical blocks and reads a fresh complete anchored current account. */
export async function recheckCleanup86Admission(source: CircleRpc, evidence: ConsumedBurnEvidence, cancellation: CircleObservation): Promise<void> {
  const receipt = circleRecord(cancellation.receipt), head = await source.block("finalized"), number = circleUint(head.number), time = circleUint(head.timestamp), hash = circleHex(head.hash, 32);
  if (hash === "0x" + "0".repeat(64) || number < circleUint(receipt.blockNumber) || time < circleUint(circleRecord(cancellation.canonicalBlock).timestamp)) circleBlocked("cleanup86_current_head_invalid");
  const tag = { blockHash: hash, requireCanonical: true as const };
  const values = await Promise.all([source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "latest"]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "pending"]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, tag]), source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], tag), source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag), source.call("eth_getTransactionReceipt", [CLEANUP85_HASH]), source.call("eth_getTransactionReceipt", [SEALED_BURN_HASH])]);
  if (values.slice(0, 3).some(x => circleUint(x) !== 86n) || String(values[3]) !== "97924" || String(values[4]) !== "40100" || values[5] !== null || values[6] !== null) circleBlocked("cleanup86_current_nonce_principal_or_receipt_changed");
  const points = [head, circleRecord(cancellation.canonicalBlock), circleRecord(cancellation.finalityHead), ...[evidence.approvalProof, evidence.consumerProof].flatMap(p => [{ number: "0x" + BigInt(p.blockNumberAtomic).toString(16), hash: p.blockHash }, { number: "0x" + BigInt(p.finalityBlockNumberAtomic).toString(16), hash: p.finalityBlockHash }])];
  for (const point of points) { const fresh = await source.block(String(point.number)); if (circleHex(fresh.hash, 32) !== circleHex(point.hash, 32) || circleUint(fresh.number) !== circleUint(point.number) || "timestamp" in point && circleUint(fresh.timestamp) !== circleUint(point.timestamp)) circleBlocked("cleanup86_historical_or_current_reanchor_changed"); }
}
