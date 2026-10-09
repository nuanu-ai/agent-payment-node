import { getAddress, keccak256, serializeTransaction, recoverTransactionAddress, type Hex, type TransactionSerializedEIP1559 } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { assertConsumedBurnIdentity, SEALED_BURN_HASH } from "./burn-retirement.js";
import { approvalReceiptIdentity, sealedBurnEvidence } from "./burn-retirement-rpc.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./catalog.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import { circleHex, circleRecord, circleUint, type CircleReceiptProof, type CircleObservation } from "./protocol.js";
import type { CircleRpc } from "./rpc.js";
export const CONSUMER_HASH = "0x11f15f7ee8f3fe7956c056c9e3ed0a1286aa16e92329720e701bbf4db120f225" as Hex;
export const CONSUMER_BLOCK_HASH = "0xb61353469b1f3f5459c48755db96a0a38d451654449507afd9a8ba097b65681d";
const CONSUMER_TIME = 1791535099n;
export const CONSUMER_TO = "0x02EC4C5ec5d05c3c60495549e833cE318A230149";
export interface ConsumedBurnEvidence { readonly approvalProof: CircleReceiptProof; readonly consumerProof: CircleReceiptProof; readonly usdcBalanceAtomic: string; }

function consumerWire(t: Record<string, unknown>): TransactionSerializedEIP1559 {
  return serializeTransaction({ type: "eip1559", chainId: Number(circleUint(t.chainId)), nonce: Number(circleUint(t.nonce)), to: getAddress(String(t.to)), data: circleHex(t.input), value: circleUint(t.value), gas: circleUint(t.gas), maxFeePerGas: circleUint(t.maxFeePerGas), maxPriorityFeePerGas: circleUint(t.maxPriorityFeePerGas), accessList: [] }, { r: circleHex(t.r, 32), s: circleHex(t.s, 32), yParity: Number(circleUint(t.yParity ?? t.v)) });
}
/** This exact successful native transaction has no authorizations, calldata or logs. Its value/fee never enter Circle accounting. */
export function verifyConsumedNonce(input: CircleObservation): CircleReceiptProof {
  const t = circleRecord(input.transaction), r = circleRecord(input.receipt), b = circleRecord(input.canonicalBlock), recheck = circleRecord(input.recheckedBlock), head = circleRecord(input.finalityHead);
  if (input.chainId !== 42161 || input.finalityTag !== "finalized" || circleUint(t.chainId) !== 42161n || circleUint(t.type) !== 2n || circleHex(t.hash, 32) !== CONSUMER_HASH || CONSUMER_HASH === (SEALED_BURN_HASH as string) ||
    getAddress(String(t.from)) !== CIRCLE_SOURCE_OWNER || getAddress(String(t.to)) !== CONSUMER_TO || circleUint(t.nonce) !== 84n || circleHex(t.input) !== "0x" || circleUint(t.value) !== 10000000000000n ||
    t.authorizationList !== undefined && (!Array.isArray(t.authorizationList) || t.authorizationList.length !== 0) || !Array.isArray(t.accessList) || t.accessList.length !== 0 ||
    circleUint(t.gas) !== 25878n || circleUint(t.maxFeePerGas) !== 60066000n || circleUint(t.maxPriorityFeePerGas) !== 0n || circleUint(t.transactionIndex) !== 4n ||
    circleHex(t.blockHash, 32) !== CONSUMER_BLOCK_HASH || circleUint(t.blockNumber) !== 513145262n || circleHex(r.transactionHash, 32) !== CONSUMER_HASH || circleUint(r.status) !== 1n ||
    getAddress(String(r.from)) !== CIRCLE_SOURCE_OWNER || getAddress(String(r.to)) !== CONSUMER_TO || circleHex(r.blockHash, 32) !== CONSUMER_BLOCK_HASH || circleUint(r.blockNumber) !== 513145262n || circleUint(r.transactionIndex) !== 4n ||
    !Array.isArray(r.logs) || r.logs.length !== 0 || circleUint(r.gasUsed) !== 21283n || circleUint(r.effectiveGasPrice) !== 20046000n ||
    circleHex(b.hash, 32) !== CONSUMER_BLOCK_HASH || circleUint(b.number) !== 513145262n || circleUint(b.timestamp) !== CONSUMER_TIME || circleHex(recheck.hash, 32) !== CONSUMER_BLOCK_HASH || circleUint(recheck.number) !== 513145262n || circleUint(recheck.timestamp) !== CONSUMER_TIME ||
    !Array.isArray(b.transactions) || b.transactions[4] !== CONSUMER_HASH || b.transactions.filter(x => typeof x === "string" && x.toLowerCase() === CONSUMER_HASH).length !== 1 ||
    circleUint(head.number) < 513145262n || circleUint(head.timestamp) < CONSUMER_TIME || circleHex(head.hash, 32) === "0x" + "0".repeat(64)) circleBlocked("exact_finalized_nonce84_native_consumer_required");
  if (keccak256(consumerWire(t)) !== CONSUMER_HASH) circleBlocked("consumer_wire_hash_changed");
  for (const field of ["l1Fee", "operatorFee", "blobGasUsed", "blobGasPrice"]) if (r[field] !== undefined && circleUint(r[field]) !== 0n) circleBlocked("consumer_unmodeled_fee");
  return { transactionHash: CONSUMER_HASH, blockHash: CONSUMER_BLOCK_HASH as Hex, blockNumberAtomic: "513145262", finalityTag: "finalized", finalityBlockHash: circleHex(head.hash, 32), finalityBlockNumberAtomic: circleUint(head.number).toString(), transactionHashBinding: hashObject(t), receiptHash: hashObject(r), logsHash: hashObject([]), actualFeeAtomic: "426639018000" };
}
export function assertConsumedBurnEvidence(value: ConsumedBurnEvidence, op: CircleOperationV1): void {
  if (!isPlainRecord(value) || !exactKeys(value, ["approvalProof", "consumerProof", "usdcBalanceAtomic"]) || value.usdcBalanceAtomic !== "97924") circleBlocked("consumed_burn_evidence_shape");
  for (const p of [value.approvalProof, value.consumerProof]) if (!isPlainRecord(p) || !exactKeys(p, ["transactionHash", "blockHash", "blockNumberAtomic", "finalityBlockHash", "finalityBlockNumberAtomic", "transactionHashBinding", "finalityTag", "receiptHash", "logsHash", "actualFeeAtomic"]) || p.finalityTag !== "finalized" ||
    ![p.transactionHash, p.blockHash, p.finalityBlockHash].every(x => typeof x === "string" && /^0x[a-f0-9]{64}$/u.test(x)) || ![p.transactionHashBinding, p.receiptHash, p.logsHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) ||
    ![p.blockNumberAtomic, p.finalityBlockNumberAtomic, p.actualFeeAtomic].every(x => typeof x === "string" && /^(?:0|[1-9][0-9]*)$/u.test(x)) || BigInt(p.finalityBlockNumberAtomic) < BigInt(p.blockNumberAtomic) || p.finalityBlockHash === "0x" + "0".repeat(64)) circleBlocked("consumed_burn_proof_shape");
  const c = value.consumerProof;
  if (op.effects[0]!.proof === null || approvalReceiptIdentity(value.approvalProof) !== approvalReceiptIdentity(op.effects[0]!.proof) || c.transactionHash !== CONSUMER_HASH || c.blockHash !== CONSUMER_BLOCK_HASH || c.blockNumberAtomic !== "513145262" || c.logsHash !== hashObject([]) || c.actualFeeAtomic !== "426639018000") circleBlocked("consumed_burn_evidence_binding");
}
/** Historical allowance and principal at the exact approval block remain mandatory. An archive transport is required. */
export async function consumedBurnEvidence(source: CircleRpc, op: CircleOperationV1, afterCleanup = false): Promise<ConsumedBurnEvidence> {
  assertConsumedBurnIdentity(op); await source.identity();
  const original = await sealedBurnEvidence(source, op, async tag => String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag)), "consumed_nonce85");
  const { approvalProof } = original; if (original.usdcBalanceAtomic !== "97924") circleBlocked("consumed_original_principal_changed");
  const consumer = await source.observation(CONSUMER_HASH, "finalized"); if (consumer === null) circleBlocked("consumed_nonce84_not_finalized"); const consumerProof = verifyConsumedNonce(consumer);
  if (getAddress(await recoverTransactionAddress({ serializedTransaction: consumerWire(circleRecord(consumer.transaction)) })) !== CIRCLE_SOURCE_OWNER) circleBlocked("consumer_signature_owner_changed");
  const head = await source.block("finalized"), tag = { blockHash: circleHex(head.hash, 32), requireCanonical: true as const }, nonce = afterCleanup ? 86n : 85n;
  if (circleHex(head.hash, 32) === "0x" + "0".repeat(64) || circleUint(head.number) < 513145262n || circleUint(head.timestamp) < CONSUMER_TIME) circleBlocked("consumed_current_finalized_head_invalid");
  const [latest, pending, finalized, balance, allowance, oldReceipt] = await Promise.all([source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "latest"]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "pending"]), source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, tag]), source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], tag), source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag), source.call("eth_getTransactionReceipt", [SEALED_BURN_HASH])]);
  if ([latest, pending, finalized].some(x => circleUint(x) !== nonce) || circleUint(head.number) < 513145262n || String(balance) !== "97924" || String(allowance) !== (afterCleanup ? "0" : "40100") || oldReceipt !== null) circleBlocked("consumed_nonce_principal_or_allowance_changed");
  for (const h of [{ number: "0x" + BigInt(approvalProof.finalityBlockNumberAtomic).toString(16), hash: approvalProof.finalityBlockHash }, circleRecord(consumer.finalityHead), head]) {
    const reanchor = await source.block(String(h.number));
    if (circleHex(reanchor.hash, 32) !== circleHex(h.hash, 32) || circleUint(reanchor.number) !== circleUint(h.number) || circleUint(reanchor.number) < 513145262n || circleUint(reanchor.timestamp) < CONSUMER_TIME || "timestamp" in h && circleUint(reanchor.timestamp) !== circleUint(h.timestamp)) circleBlocked("consumed_finality_reanchor_changed");
  }
  const evidence = { approvalProof, consumerProof, usdcBalanceAtomic: "97924" }; assertConsumedBurnEvidence(evidence, op); return evidence;
}
