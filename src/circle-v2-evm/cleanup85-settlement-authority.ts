import { canonicalJson } from "../canonical.js";
import { verifyCleanup85HistoricalAcceptance } from "./cleanup85-historical-acceptance.js";
import { hashObject } from "../canonical.js";
import type { StateStore } from "../state.js";
import type { Cleanup85CancellationProof, Cleanup85CancellationRequest } from "../circle-cleanup85-cancellation-contract.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER } from "./catalog.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest, CLEANUP85_MATERIAL, CLEANUP85_HASH } from "./cleanup85-recovery-store.js";
import { Cleanup86Store } from "./cleanup86-store.js";
import { Cleanup86Custody } from "./cleanup86-custody.js";
import { validateCleanup85RecoveryProof } from "./cleanup85-recovery-proof.js";
import { verifyCleanup85PublicWire, verifyCancellationPublic, cleanup85Reanchor } from "./cleanup85-public-proof.js";
import { consumedBurnEvidence } from "./consumed-burn-rpc.js";
import { approvalReceiptIdentity } from "./burn-retirement-rpc.js";
import { circleHex, circleRecord, circleUint, verifyCircleApproval } from "./protocol.js";
import type { CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import type { CircleRpc } from "./rpc.js";
/** Public JSON is evidence, never authority to release held assets. Only this live canonical
 * verifier can issue the private, operation/root/proof-bound one-use settlement capability. */
export interface VerifiedCleanup85Settlement { readonly kind: "verified-cleanup85-settlement"; }
const verified = new WeakMap<VerifiedCleanup85Settlement, { root: string; operationId: string; fingerprint: string; proofHash: string }>();
export function consumeCleanup85Settlement(token: VerifiedCleanup85Settlement, state: StateStore, op: CircleOperationV1, proof: CircleNonceRetirementProof): void {
  const body = verified.get(token); verified.delete(token);
  if (body === undefined || body.root !== state.root || body.operationId !== op.operationId || body.fingerprint !== op.fingerprint || body.proofHash !== proof.proofHash) circleBlocked("private_cleanup85_settlement_required");
}
export async function verifyCleanup85Settlement(state: StateStore, op: CircleOperationV1, proof: CircleNonceRetirementProof, source: CircleRpc, accounting?: (state: StateStore, request: Cleanup85CancellationRequest, proof: Cleanup85CancellationProof) => Promise<void>): Promise<VerifiedCleanup85Settlement> {
  validateCleanup85RecoveryProof(proof, op); const p = proof.cleanup85Recovery!, old = new CircleNonceRetirementStore(state.root), parent = await old.intent(op), recoveryStore = new Cleanup85RecoveryStore(state.root);
  if (parent === null || parent.intentHash !== p.parentIntentHash || !await old.hasClaim(op, "sign")) circleBlocked("cleanup85_settlement_original_sign_required");
  await old.hasClaim(op, "send"); await recoveryStore.assertRetainedMaterialHeaders(op, p.mode === "observed_original");
  if (p.mode === "cancelled_then_cleanup86") {
    const recovery = await recoveryStore.load(op, parent); if (recovery === null || p.recoveryBinding !== recovery.recoveryBinding || p.cancellation === null || accounting === undefined) circleBlocked("cleanup86_settlement_native_verifier_required");
    const store = new Cleanup86Store(state.root), intent = await store.intent(op, recovery);
    if (intent === null || intent.intentHash !== p.cleanupIntentHash || hashObject(intent.envelope) !== hashObject(p.cleanupEnvelope) || intent.cancellationProofHash !== p.cancellation.proofHash || !await store.claimed(op, intent, "sign")) circleBlocked("cleanup86_settlement_intent_sign_required");
    await store.claimed(op, intent, "send");
    // This custody facade reads the retained public envelope header only, never a wrapping key.
    const metadata = await new Cleanup86Custody(state, { load: async () => { throw new Error("public settlement cannot load custody"); }, create: async () => { throw new Error("public settlement cannot create custody"); } }).publicMetadata(op, intent);
    if (metadata?.transactionHash !== proof.cleanupTransactionHash || metadata.materialHash !== p.cleanupMaterialHash) circleBlocked("cleanup86_settlement_material_header_changed");
    const request = cleanup85CancellationRequest(recovery);
    if (p.cancellation.requestBinding !== hashObject(request) || hashObject(p.cancellation.sourceCustody) !== hashObject(recovery.sourceCustody) || hashObject(p.cancellation.recipientCustody) !== hashObject(recovery.recipientCustody)) circleBlocked("cleanup86_settlement_cancellation_binding");
    if (await source.call("eth_getTransactionReceipt", [CLEANUP85_HASH]) !== null) circleBlocked("cleanup86_original_receipt_requires_observer");
    await verifyCancellationPublic(source, p.cancellation); await accounting(state, request, p.cancellation);
  }
  const observation = await source.observation(circleHex(proof.cleanupTransactionHash, 32), "finalized"); if (observation === null) circleBlocked("cleanup85_settlement_canonical_receipt_required");
  const rawTransaction = await verifyCleanup85PublicWire(observation, p.cleanupEnvelope, proof.cleanupTransactionHash), material = p.mode === "observed_original"
    ? hashObject({ schemaVersion: "apn.circle-v2-evm-effect.v1", operationId: op.operationId, role: "cleanup", fingerprint: op.fingerprint, envelopeHash: p.cleanupEnvelope.envelopeHash, rawTransaction, transactionHash: proof.cleanupTransactionHash })
    : hashObject({ version: "apn.circle-cleanup86-material.v1", intentHash: p.cleanupIntentHash, recoveryBinding: p.recoveryBinding, envelopeHash: p.cleanupEnvelope.envelopeHash, rawTransaction, transactionHash: proof.cleanupTransactionHash });
  if (material !== p.cleanupMaterialHash || p.mode === "observed_original" && material !== CLEANUP85_MATERIAL) circleBlocked("cleanup85_settlement_public_material_changed");
  const receipt = circleRecord(observation.receipt), tag = { blockHash: circleHex(receipt.blockHash, 32), requireCanonical: true as const };
  const fresh = verifyCircleApproval(observation, true, String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag)));
  if (approvalReceiptIdentity(fresh) !== approvalReceiptIdentity(p.cleanupProof) || String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], tag)) !== "97924") circleBlocked("cleanup85_settlement_receipt_state_changed");
  const frozen = await recoveryStore.publicRecord(op, p.mode === "observed_original" ? "observed-original-proof" : "cleanup86-finalized-proof");
  if (frozen !== null && canonicalJson(frozen) === canonicalJson(proof)) await verifyCleanup85HistoricalAcceptance(source, op, proof);
  else {
    const evidence = await consumedBurnEvidence(source, op, p.mode === "observed_original" ? true : "cleanup86");
    if (approvalReceiptIdentity(evidence.approvalProof) !== approvalReceiptIdentity(p.approvalProof) || approvalReceiptIdentity(evidence.consumerProof) !== approvalReceiptIdentity(p.consumerProof)) circleBlocked("cleanup85_settlement_source_evidence_changed");
  }
  await cleanup85Reanchor(source, observation);
  for (const saved of [p.cleanupProof, p.approvalProof, p.consumerProof, { finalityBlockHash: proof.finalizedBlockHash, finalityBlockNumberAtomic: proof.finalizedBlockNumberAtomic }]) {
    const head = await source.block("0x" + BigInt(saved.finalityBlockNumberAtomic).toString(16));
    if (circleHex(head.hash, 32) !== saved.finalityBlockHash || circleUint(head.number).toString() !== saved.finalityBlockNumberAtomic) circleBlocked("cleanup85_settlement_frozen_head_changed");
  }
  const token = Object.freeze({ kind: "verified-cleanup85-settlement" as const }); verified.set(token, { root: state.root, operationId: op.operationId, fingerprint: op.fingerprint, proofHash: proof.proofHash }); return token;
}
