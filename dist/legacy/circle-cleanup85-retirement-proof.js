import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { validateEvmNativeCustody } from "../evm-native-custody.js";
import { circleBlocked, validateCircleEnvelope } from "../circle-v2-evm/operation-model.js";
import { assertConsumedBurnEvidence, assertConsumedBurnIdentity } from "./circle-sealed-burn-retirement.js";
/**
 * Frozen, read-only validator of the `cleanup85Recovery` subproof in the terminal nonce-retirement proof of the owner's
 * historical Sei operation 4ee24e45... (cleanup85 left unknown, a distinct 1-wei native cancellation at nonce 85, then
 * a zero approval at nonce 86). The cleanup85/cleanup86 controllers that wrote it are deleted; the v1 journal
 * validator calls this only to load the record that 0.5.43 wrote. Pure functions: no RPC, no signing, no state writes.
 */
/** The source owner the frozen records name (the v1 catalog constant of 0.5.43, copied so the reader never moves). */
const SEI_SOURCE_OWNER = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
export const CLEANUP85_HASH = "0x24cb1b6244a30ca2a829b4f561c907565d49aad806735137e3160ae0f7f03b95";
export const CLEANUP85_MATERIAL = "737b794790d7867a18e90d15033f72c1177cc5204a7b2cff699687cb4aa03468";
export const CLEANUP85_ENVELOPE = "62e62f220a1afbf65889ab0edfbc090c3b67bc4d5f9b161ec8e33dc8137a3583";
export function assertCleanup85Parent(op, observedOriginal = false) {
    assertConsumedBurnIdentity(op);
    const e = op.effects.find(x => x.role === "cleanup");
    if (op.effects.length !== 3 || e?.phase !== "unknown" || e.transactionHash !== CLEANUP85_HASH || e.materialHash !== CLEANUP85_MATERIAL || e.envelope.envelopeHash !== CLEANUP85_ENVELOPE || e.envelope.nonceAtomic !== "85" || e.proof !== null ||
        !observedOriginal && op.transitions.some(t => /^cleanup_(?:submission|submitted)/u.test(t.reason)) || !op.transitions.some(t => t.reason === "cleanup_material_sealed"))
        circleBlocked("exact_unknown_cleanup85_parent_required");
}
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
export function assertCancellationProofShape(proof) {
    if (!isPlainRecord(proof) || !exactKeys(proof, ["version", "requestBinding", "operationId", "fingerprint", "materialHash", "transactionHash", "envelope", "sourceCustody", "recipientCustody", "observation", "actualFeeAtomic", "nativeReservationId", "nativeOutcomeDigest", "nativeConsumedAtomic", "proofHash"]) || !isPlainRecord(proof.envelope) || !exactKeys(proof.envelope, ["chainId", "from", "to", "nonceAtomic", "valueAtomic", "data", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "envelopeHash"]) ||
        ![proof.requestBinding, proof.operationId, proof.fingerprint, proof.materialHash, proof.nativeReservationId, proof.nativeOutcomeDigest, proof.proofHash, proof.envelope.envelopeHash].every(x => typeof x === "string" && /^[a-f0-9]{64}$/u.test(x)) ||
        ![proof.actualFeeAtomic, proof.nativeConsumedAtomic, proof.envelope.gasLimitAtomic, proof.envelope.maxFeePerGasAtomic, proof.envelope.maxPriorityFeePerGasAtomic].every(x => typeof x === "string" && /^(?:0|[1-9][0-9]*)$/u.test(x)) || !isPlainRecord(proof.observation) || !exactKeys(proof.observation, ["transaction", "receipt", "canonicalBlock", "recheckedBlock", "finalityHead", "chainId", "finalityTag"]))
        circleBlocked("cleanup85_cancellation_proof_shape");
    const { proofHash, ...body } = proof, e = proof.envelope;
    const { envelopeHash, ...envelopeBody } = e;
    if (proof.version !== "apn.circle-cleanup85-native-cancellation-proof.v1" || hashObject(body) !== proofHash || e.chainId !== 42161 || e.from !== SEI_SOURCE_OWNER || e.to !== "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14" || e.nonceAtomic !== "85" || e.valueAtomic !== "1" || e.data !== "0x" ||
        hashObject(envelopeBody) !== envelopeHash || BigInt(e.gasLimitAtomic) < 21000n || BigInt(e.maxFeePerGasAtomic) < 45000000n || BigInt(e.maxPriorityFeePerGasAtomic) < 1n || BigInt(e.maxPriorityFeePerGasAtomic) > BigInt(e.maxFeePerGasAtomic) || BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) + 1n > 2000000000000n || BigInt(proof.nativeConsumedAtomic) !== BigInt(proof.actualFeeAtomic) + 1n || BigInt(proof.nativeConsumedAtomic) > BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) + 1n)
        circleBlocked("cleanup85_cancellation_proof_binding");
    validateEvmNativeCustody(proof.sourceCustody);
    validateEvmNativeCustody(proof.recipientCustody);
    if (proof.sourceCustody.walletAddress !== e.from || proof.recipientCustody.walletAddress !== e.to)
        circleBlocked("cleanup85_cancellation_custody_changed");
}
//# sourceMappingURL=circle-cleanup85-retirement-proof.js.map