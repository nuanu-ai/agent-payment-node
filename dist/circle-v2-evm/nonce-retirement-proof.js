import { validateCleanup85RecoveryProof } from "./cleanup85-recovery-proof.js";
import { validateConsumedBurnProof } from "./consumed-burn-proof.js";
import { validateSealedBurnProof } from "./burn-retirement-proof.js";
import { isSealedBurnRetirement, isConsumedBurnRetirement } from "./burn-retirement.js";
import { exactKeys, isPlainRecord, hashObject } from "../canonical.js";
import { circleBlocked } from "./operation-model.js";
export function validateCircleNonceRetirementProof(proof, op) {
    if (!isPlainRecord(proof) || !exactKeys(proof, ["intentHash", "originalApprovalHash", "originalNonceAtomic", "finalizedNonceAtomic", "finalizedBlockHash", "finalizedBlockNumberAtomic", "cleanupTransactionHash", "actualCleanupFeeAtomic", "proofHash", ...(proof.cleanup85Recovery !== undefined ? ["cleanup85Recovery"] : isConsumedBurnRetirement(op) ? ["consumedBurn"] : isSealedBurnRetirement(op) ? ["sealedBurn"] : [])]))
        circleBlocked("nonce_retirement_proof_shape");
    if (proof.cleanup85Recovery !== undefined) {
        validateCleanup85RecoveryProof(proof, op);
        return;
    }
    if (isConsumedBurnRetirement(op)) {
        validateConsumedBurnProof(proof, op);
        return;
    }
    if (isSealedBurnRetirement(op)) {
        validateSealedBurnProof(proof, op);
        return;
    }
    const { proofHash, ...body } = proof, cleanup = op.effects.find(x => x.role === "cleanup"), approval = op.effects[0], burn = op.effects[1];
    if (op.destinationChain !== 143 || op.destinationProfile !== "default" || op.source !== null || op.attestation !== null || op.destination !== null || approval.proof !== null || approval.materialHash === null || burn.materialHash !== null || burn.transactionHash !== null || burn.proof !== null ||
        !/^(?:0|[1-9][0-9]*)$/u.test(proof.actualCleanupFeeAtomic) || BigInt(proof.actualCleanupFeeAtomic) > 15000000000000n ||
        hashObject(body) !== proofHash || !/^[a-f0-9]{64}$/u.test(proof.intentHash) || proof.originalApprovalHash !== approval.transactionHash || proof.originalNonceAtomic !== approval.envelope.nonceAtomic ||
        !/^(?:0|[1-9][0-9]*)$/u.test(proof.finalizedNonceAtomic) || BigInt(proof.finalizedNonceAtomic) <= BigInt(proof.originalNonceAtomic) ||
        !/^0x[a-f0-9]{64}$/u.test(proof.finalizedBlockHash) || !/^(?:0|[1-9][0-9]*)$/u.test(proof.finalizedBlockNumberAtomic) ||
        cleanup?.phase !== "confirmed" || cleanup.proof?.finalityTag !== "finalized" || cleanup.transactionHash !== proof.cleanupTransactionHash || cleanup.proof.actualFeeAtomic !== proof.actualCleanupFeeAtomic || cleanup.envelope.nonceAtomic !== proof.originalNonceAtomic ||
        BigInt(proof.finalizedBlockNumberAtomic) < BigInt(cleanup.proof.blockNumberAtomic) || approval.phase !== "unknown" || burn.phase !== "prepared")
        circleBlocked("nonce_retirement_proof_invalid");
    if (op.state === "nonce_retired" && op.usage.some((row, i) => row.state !== "failed_confirmed_revert" || row.consumedAtomic !== (i === 3 ? proof.actualCleanupFeeAtomic : "0")))
        circleBlocked("nonce_retirement_usage_charge_invalid");
}
//# sourceMappingURL=nonce-retirement-proof.js.map