import { verifyCleanup85Settlement } from "./cleanup85-settlement-authority.js";
import { hashObject } from "../canonical.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./catalog.js";
import { CircleRepository } from "./repository.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, assertCleanup85Parent, CLEANUP85_HASH, CLEANUP85_MATERIAL, CLEANUP85_ENVELOPE } from "./cleanup85-recovery-store.js";
import { verifyCleanup85PublicWire, cleanup85Reanchor } from "./cleanup85-public-proof.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { circleHex, circleRecord, circleUint, verifyCircleApproval } from "./protocol.js";
import { advanceCircle, circleBlocked } from "./operation-model.js";
import { currentCircleDeployments } from "./rpc.js";
import { validateCircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import { approvalReceiptIdentity } from "./burn-retirement-rpc.js";
/** Observation only: a canonical public receipt may establish an actual effect without inventing SEND.
 * Historical policy authority and original UNKNOWN effect remain unchanged; no current policy grant. */
export async function reconcileOriginalCleanup85(state, repo, usage, source, destination, input, now) {
    assertCleanup85Parent(input, true);
    const frozen = await new Cleanup85RecoveryStore(state.root).publicRecord(input, "observed-original-proof");
    if (input.state === "nonce_retired" && frozen === null)
        circleBlocked("cleanup85_frozen_proof_missing");
    if (frozen !== null)
        return replayFrozenCleanup85Retirement(state, repo, usage, source, input, frozen, now);
    const old = new CircleNonceRetirementStore(state.root), parent = await old.intent(input);
    if (parent === null || !await old.hasClaim(input, "sign") || parent.cleanupEnvelope.envelopeHash !== CLEANUP85_ENVELOPE)
        circleBlocked("cleanup85_original_signed_intent_required");
    await new Cleanup85RecoveryStore(state.root).assertRetainedMaterialHeaders(input, true);
    const observation = await source.observation(CLEANUP85_HASH, "finalized");
    if (observation === null)
        return input;
    const cleanup = input.effects.find(e => e.role === "cleanup");
    const rawTransaction = await verifyCleanup85PublicWire(observation, cleanup.envelope, CLEANUP85_HASH);
    if (hashObject({ schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: input.operationId, role: "cleanup", fingerprint: input.fingerprint, envelopeHash: cleanup.envelope.envelopeHash, rawTransaction, transactionHash: CLEANUP85_HASH }) !== CLEANUP85_MATERIAL)
        circleBlocked("cleanup85_public_material_hash_changed");
    await currentCircleDeployments(source, destination, 1329);
    const receipt = circleRecord(observation.receipt), head = circleRecord(observation.finalityHead), tag = String(receipt.blockNumber);
    const cleanupProof = verifyCircleApproval(observation, true, String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag)));
    const evidence = await consumedBurnEvidence(source, input, true);
    if (String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], tag)) !== "97924")
        circleBlocked("cleanup85_receipt_principal_changed");
    await cleanup85Reanchor(source, observation);
    const body = { intentHash: parent.intentHash, originalApprovalHash: input.effects[0].transactionHash, originalNonceAtomic: "85", finalizedNonceAtomic: "86", finalizedBlockHash: circleHex(head.hash, 32), finalizedBlockNumberAtomic: circleUint(head.number).toString(), cleanupTransactionHash: CLEANUP85_HASH, actualCleanupFeeAtomic: cleanupProof.actualFeeAtomic,
        cleanup85Recovery: { version: "apn.circle-cleanup85-recovery-proof.v1", mode: "observed_original", parentIntentHash: parent.intentHash, recoveryBinding: null, oldCleanupTransactionHash: CLEANUP85_HASH, oldCleanupMaterialHash: CLEANUP85_MATERIAL, oldCleanupEnvelopeHash: CLEANUP85_ENVELOPE, cleanupEnvelope: cleanup.envelope, cleanupMaterialHash: CLEANUP85_MATERIAL, cleanupIntentHash: null, cleanupProof, cancellation: null, ...evidence } };
    const proof = await freezeCleanup85RetirementProof(new Cleanup85RecoveryStore(state.root), source, input, "observed-original-proof", { ...body, proofHash: hashObject(body) });
    // Publish exact public receipt evidence before any ledger transition; create-only replay checks preserve provenance.
    const authority = await verifyCleanup85Settlement(state, input, proof, source);
    const rows = await usage.closeCleanup85Recovery(input, proof, authority), next = advanceCircle(input, { usage: rows, usageFinalized: true, residualAllowanceAtomic: "0", state: "nonce_retired", terminal: true, nonceRetirement: proof }, "cleanup85_observed_onchain_original_finalized_retirement", now());
    await repo.save(next);
    return next;
}
/** A crash after any ledger row must resume with the exact published outcome digest.
 * Fresh full RPC verification occurs before this call; moving FINALIZED heads do not rewrite proof. */
export async function freezeCleanup85RetirementProof(store, source, op, suffix, fresh) {
    validateCircleNonceRetirementProof(fresh, op);
    const saved = await store.publicRecord(op, suffix);
    if (saved === null) {
        await store.createPublicRecord(op, suffix, fresh);
        return fresh;
    }
    const proof = saved;
    validateCircleNonceRetirementProof(proof, op);
    const a = proof.cleanup85Recovery, b = fresh.cleanup85Recovery;
    if (proof.intentHash !== fresh.intentHash || proof.originalNonceAtomic !== fresh.originalNonceAtomic || proof.finalizedNonceAtomic !== fresh.finalizedNonceAtomic || proof.cleanupTransactionHash !== fresh.cleanupTransactionHash || proof.actualCleanupFeeAtomic !== fresh.actualCleanupFeeAtomic ||
        a.mode !== b.mode || a.recoveryBinding !== b.recoveryBinding || hashObject(a.cleanupEnvelope) !== hashObject(b.cleanupEnvelope) || a.cleanupMaterialHash !== b.cleanupMaterialHash || a.cleanupIntentHash !== b.cleanupIntentHash || hashObject(a.cancellation) !== hashObject(b.cancellation) ||
        ["cleanupProof", "approvalProof", "consumerProof"].some(k => approvalReceiptIdentity(a[k]) !== approvalReceiptIdentity(b[k])))
        circleBlocked("cleanup85_frozen_receipt_identity_changed");
    for (const p of [a.cleanupProof, a.approvalProof, a.consumerProof]) {
        const head = await source.block("0x" + BigInt(p.finalityBlockNumberAtomic).toString(16));
        if (circleHex(head.hash, 32) !== p.finalityBlockHash || circleUint(head.number).toString() !== p.finalityBlockNumberAtomic)
            circleBlocked("cleanup85_frozen_finality_reorg");
    }
    const head = await source.block("0x" + BigInt(proof.finalizedBlockNumberAtomic).toString(16));
    if (circleHex(head.hash, 32) !== proof.finalizedBlockHash || circleUint(head.number).toString() !== proof.finalizedBlockNumberAtomic)
        circleBlocked("cleanup85_frozen_finality_reorg");
    return proof;
}
/** Historical replay performs canonical verification even when the journal is terminal.
 * Partial ledger repair reuses exact published proof and outcome digests, without new effects. */
export async function replayFrozenCleanup85Retirement(state, repo, usage, source, op, proof, now, accounting) {
    const authority = await verifyCleanup85Settlement(state, op, proof, source, accounting), rows = await usage.closeCleanup85Recovery(op, proof, authority);
    if (op.state === "nonce_retired") {
        if (hashObject(rows) !== hashObject(op.usage))
            circleBlocked("cleanup85_terminal_ledger_changed");
        return op;
    }
    const next = advanceCircle(op, { usage: rows, usageFinalized: true, residualAllowanceAtomic: "0", state: "nonce_retired", terminal: true, nonceRetirement: proof }, "cleanup85_frozen_finalized_retirement_reconciled", now());
    await repo.save(next);
    return next;
}
//# sourceMappingURL=cleanup85-public-reconcile.js.map