import { Cleanup85UnsignedRetirementStore } from "./circle-cleanup85-unsigned-retirement-store.js";
import { canonicalJson, hashObject } from "./canonical.js";
import { AssetUsageLedger, assetUsageReservationId } from "./asset-usage-ledger.js";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
import { EvmDirectSubmissionJournal } from "./evm-direct-submission.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
import { assertCleanup85NativeSlot } from "./circle-cleanup85-native-ledger-authority.js";
import { assertEvmNativeCustody } from "./evm-native-custody.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import { CircleNonceRetirementStore } from "./circle-v2-evm/nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest } from "./circle-v2-evm/cleanup85-recovery-store.js";
import type { CircleOperationV1 } from "./circle-v2-evm/operation-model.js";
import type { StateStore } from "./state.js";
/** No dispatch authority: the only exclusion is derived from this root's retained finite intent.
 * Called with the enclosing profile/address/operation and policy locks held. */
export async function cleanup85UnsignedResumeExclusion(state: StateStore, parent: CircleOperationV1, now: number): Promise<string | null> {
  const saved = await new CircleRepository(state.root).load(parent.operationId);
  if (saved === null || canonicalJson(saved) !== canonicalJson(parent)) cleanup85Blocked("unsigned_resume_parent");
  const old = new CircleNonceRetirementStore(state.root), oldIntent = await old.intent(saved);
  if (oldIntent === null || !await old.hasClaim(saved, "sign") || await old.hasClaim(saved, "send")) cleanup85Blocked("unsigned_resume_old_claims");
  const store = new Cleanup85RecoveryStore(state.root), intent = await store.load(saved, oldIntent);
  if (intent === null) return null;
  await store.assertRetainedMaterialHeaders(saved);
  const request = cleanup85CancellationRequest(intent), id = state.operationId("evm-live-buyer", `cleanup85-native:${request.recoveryBinding}`); let o = await state.findOperation(id);
  if (o === null) return null;
  if (o.state === "failed_before_effect") { const proofs = new Cleanup85UnsignedRetirementStore(state.root), proof = await proofs.load(); if (proof === null) cleanup85Blocked("unsigned_resume_terminal_proof"); await proofs.verifyRetained(state, proof); o = await state.findOperation(state.operationId("evm-live-buyer", `cleanup85-native-successor:${request.recoveryBinding}:${proof.proofHash}`)); if (o === null) return null; }
  const b = o.evm?.cleanup85Cancellation;
  if (b === undefined || o.profileHash !== saved.profileHash || o.walletAddress !== saved.sourceCustody.walletAddress ||
      hashObject(b.request) !== hashObject(request) || hashObject(o.evm!.nativeCustody) !== hashObject(intent.sourceCustody) ||
      hashObject(b.recipientCustody) !== hashObject(intent.recipientCustody) || o.state !== "awaiting_approval" || o.terminal ||
      now < Date.parse(o.preparedAt) || o.allowlistLease !== undefined ||
      o.transactionHash !== undefined || o.rawTransactionHash !== undefined || o.lastSubmissionAt !== undefined || o.providerEffect !== undefined) cleanup85Blocked("unsigned_resume_exact_unstarted_operation");
  cleanup85OperationEnvelope(o); await assertCleanup85NativeSlot(state, o);
  await assertEvmNativeCustody(state, o.profile, o.evm!.nativeCustody!);
  await assertEvmNativeCustody(state, "default", b.recipientCustody);
  await new DirectPublicEffectJournal(state).assertUnstarted(o);
  if (await new EvmDirectSubmissionJournal(state.root).exists(o)) cleanup85Blocked("unsigned_resume_submission");
  const identity = { account: o.walletAddress, chain: "eip155:42161", asset: { kind: "native" as const, identifier: null } };
  const rid = assetUsageReservationId(identity, `apn.cleanup85-native:${o.operationId}`);
  if (b.nativeReservationId !== rid || await new AssetUsageLedger(state.root).load(identity, rid) !== null) cleanup85Blocked("unsigned_resume_reservation");
  if ((await state.findOperation(o.operationId))?.integrityHash !== o.integrityHash || (await new CircleRepository(state.root).load(parent.operationId))?.integrityHash !== parent.integrityHash) cleanup85Blocked("unsigned_resume_changed");
  return o.operationId;
}
