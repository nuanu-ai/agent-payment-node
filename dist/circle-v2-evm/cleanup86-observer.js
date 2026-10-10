import { verifyCleanup85Settlement } from "./cleanup85-settlement-authority.js";
import { hashObject } from "../canonical.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./catalog.js";
import { circleBlocked, advanceCircle } from "./operation-model.js";
import { Cleanup85RecoveryStore, CLEANUP85_HASH, CLEANUP85_MATERIAL, CLEANUP85_ENVELOPE } from "./cleanup85-recovery-store.js";
import { Cleanup86Store } from "./cleanup86-store.js";
import { verifyCleanup85PublicWire, cleanup85Reanchor } from "./cleanup85-public-proof.js";
import { freezeCleanup85RetirementProof, replayFrozenCleanup85Retirement } from "./cleanup85-public-reconcile.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { circleHex, circleUint, circleRecord, verifyCircleApproval } from "./protocol.js";
/** No private material read, TTY or financial start. B proof/accounting must be independently
 * verified under reacquired owner locks before this final observer is invoked. */
export async function observeCleanup86(state, op, recovery, intent, cancellation, custody, source, usage, repo, now, accounting) {
    const frozen = await new Cleanup85RecoveryStore(state.root).publicRecord(op, "cleanup86-finalized-proof");
    if (op.state === "nonce_retired" && frozen === null)
        circleBlocked("cleanup86_frozen_proof_missing");
    if (frozen !== null)
        return replayFrozenCleanup85Retirement(state, repo, usage, source, op, frozen, now, accounting);
    const store = new Cleanup86Store(state.root), effect = await store.effect(op, intent);
    if (!await store.claimed(op, intent, "sign"))
        return op;
    const metadata = await custody.publicMetadata(op, intent);
    if (metadata === null)
        return op;
    if (effect?.transactionHash !== null && effect?.transactionHash !== undefined && (effect.transactionHash !== metadata.transactionHash || effect.materialHash !== metadata.materialHash))
        circleBlocked("cleanup86_observed_material_changed");
    // SEND is optional for canonical on-chain observation; its presence still authenticates identity.
    await store.claimed(op, intent, "send");
    const observation = await source.observation(metadata.transactionHash, "finalized");
    if (observation === null)
        return op;
    const rawTransaction = await verifyCleanup85PublicWire(observation, intent.envelope, metadata.transactionHash);
    if (hashObject({ version: "apn.circle-cleanup86-material.v1", intentHash: intent.intentHash, recoveryBinding: intent.recoveryBinding, envelopeHash: intent.envelope.envelopeHash, rawTransaction, transactionHash: metadata.transactionHash }) !== metadata.materialHash)
        circleBlocked("cleanup86_public_material_hash_changed");
    const receipt = circleRecord(observation.receipt), head = circleRecord(observation.finalityHead), tag = { blockHash: circleHex(receipt.blockHash, 32), requireCanonical: true };
    const cleanupProof = verifyCircleApproval(observation, true, String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag)));
    if (BigInt(cleanupProof.actualFeeAtomic) > 15000000000000n || String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], tag)) !== "97924" || await source.call("eth_getTransactionReceipt", [CLEANUP85_HASH]) !== null)
        circleBlocked("cleanup86_receipt_principal_or_old_cleanup_changed");
    const evidence = await consumedBurnEvidence(source, op, "cleanup86");
    await cleanup85Reanchor(source, observation);
    const body = { intentHash: recovery.parentIntentHash, originalApprovalHash: op.effects[0].transactionHash, originalNonceAtomic: "86", finalizedNonceAtomic: "87", finalizedBlockHash: circleHex(head.hash, 32), finalizedBlockNumberAtomic: circleUint(head.number).toString(), cleanupTransactionHash: metadata.transactionHash, actualCleanupFeeAtomic: cleanupProof.actualFeeAtomic,
        cleanup85Recovery: { version: "apn.circle-cleanup85-recovery-proof.v1", mode: "cancelled_then_cleanup86", parentIntentHash: recovery.parentIntentHash, recoveryBinding: recovery.recoveryBinding, oldCleanupTransactionHash: CLEANUP85_HASH, oldCleanupMaterialHash: CLEANUP85_MATERIAL, oldCleanupEnvelopeHash: CLEANUP85_ENVELOPE, cleanupEnvelope: intent.envelope, cleanupMaterialHash: metadata.materialHash, cleanupIntentHash: intent.intentHash, cleanupProof, cancellation, ...evidence } };
    const proof = await freezeCleanup85RetirementProof(new Cleanup85RecoveryStore(state.root), source, op, "cleanup86-finalized-proof", { ...body, proofHash: hashObject(body) });
    const authority = await verifyCleanup85Settlement(state, op, proof, source, accounting);
    const rows = await usage.closeCleanup85Recovery(op, proof, authority), next = advanceCircle(op, { usage: rows, usageFinalized: true, residualAllowanceAtomic: "0", state: "nonce_retired", terminal: true, nonceRetirement: proof }, "cleanup86_finalized_retirement_original_unknown_preserved", now());
    await repo.save(next);
    return next;
}
//# sourceMappingURL=cleanup86-observer.js.map