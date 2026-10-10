import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { assertConsumedBurnEvidence } from "./consumed-burn-rpc.js";
import { assertCleanup85Parent, CLEANUP85_HASH, CLEANUP85_MATERIAL, CLEANUP85_ENVELOPE } from "./cleanup85-recovery-store.js";
import { circleBlocked, validateCircleEnvelope } from "./operation-model.js";
import { assertCancellationProofShape } from "./cleanup85-public-proof.js";
export function validateCleanup85RecoveryProof(proof, op) {
    const p = proof.cleanup85Recovery, { proofHash, ...body } = proof;
    assertCleanup85Parent(op, p?.mode === "observed_original");
    if (!isPlainRecord(p) || !exactKeys(p, ["version", "mode", "parentIntentHash", "recoveryBinding", "oldCleanupTransactionHash", "oldCleanupMaterialHash", "oldCleanupEnvelopeHash", "cleanupEnvelope", "cleanupMaterialHash", "cleanupIntentHash", "cleanupProof", "cancellation", "approvalProof", "consumerProof", "usdcBalanceAtomic"]))
        circleBlocked("cleanup85_retirement_proof_shape");
    const r = p.cleanupProof;
    if (!isPlainRecord(r) || !exactKeys(r, ["transactionHash", "blockHash", "blockNumberAtomic", "finalityBlockHash", "finalityBlockNumberAtomic", "transactionHashBinding", "finalityTag", "receiptHash", "logsHash", "actualFeeAtomic"]) || ![r.transactionHash, r.blockHash, r.finalityBlockHash].every(x => typeof x === "string" && /^0x[a-f0-9]{64}$/u.test(x) && x !== "0x" + "0".repeat(64)) ||
        ![r.transactionHashBinding, r.receiptHash, r.logsHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) || ![r.blockNumberAtomic, r.finalityBlockNumberAtomic, r.actualFeeAtomic].every(x => typeof x === "string" && /^(?:0|[1-9][0-9]*)$/u.test(x)) || BigInt(r.finalityBlockNumberAtomic) < BigInt(r.blockNumberAtomic) || BigInt(r.actualFeeAtomic) > BigInt(p.cleanupEnvelope.gasLimitAtomic) * BigInt(p.cleanupEnvelope.maxFeePerGasAtomic))
        circleBlocked("cleanup85_cleanup_receipt_proof_shape");
    if (p.version !== "apn.circle-cleanup85-recovery-proof.v1" || !["observed_original", "cancelled_then_cleanup86"].includes(p.mode) || p.oldCleanupTransactionHash !== CLEANUP85_HASH || p.oldCleanupMaterialHash !== CLEANUP85_MATERIAL || p.oldCleanupEnvelopeHash !== CLEANUP85_ENVELOPE ||
        !/^[a-f0-9]{64}$/u.test(p.parentIntentHash) || proof.intentHash !== p.parentIntentHash || hashObject(body) !== proofHash || proof.originalApprovalHash !== op.effects[0].transactionHash || proof.cleanupTransactionHash !== p.cleanupProof.transactionHash || proof.actualCleanupFeeAtomic !== p.cleanupProof.actualFeeAtomic ||
        p.cleanupProof.finalityTag !== "finalized" || !/^0x[a-f0-9]{64}$/u.test(proof.finalizedBlockHash) || proof.finalizedBlockHash === "0x" + "0".repeat(64) || !/^(?:0|[1-9][0-9]*)$/u.test(proof.finalizedBlockNumberAtomic) || BigInt(proof.finalizedBlockNumberAtomic) < BigInt(p.cleanupProof.blockNumberAtomic) ||
        !/^(?:0|[1-9][0-9]*)$/u.test(proof.actualCleanupFeeAtomic) || BigInt(proof.actualCleanupFeeAtomic) > 15000000000000n || !/^[a-f0-9]{64}$/u.test(p.cleanupMaterialHash))
        circleBlocked("cleanup85_retirement_proof_binding");
    validateCircleEnvelope(p.cleanupEnvelope, "cleanup", 1329, null, "evm-live-seller");
    assertConsumedBurnEvidence({ approvalProof: p.approvalProof, consumerProof: p.consumerProof, usdcBalanceAtomic: p.usdcBalanceAtomic }, op);
    if (p.mode === "observed_original") {
        if (p.cleanupIntentHash !== null || p.recoveryBinding !== null || p.cancellation !== null || p.cleanupEnvelope.envelopeHash !== CLEANUP85_ENVELOPE || p.cleanupMaterialHash !== CLEANUP85_MATERIAL || proof.cleanupTransactionHash !== CLEANUP85_HASH || proof.originalNonceAtomic !== "85" || proof.finalizedNonceAtomic !== "86")
            circleBlocked("cleanup85_observed_original_binding");
    }
    else {
        const c = p.cancellation;
        if (!/^[a-f0-9]{64}$/u.test(String(p.cleanupIntentHash)) || !/^[a-f0-9]{64}$/u.test(String(p.recoveryBinding)) || c === null || proof.originalNonceAtomic !== "86" || proof.finalizedNonceAtomic !== "87" || p.cleanupEnvelope.nonceAtomic !== "86" || p.cleanupProof.transactionHash === CLEANUP85_HASH || p.cleanupEnvelope.envelopeHash === CLEANUP85_ENVELOPE ||
            c.envelope.nonceAtomic !== "85" || c.envelope.valueAtomic !== "1" || c.envelope.data !== "0x" || c.envelope.to !== "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14" || BigInt(c.nativeConsumedAtomic) !== BigInt(c.actualFeeAtomic) + 1n || BigInt(c.nativeConsumedAtomic) > 2000000000000n)
            circleBlocked("cleanup85_cancelled_then_cleanup86_binding");
        assertCancellationProofShape(c);
    }
    if (op.state === "nonce_retired" && op.usage.some((r, i) => r.state !== "failed_confirmed_revert" || r.consumedAtomic !== (i === 1 ? "1116903336000" : i === 3 ? proof.actualCleanupFeeAtomic : "0")))
        circleBlocked("cleanup85_retirement_usage_binding");
}
//# sourceMappingURL=cleanup85-recovery-proof.js.map