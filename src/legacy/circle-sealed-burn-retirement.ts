import type { Hex } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { circleBlocked, validateCircleEnvelope, type CircleEnvelope, type CircleOperationV1 } from "../circle-v2-evm/operation-model.js";
import type { CircleReceiptProof } from "../circle-v2-evm/protocol.js";
import type { CircleNonceRetirementProof } from "../circle-v2-evm/nonce-retirement-proof.js";

/**
 * Frozen, read-only validators for the nonce-retirement records of the owner's historical Sei operation
 * 4ee24e45... (burn84 sealed and never sent, retired through the sealed-burn and consumed-burn variants; terminal
 * `nonce_retired` since 0.5.43). The executing recovery code that wrote these intents and proofs is deleted; the v1
 * journal validator and the retirement sidecar store call these only to load what earlier releases wrote. Pure functions:
 * no RPC, no signing, no state writes.
 */
/** One retained Sei operation only; this does not admit new routes or nonce retries. */
export const SEALED_BURN_OPERATION = "4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33";
export const SEALED_BURN_HASH = "0x8d3f33d87653d0413aab7faee5b7884f0fc42a5e1dc7d08ba5cb75c72cc3d541";
export const SEALED_BURN_MATERIAL = "88158eafdfa699730e0d5e800ab974d7fad9a87db88772ce67591cceca7f165a";
export function isSealedBurnRetirement(op: CircleOperationV1): boolean { return op.operationId === SEALED_BURN_OPERATION; }
export function assertSealedBurnRetirement(op: CircleOperationV1): void {
  assertBurnRetirementIdentity(op, "40000000");
}
export function assertConsumedBurnIdentity(op: CircleOperationV1): void {
  assertBurnRetirementIdentity(op, "40040000");
  if (op.effects[0]!.envelope.envelopeHash !== "0962c3adcb8f62eaf5c6f888ef7e2d34589d2d1103c99d3e133bcc47b464264d" || op.effects[1]!.envelope.envelopeHash !== "4eaddbcafbfbad48b0c72d9aa2d5ed959d3bc8985d87de7ddb3981f8fa6dfc79") circleBlocked("consumed_burn_original_envelope_changed");
}
export function isConsumedBurnRetirement(op: CircleOperationV1): boolean { return isSealedBurnRetirement(op) && op.effects[1]?.envelope.maxFeePerGasAtomic === "40040000"; }
function assertBurnRetirementIdentity(op: CircleOperationV1, maxFee: string): void {
  const a = op.effects[0]!, b = op.effects[1]!;
  if (!isSealedBurnRetirement(op) || op.destinationChain !== 1329 || op.destinationProfile !== "evm-live-seller" ||
    a.phase !== "confirmed" || a.transactionHash !== "0x26c833d2146ab758511354ff773fa7f0aece6de36bf433a022cc2ef6c74ae39a" || a.materialHash !== "737a7562b8152338cbeb7319e2c2e3a69985ea5b9fc7a16d090b86b12135f100" ||
    a.envelope.nonceAtomic !== "83" || a.proof === null || a.proof.actualFeeAtomic !== "1116903336000" ||
    b.phase !== "unknown" || b.transactionHash !== SEALED_BURN_HASH || b.materialHash !== SEALED_BURN_MATERIAL || b.proof !== null || b.envelope.nonceAtomic !== "84" || b.envelope.gasLimitAtomic !== "600000" || b.envelope.maxFeePerGasAtomic !== maxFee || b.envelope.maxPriorityFeePerGasAtomic !== "0" ||
    op.source !== null || op.attestation !== null || op.destination !== null || op.effects.some(e => e.role === "mint") || op.usage.length !== 5 ||
    !op.transitions.some(t => t.reason === "burn_material_sealed") || op.transitions.some(t => /^burn_(?:submission|submitted)/u.test(t.reason))) circleBlocked("exact_sealed_sei_burn_retirement_required");
}
const bump = (n: bigint) => (n * 9n + 7n) / 8n;
export function assertSealedBurnReplacement(op: CircleOperationV1, e: CircleEnvelope): void {
  const old = op.effects[1]!.envelope;
  if (e.nonceAtomic !== "84" || BigInt(e.maxFeePerGasAtomic) < 50000000n || BigInt(e.maxFeePerGasAtomic) < bump(BigInt(old.maxFeePerGasAtomic)) ||
    BigInt(e.maxPriorityFeePerGasAtomic) < 1n || BigInt(e.maxPriorityFeePerGasAtomic) < bump(BigInt(old.maxPriorityFeePerGasAtomic))) circleBlocked("sealed_burn_replacement_fee_or_nonce");
}
export interface SealedBurnEvidence { readonly approvalProof: CircleReceiptProof; readonly usdcBalanceAtomic: string; }
export function approvalReceiptIdentity(proof: CircleReceiptProof): string {
  const { finalityTag: _tag, finalityBlockHash: _head, finalityBlockNumberAtomic: _number, ...body } = proof; return hashObject(body);
}
export interface SealedBurnRetirementProof extends SealedBurnEvidence {
  readonly version: "apn.circle-sealed-burn-retirement-proof.v1"; readonly originalBurnHash: string; readonly originalBurnMaterialHash: string;
}
export function assertSealedBurnEvidence(e: SealedBurnEvidence, op: CircleOperationV1): void {
  if (!isPlainRecord(e) || !exactKeys(e, ["approvalProof", "usdcBalanceAtomic"]) || !isPlainRecord(e.approvalProof) ||
    !exactKeys(e.approvalProof, ["transactionHash", "blockHash", "blockNumberAtomic", "finalityBlockHash", "finalityBlockNumberAtomic", "transactionHashBinding", "finalityTag", "receiptHash", "logsHash", "actualFeeAtomic"]) ||
    e.approvalProof.finalityTag !== "finalized" || op.effects[0]!.proof === null || approvalReceiptIdentity(e.approvalProof) !== approvalReceiptIdentity(op.effects[0]!.proof) ||
    !/^0x[a-f0-9]{64}$/u.test(e.approvalProof.finalityBlockHash) || !/^(?:0|[1-9][0-9]*)$/u.test(e.approvalProof.finalityBlockNumberAtomic) || BigInt(e.approvalProof.finalityBlockNumberAtomic) < BigInt(e.approvalProof.blockNumberAtomic) ||
    typeof e.usdcBalanceAtomic !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(e.usdcBalanceAtomic) || BigInt(e.usdcBalanceAtomic) < 40100n) circleBlocked("retirement_burn_evidence_required");
}
export function validateSealedBurnProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void {
  const { proofHash, ...body } = proof, p = proof.sealedBurn, cleanup = op.effects.find(e => e.role === "cleanup");
  assertSealedBurnRetirement(op);
  if (!isPlainRecord(p) || !exactKeys(p, ["version", "originalBurnHash", "originalBurnMaterialHash", "approvalProof", "usdcBalanceAtomic"]) || p.version !== "apn.circle-sealed-burn-retirement-proof.v1" ||
    p.originalBurnHash !== SEALED_BURN_HASH || p.originalBurnMaterialHash !== SEALED_BURN_MATERIAL || hashObject(body) !== proofHash || !/^[a-f0-9]{64}$/u.test(proof.intentHash) ||
    proof.originalApprovalHash !== op.effects[0]!.transactionHash || proof.originalNonceAtomic !== "84" || proof.finalizedNonceAtomic !== "85" || !/^0x[a-f0-9]{64}$/u.test(proof.finalizedBlockHash) ||
    !/^(?:0|[1-9][0-9]*)$/u.test(proof.finalizedBlockNumberAtomic) || !/^(?:0|[1-9][0-9]*)$/u.test(proof.actualCleanupFeeAtomic) || BigInt(proof.actualCleanupFeeAtomic) > 15000000000000n ||
    cleanup?.phase !== "confirmed" || cleanup.proof?.finalityTag !== "finalized" || cleanup.transactionHash !== proof.cleanupTransactionHash || cleanup.proof.actualFeeAtomic !== proof.actualCleanupFeeAtomic ||
    BigInt(proof.finalizedBlockNumberAtomic) < BigInt(cleanup.proof.blockNumberAtomic)) circleBlocked("sealed_burn_retirement_proof_invalid");
  assertSealedBurnEvidence({ approvalProof: p.approvalProof, usdcBalanceAtomic: p.usdcBalanceAtomic }, op); assertSealedBurnReplacement(op, cleanup.envelope);
  if (op.state === "nonce_retired" && op.usage.some((r, i) => r.state !== "failed_confirmed_revert" || r.consumedAtomic !== (i === 1 ? p.approvalProof.actualFeeAtomic : i === 3 ? proof.actualCleanupFeeAtomic : "0"))) circleBlocked("nonce_retirement_usage_charge_invalid");
}
export const CONSUMER_HASH = "0x11f15f7ee8f3fe7956c056c9e3ed0a1286aa16e92329720e701bbf4db120f225" as Hex;
export const CONSUMER_BLOCK_HASH = "0xb61353469b1f3f5459c48755db96a0a38d451654449507afd9a8ba097b65681d";
export interface ConsumedBurnEvidence { readonly approvalProof: CircleReceiptProof; readonly consumerProof: CircleReceiptProof; readonly usdcBalanceAtomic: string; }
export function assertConsumedBurnEvidence(value: ConsumedBurnEvidence, op: CircleOperationV1): void {
  if (!isPlainRecord(value) || !exactKeys(value, ["approvalProof", "consumerProof", "usdcBalanceAtomic"]) || value.usdcBalanceAtomic !== "97924") circleBlocked("consumed_burn_evidence_shape");
  for (const p of [value.approvalProof, value.consumerProof]) if (!isPlainRecord(p) || !exactKeys(p, ["transactionHash", "blockHash", "blockNumberAtomic", "finalityBlockHash", "finalityBlockNumberAtomic", "transactionHashBinding", "finalityTag", "receiptHash", "logsHash", "actualFeeAtomic"]) || p.finalityTag !== "finalized" ||
    ![p.transactionHash, p.blockHash, p.finalityBlockHash].every(x => typeof x === "string" && /^0x[a-f0-9]{64}$/u.test(x)) || ![p.transactionHashBinding, p.receiptHash, p.logsHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) ||
    ![p.blockNumberAtomic, p.finalityBlockNumberAtomic, p.actualFeeAtomic].every(x => typeof x === "string" && /^(?:0|[1-9][0-9]*)$/u.test(x)) || BigInt(p.finalityBlockNumberAtomic) < BigInt(p.blockNumberAtomic) || p.finalityBlockHash === "0x" + "0".repeat(64)) circleBlocked("consumed_burn_proof_shape");
  const c = value.consumerProof;
  if (op.effects[0]!.proof === null || approvalReceiptIdentity(value.approvalProof) !== approvalReceiptIdentity(op.effects[0]!.proof) || c.transactionHash !== CONSUMER_HASH || c.blockHash !== CONSUMER_BLOCK_HASH || c.blockNumberAtomic !== "513145262" || c.logsHash !== hashObject([]) || c.actualFeeAtomic !== "426639018000") circleBlocked("consumed_burn_evidence_binding");
}
export interface ConsumedBurnRetirementProof extends ConsumedBurnEvidence { readonly version: "apn.circle-consumed-burn-retirement-proof.v1"; readonly originalBurnHash: string; readonly originalBurnMaterialHash: string; }
export function assertConsumedCleanup(op: CircleOperationV1, e: CircleEnvelope): void {
  assertConsumedBurnIdentity(op); validateCircleEnvelope(e, "cleanup", op.destinationChain, null, op.destinationProfile);
  if (e.nonceAtomic !== "85" || BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) > 15000000000000n) circleBlocked("consumed_cleanup_nonce_or_full_fee_changed");
}
export function validateConsumedBurnProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void {
  const { proofHash, ...body } = proof, p = proof.consumedBurn, cleanup = op.effects.find(e => e.role === "cleanup"); assertConsumedBurnIdentity(op);
  if (!isPlainRecord(p) || !exactKeys(p, ["version", "originalBurnHash", "originalBurnMaterialHash", "approvalProof", "consumerProof", "usdcBalanceAtomic"]) || p.version !== "apn.circle-consumed-burn-retirement-proof.v1" || p.originalBurnHash !== SEALED_BURN_HASH || p.originalBurnMaterialHash !== SEALED_BURN_MATERIAL ||
    hashObject(body) !== proofHash || !/^[a-f0-9]{64}$/u.test(proof.intentHash) || proof.originalApprovalHash !== op.effects[0]!.transactionHash || proof.originalNonceAtomic !== "85" || proof.finalizedNonceAtomic !== "86" ||
    !/^0x[a-f0-9]{64}$/u.test(proof.finalizedBlockHash) || proof.finalizedBlockHash === "0x" + "0".repeat(64) || !/^(?:0|[1-9][0-9]*)$/u.test(proof.finalizedBlockNumberAtomic) || !/^(?:0|[1-9][0-9]*)$/u.test(proof.actualCleanupFeeAtomic) || BigInt(proof.actualCleanupFeeAtomic) > 15000000000000n ||
    cleanup?.phase !== "confirmed" || cleanup.proof?.finalityTag !== "finalized" || cleanup.transactionHash !== proof.cleanupTransactionHash || cleanup.proof.actualFeeAtomic !== proof.actualCleanupFeeAtomic || BigInt(proof.finalizedBlockNumberAtomic) < BigInt(cleanup.proof.blockNumberAtomic) || BigInt(cleanup.proof.blockNumberAtomic) <= 513145262n) circleBlocked("consumed_burn_retirement_proof_invalid");
  assertConsumedBurnEvidence({ approvalProof: p.approvalProof, consumerProof: p.consumerProof, usdcBalanceAtomic: p.usdcBalanceAtomic }, op); assertConsumedCleanup(op, cleanup.envelope);
  if (op.state === "nonce_retired" && op.usage.some((r, i) => r.state !== "failed_confirmed_revert" || r.consumedAtomic !== (i === 1 ? p.approvalProof.actualFeeAtomic : i === 3 ? proof.actualCleanupFeeAtomic : "0"))) circleBlocked("nonce_retirement_usage_charge_invalid");
}
