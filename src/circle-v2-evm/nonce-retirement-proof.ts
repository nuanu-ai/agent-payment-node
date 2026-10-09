import { validateSealedBurnProof, type SealedBurnRetirementProof } from "./burn-retirement-proof.js";
import { isSealedBurnRetirement } from "./burn-retirement.js";
import { exactKeys, isPlainRecord, hashObject } from "../canonical.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
export interface CircleNonceRetirementProof { readonly sealedBurn?: SealedBurnRetirementProof; readonly intentHash: string; readonly originalApprovalHash: string;
  readonly originalNonceAtomic: string; readonly finalizedNonceAtomic: string; readonly finalizedBlockHash: string;
  readonly finalizedBlockNumberAtomic: string; readonly cleanupTransactionHash: string; readonly actualCleanupFeeAtomic: string; readonly proofHash: string; }
export function validateCircleNonceRetirementProof(proof: CircleNonceRetirementProof, op: CircleOperationV1): void {
  if (!isPlainRecord(proof) || !exactKeys(proof, ["intentHash", "originalApprovalHash", "originalNonceAtomic", "finalizedNonceAtomic", "finalizedBlockHash", "finalizedBlockNumberAtomic", "cleanupTransactionHash", "actualCleanupFeeAtomic", "proofHash", ...(isSealedBurnRetirement(op) ? ["sealedBurn"] : [])])) circleBlocked("nonce_retirement_proof_shape");
  if (isSealedBurnRetirement(op)) { validateSealedBurnProof(proof, op); return; }
  const { proofHash, ...body } = proof, cleanup = op.effects.find(x => x.role === "cleanup"), approval = op.effects[0]!, burn = op.effects[1]!;
  if (op.destinationChain !== 143 || op.destinationProfile !== "default" || op.source !== null || op.attestation !== null || op.destination !== null || approval.proof !== null || approval.materialHash === null || burn.materialHash !== null || burn.transactionHash !== null || burn.proof !== null ||
    !/^(?:0|[1-9][0-9]*)$/u.test(proof.actualCleanupFeeAtomic) || BigInt(proof.actualCleanupFeeAtomic) > 15000000000000n ||
    hashObject(body) !== proofHash || !/^[a-f0-9]{64}$/u.test(proof.intentHash) || proof.originalApprovalHash !== approval.transactionHash || proof.originalNonceAtomic !== approval.envelope.nonceAtomic ||
    !/^(?:0|[1-9][0-9]*)$/u.test(proof.finalizedNonceAtomic) || BigInt(proof.finalizedNonceAtomic) <= BigInt(proof.originalNonceAtomic) ||
    !/^0x[a-f0-9]{64}$/u.test(proof.finalizedBlockHash) || !/^(?:0|[1-9][0-9]*)$/u.test(proof.finalizedBlockNumberAtomic) ||
    cleanup?.phase !== "confirmed" || cleanup.proof?.finalityTag !== "finalized" || cleanup.transactionHash !== proof.cleanupTransactionHash || cleanup.proof.actualFeeAtomic !== proof.actualCleanupFeeAtomic || cleanup.envelope.nonceAtomic !== proof.originalNonceAtomic ||
    BigInt(proof.finalizedBlockNumberAtomic) < BigInt(cleanup.proof.blockNumberAtomic) || approval.phase !== "unknown" || burn.phase !== "prepared") circleBlocked("nonce_retirement_proof_invalid");
  if (op.state === "nonce_retired" && op.usage.some((row, i) => row.state !== "failed_confirmed_revert" || row.consumedAtomic !== (i === 3 ? proof.actualCleanupFeeAtomic : "0"))) circleBlocked("nonce_retirement_usage_charge_invalid");
}

