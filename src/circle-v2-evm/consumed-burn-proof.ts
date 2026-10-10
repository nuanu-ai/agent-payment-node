import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { assertConsumedBurnIdentity, SEALED_BURN_HASH, SEALED_BURN_MATERIAL } from "./burn-retirement.js";
import { assertConsumedBurnEvidence, type ConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { circleBlocked, validateCircleEnvelope, type CircleOperationV1, type CircleEnvelope } from "./operation-model.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
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
