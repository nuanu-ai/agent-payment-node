import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { assertSealedBurnRetirement, assertSealedBurnReplacement, SEALED_BURN_HASH, SEALED_BURN_MATERIAL } from "./burn-retirement.js";
import { approvalReceiptIdentity, type SealedBurnEvidence } from "./burn-retirement-rpc.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
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
