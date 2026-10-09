import { verifyCleanup85Settlement } from "./cleanup85-settlement-authority.js";
import type { Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { hashObject } from "../canonical.js";
import type { Cleanup85CancellationProof } from "../circle-cleanup85-cancellation-contract.js";
import type { StateStore } from "../state.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./catalog.js";
import { circleBlocked, advanceCircle, type CircleOperationV1 } from "./operation-model.js";
import { Cleanup85RecoveryStore, CLEANUP85_HASH, CLEANUP85_MATERIAL, CLEANUP85_ENVELOPE, type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { Cleanup86Store, type Cleanup86Intent } from "./cleanup86-store.js";
import type { Cleanup86Custody } from "./cleanup86-custody.js";
import { verifyCleanup85PublicWire, cleanup85Reanchor } from "./cleanup85-public-proof.js";
import { freezeCleanup85RetirementProof, replayFrozenCleanup85Retirement } from "./cleanup85-public-reconcile.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { circleHex, circleUint, circleRecord, verifyCircleApproval } from "./protocol.js";
import type { CircleRpc } from "./rpc.js";
import type { CircleUsage } from "./usage.js";
import type { CircleRepository } from "./repository.js";
/** No private material read, TTY or financial start. B proof/accounting must be independently
 * verified under reacquired owner locks before this final observer is invoked. */
export async function observeCleanup86(state: StateStore, op: CircleOperationV1, recovery: Cleanup85RecoveryIntent, intent: Cleanup86Intent, cancellation: Cleanup85CancellationProof, custody: Cleanup86Custody, source: CircleRpc, usage: CircleUsage, repo: CircleRepository, now: () => number, accounting: (state: StateStore, request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof) => Promise<void>): Promise<CircleOperationV1> {
  const frozen = await new Cleanup85RecoveryStore(state.root).publicRecord(op, "cleanup86-finalized-proof");
  if (op.state === "nonce_retired" && frozen === null) circleBlocked("cleanup86_frozen_proof_missing");
  if (frozen !== null) return replayFrozenCleanup85Retirement(state, repo, usage, source, op, frozen as import("./nonce-retirement-proof.js").CircleNonceRetirementProof, now, accounting);
  const store = new Cleanup86Store(state.root), effect = await store.effect(op, intent);
  if (!await store.claimed(op, intent, "sign")) return op;
  const metadata = await custody.publicMetadata(op, intent); if (metadata === null) return op;
  if (effect?.transactionHash !== null && effect?.transactionHash !== undefined && (effect.transactionHash !== metadata.transactionHash || effect.materialHash !== metadata.materialHash)) circleBlocked("cleanup86_observed_material_changed");
  // SEND is optional for canonical on-chain observation; its presence still authenticates identity.
  await store.claimed(op, intent, "send");
  const observation = await source.observation(metadata.transactionHash, "finalized"); if (observation === null) return op;
  const rawTransaction = await verifyCleanup85PublicWire(observation, intent.envelope, metadata.transactionHash);
  if (hashObject({ version: "apn.circle-cleanup86-material.v1", intentHash: intent.intentHash, recoveryBinding: intent.recoveryBinding, envelopeHash: intent.envelope.envelopeHash, rawTransaction, transactionHash: metadata.transactionHash }) !== metadata.materialHash) circleBlocked("cleanup86_public_material_hash_changed");
  const receipt = circleRecord(observation.receipt), head = circleRecord(observation.finalityHead), tag = { blockHash: circleHex(receipt.blockHash, 32), requireCanonical: true as const };
  const cleanupProof = verifyCircleApproval(observation, true, String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag)));
  if (BigInt(cleanupProof.actualFeeAtomic) > 15000000000000n || String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], tag)) !== "97924" || await source.call("eth_getTransactionReceipt", [CLEANUP85_HASH]) !== null) circleBlocked("cleanup86_receipt_principal_or_old_cleanup_changed");
  const evidence = await consumedBurnEvidence(source, op, "cleanup86"); await cleanup85Reanchor(source, observation);
  const body = { intentHash: recovery.parentIntentHash, originalApprovalHash: op.effects[0]!.transactionHash!, originalNonceAtomic: "86", finalizedNonceAtomic: "87", finalizedBlockHash: circleHex(head.hash, 32), finalizedBlockNumberAtomic: circleUint(head.number).toString(), cleanupTransactionHash: metadata.transactionHash, actualCleanupFeeAtomic: cleanupProof.actualFeeAtomic,
    cleanup85Recovery: { version: "apn.circle-cleanup85-recovery-proof.v1" as const, mode: "cancelled_then_cleanup86" as const, parentIntentHash: recovery.parentIntentHash, recoveryBinding: recovery.recoveryBinding, oldCleanupTransactionHash: CLEANUP85_HASH, oldCleanupMaterialHash: CLEANUP85_MATERIAL, oldCleanupEnvelopeHash: CLEANUP85_ENVELOPE, cleanupEnvelope: intent.envelope, cleanupMaterialHash: metadata.materialHash, cleanupIntentHash: intent.intentHash, cleanupProof, cancellation, ...evidence } } as const;
  const proof = await freezeCleanup85RetirementProof(new Cleanup85RecoveryStore(state.root), source, op, "cleanup86-finalized-proof", { ...body, proofHash: hashObject(body) });
  const authority = await verifyCleanup85Settlement(state, op, proof, source, accounting);
  const rows = await usage.closeCleanup85Recovery(op, proof, authority), next = advanceCircle(op, { usage: rows, usageFinalized: true, residualAllowanceAtomic: "0", state: "nonce_retired", terminal: true, nonceRetirement: proof }, "cleanup86_finalized_retirement_original_unknown_preserved", now());
  await repo.save(next); return next;
}
