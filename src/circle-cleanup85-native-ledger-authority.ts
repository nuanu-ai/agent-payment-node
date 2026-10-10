import { assertHeldCleanup85Scope,type HeldCleanup85Scope } from "./circle-cleanup85-financial-scope.js";
import { cleanup85NativeLineage,cleanup85NativeSlotKind,cleanup85NativeSlotBody,assertCleanup85NativeLineageOperation } from "./circle-cleanup85-native-lineage.js";
import { verifyCleanup85SuccessorFinancialAdmission,verifiedCleanup85SuccessorFinancialAdmission } from "./circle-cleanup85-unsigned-retirement.js";
import { canonicalJson, hashObject, exactKeys, isPlainRecord } from "./canonical.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import { AllowlistPolicyStore } from "./allowlist-policy-store.js";
import { evaluateAssetPolicy } from "./asset-policy-registry.js";
import { Cleanup85NativePublicRecords } from "./circle-cleanup85-native-records.js";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import { CLEANUP85_OWNER, cleanup85Blocked, verifyCleanup85Observation } from "./circle-cleanup85-native-codec.js";
import type { Cleanup85NativeRpc } from "./circle-cleanup85-native-rpc.js";
import { verifyCleanup85RecoveryAdmission, verifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import { assertCleanup85Window } from "./circle-v2-evm/cleanup85-recovery-store.js";
import type { CircleRpc } from "./circle-v2-evm/rpc.js";
import type { OperationRecord } from "./model.js";
import type { StateStore } from "./state.js";

import { AssetUsageLedger } from "./asset-usage-ledger.js";
import { EvmDirectSubmissionJournal } from "./evm-direct-submission.js";

export interface VerifiedCleanup85NativeReservation { readonly kind: "verified-cleanup85-native-reservation"; }
export interface VerifiedCleanup85NativeSettlement { readonly kind: "verified-cleanup85-native-settlement"; }
export interface Cleanup85NativeReservationBody {
  readonly operation: OperationRecord; readonly policy: ActiveAssetPolicy;
  readonly reservationId: string; readonly idempotencyKey: string;
  readonly reservedAtomic: "2000000000000"; readonly signedMaximumDebitAtomic: string;
  /** Current authority timing; never replaces immutable preparation timing. */
  readonly authorizationExpiresAt: string; readonly unsignedContinuation: boolean;
}
export interface Cleanup85NativeActualSettlement {
  readonly kind: "circle_cleanup85_native_actual"; readonly operationId: string; readonly fingerprint: string;
  readonly requestBinding: string; readonly transactionHash: string; readonly receiptHash: string;
  readonly blockHash: string; readonly blockNumberAtomic: string; readonly actualFeeAtomic: string;
  readonly nativeConsumedAtomic: string; readonly reservedAtomic: "2000000000000";
  readonly nativeReservationId: string; readonly policyDigest: string; readonly outcomeDigest: string;
}
const reservations = new WeakMap<VerifiedCleanup85NativeReservation, { root: string; body: Cleanup85NativeReservationBody; state:StateStore; scope:HeldCleanup85Scope; active:boolean; consumed:boolean; now:()=>Date }>();
const settlements = new WeakMap<VerifiedCleanup85NativeSettlement, { root: string; operation: OperationRecord; settlement: Cleanup85NativeActualSettlement }>();
export function verifiedCleanup85NativeReservation(token: VerifiedCleanup85NativeReservation, exactRoot: string): Cleanup85NativeReservationBody {
  const value = reservations.get(token); if (value === undefined || !value.active || value.root !== exactRoot) cleanup85Blocked("root_owned_reservation_required");
  assertHeldCleanup85Scope(value.scope,value.state,value.body.operation.evm!.cleanup85Cancellation!.request,value.body.operation.operationId);
  if(value.body.unsignedContinuation&&value.now().toISOString()>=value.body.authorizationExpiresAt)cleanup85Blocked("current_native_authorization_expired");
  return structuredClone(value.body);
}
/** Only a genuinely issued reservation enters the one-use current foreground scope. */
export async function withCleanup85NativeReservationAuthorization<T>(token:VerifiedCleanup85NativeReservation,state:StateStore,work:(expiresAt:string,assertCurrent:()=>void)=>Promise<T>):Promise<T>{
 const v=reservations.get(token);if(v===undefined||v.state!==state||!v.active||v.consumed)cleanup85Blocked("private_current_native_authorization_required");
 const assertCurrent=()=>{verifiedCleanup85NativeReservation(token,state.root);if(v.now().toISOString()>=v.body.authorizationExpiresAt)cleanup85Blocked("current_native_authorization_expired");};
 assertCurrent();v.consumed=true;
 try{return await work(v.body.authorizationExpiresAt,assertCurrent);}finally{v.active=false;reservations.delete(token);}
}
export function verifiedCleanup85NativeSettlement(token: VerifiedCleanup85NativeSettlement, exactRoot: string): { operation: OperationRecord; settlement: Cleanup85NativeActualSettlement } {
  const value = settlements.get(token); if (value === undefined || value.root !== exactRoot) cleanup85Blocked("root_owned_settlement_required");
  return structuredClone({ operation: value.operation, settlement: value.settlement });
}
/** Under canonical wallet/address/operation outer locks and TRUE allowlist profile inner lock.
 * Fresh full public A admission and the saved unsigned native operation precede reservation. */
export async function verifyCleanup85NativeReservation(state: StateStore, id: string, source: CircleRpc, destination: CircleRpc, native: Cleanup85NativeRpc, now: () => Date, scope:HeldCleanup85Scope): Promise<VerifiedCleanup85NativeReservation> {
  const o = await state.findOperation(id);
  if (o === null || o.state !== "awaiting_approval" || o.terminal || o.allowlist === undefined) cleanup85Blocked("reservation_unsigned_operation");
  const e = cleanup85OperationEnvelope(o), b = o.evm!.cleanup85Cancellation!;
  const unsignedContinuation=now().toISOString()>=o.expiresAt;
  if(unsignedContinuation&&(b.version!=="apn.circle-cleanup85-native-binding.v2"||o.allowlistLease!==undefined||o.transactionHash!==undefined||o.rawTransactionHash!==undefined||o.providerEffect!==undefined||o.lastSubmissionAt!==undefined))cleanup85Blocked("reservation_expired_unsigned_successor_required");
  assertHeldCleanup85Scope(scope,state,b.request,id);
  await assertCleanup85NativeSlot(state,o);
  await new DirectPublicEffectJournal(state).assertUnstarted(o);
  if(unsignedContinuation&&(await new EvmDirectSubmissionJournal(state.root).exists(o)||await new Cleanup85NativePublicRecords(state.root).load(id,"material")!==null))cleanup85Blocked("continuation_submission_present");
  const lineage=await cleanup85NativeLineage(state,b.request),fresh=lineage.retirementProofHash===null?null:verifiedCleanup85SuccessorFinancialAdmission(await verifyCleanup85SuccessorFinancialAdmission(state,source,destination,b.request,()=>now().getTime(),scope),state,b.request);
  const admission=fresh?.originalAdmission??await verifyCleanup85RecoveryAdmission(state,source,destination,b.request),checked=verifiedCleanup85RecoveryAdmission(admission,b.request);
  if(fresh!==null&&canonicalJson(fresh.lineage)!==canonicalJson(lineage))cleanup85Blocked("reservation_successor_lineage_changed");const intent=fresh?.readmission??checked.intent;
  assertCleanup85Window(intent, now().getTime());
  if(intent.windowEndsAt!==null&&o.expiresAt>intent.windowEndsAt)cleanup85Blocked("reservation_frozen_recovery_window");
  if (hashObject(intent.recipientCustody) !== hashObject(b.recipientCustody) || hashObject(checked.parent.sourceCustody) !== hashObject(o.evm!.nativeCustody)) cleanup85Blocked("reservation_custody");
  const snapshot=await native.snapshot(e),anchor=await source.block(`0x${BigInt(snapshot.blockNumberAtomic).toString(16)}`);if(anchor.hash!==snapshot.blockHash)cleanup85Blocked("reservation_archive_native_anchor_agreement");await source.identity();
  if(unsignedContinuation){if(fresh===null)cleanup85Blocked("continuation_private_successor_admission_required");const finalized=await native.unsignedFinalizedAccount();if((await source.block(`0x${BigInt(finalized.number).toString(16)}`)).hash!==finalized.hash)cleanup85Blocked("continuation_finalized_archive_agreement");}
  const at = now(), p = activeAssetPolicyFromState(await new AllowlistPolicyStore(state.root).readUnderProfileLock(o.profile), at);
  if (p === null || p.accounts.evm !== CLEANUP85_OWNER || p.digest !== o.allowlist.policyDigest || p.revision !== o.allowlist.policyRevision || p.activationDigest !== b.activationDigest || (!unsignedContinuation&&at.toISOString() >= o.expiresAt)) cleanup85Blocked("reservation_policy");
  if(p.registry.expiresAt!==undefined&&o.expiresAt>p.registry.expiresAt)cleanup85Blocked("reservation_frozen_native_policy_window");
  evaluateAssetPolicy(p.registry, { chain: "eip155:42161", asset: { kind: "native", identifier: null }, rail: "direct", amountAtomic: b.nativeReserveAtomic, dailyUsageAtomic: "0", asOfDate: at.toISOString().slice(0,10), asOf: at.toISOString() });
  if ((await state.findOperation(id))?.integrityHash !== o.integrityHash) cleanup85Blocked("reservation_operation_changed");
  if(unsignedContinuation){await new DirectPublicEffectJournal(state).assertUnstarted(o);if(await new EvmDirectSubmissionJournal(state.root).exists(o)||await new Cleanup85NativePublicRecords(state.root).load(id,"material")!==null||await new AssetUsageLedger(state.root).load({account:o.walletAddress,chain:"eip155:42161",asset:{kind:"native",identifier:null}},b.nativeReservationId)!==null)cleanup85Blocked("continuation_effect_or_reservation_present");}
  const issuedAt=now();
  const authorizationExpiresAt=unsignedContinuation?new Date(Math.min(issuedAt.getTime()+60_000,Date.parse(intent.windowEndsAt??o.expiresAt),Date.parse(p.registry.expiresAt??o.expiresAt))).toISOString():o.expiresAt;
  if(issuedAt.toISOString()>=authorizationExpiresAt)cleanup85Blocked("continuation_current_window_expired");
  const body: Cleanup85NativeReservationBody = { authorizationExpiresAt,unsignedContinuation, operation: o, policy: p, reservationId: b.nativeReservationId, idempotencyKey: `apn.cleanup85-native:${id}`, reservedAtomic: b.nativeReserveAtomic, signedMaximumDebitAtomic: (BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic) + 1n).toString() };
  assertHeldCleanup85Scope(scope,state,b.request,id);
  const token = Object.freeze({ kind: "verified-cleanup85-native-reservation" as const }); reservations.set(token, { root: state.root, body:structuredClone(body), state, scope, active:true, consumed:false, now }); return token;
}
/** Only a freshly independently verified FINALIZED receipt for this root's durable operation mints settlement.
 * Moving finalized anchors never enter the stable accounting digest. */
export async function verifyCleanup85NativeSettlement(state: StateStore, id: string, native: Cleanup85NativeRpc): Promise<VerifiedCleanup85NativeSettlement> {
  const o = await state.findOperation(id);
  if (o === null || o.state !== "completed" || !o.terminal || o.transactionHash === undefined || o.rawTransactionHash !== o.transactionHash || o.allowlist === undefined) cleanup85Blocked("settlement_terminal_operation");
  const e = cleanup85OperationEnvelope(o), b = o.evm!.cleanup85Cancellation!;
  await assertCleanup85NativeSlot(state,o);
  const records=new Cleanup85NativePublicRecords(state.root), frozen=await records.load(id,"canonical");
  const effect = await new DirectPublicEffectJournal(state).effect(o);
  if (effect.transactionHash !== o.transactionHash) cleanup85Blocked("settlement_signed_claim");
  const observation = await native.observation(effect.transactionHash); if (observation === null) cleanup85Blocked("settlement_finality");
  const receipt = await verifyCleanup85Observation(e, effect.transactionHash, observation);
  if(frozen===null)await native.finalizedAccount(observation);else await native.finalizedConsumedAccount(observation);
  if ((await state.findOperation(id))?.integrityHash !== o.integrityHash) cleanup85Blocked("settlement_operation_changed");
  const body = { kind: "circle_cleanup85_native_actual" as const, operationId: id, fingerprint: o.fingerprint, requestBinding: hashObject(b.request), ...receipt, reservedAtomic: b.nativeReserveAtomic, nativeReservationId: b.nativeReservationId, policyDigest: o.allowlist.policyDigest };
  const settlement = { ...body, outcomeDigest: hashObject(body) };
  if(frozen===null)await records.publish(id,"canonical",{version:"apn.cleanup85-native-canonical.v1",operationId:id,fingerprint:o.fingerprint,observation,settlement});
  else {
    if(!isPlainRecord(frozen)||!exactKeys(frozen,["version","operationId","fingerprint","observation","settlement"])||frozen.version!=="apn.cleanup85-native-canonical.v1"||frozen.operationId!==id||frozen.fingerprint!==o.fingerprint||canonicalJson(frozen.settlement)!==canonicalJson(settlement))cleanup85Blocked("frozen_canonical_accounting");
    const original=await verifyCleanup85Observation(e,effect.transactionHash,frozen.observation as import("./circle-v2-evm/protocol.js").CircleObservation);if(canonicalJson(original)!==canonicalJson(receipt))cleanup85Blocked("frozen_canonical_effect");
  }
  const token = Object.freeze({ kind: "verified-cleanup85-native-settlement" as const }); settlements.set(token, structuredClone({ root: state.root, operation: o, settlement })); return token;
}
/** C must reread the durable owning operation while holding the bucket lock, before any mutation. */
export function sameCleanup85LedgerOperation(expected: OperationRecord, actual: OperationRecord | null): boolean {
  return actual !== null && canonicalJson(actual) === canonicalJson(expected);
}

export async function assertCleanup85NativeSlot(state:StateStore,o:OperationRecord):Promise<void> {
  const r=o.evm?.cleanup85Cancellation?.request;if(r===undefined)cleanup85Blocked("cancellation_slot_binding");
  // Original retained-slot validation is public comparison, not successor selection or authority.
  // A retirement verifies this original through this helper; resolving A lineage here would recurse.
  const namespace=`cleanup85-native:${r.recoveryBinding}`,lineage=o.evm!.cleanup85Cancellation!.version==="apn.circle-cleanup85-native-binding.v1"?{originalOperationId:state.operationId("evm-live-buyer",namespace),operationId:state.operationId("evm-live-buyer",namespace),namespace,retirementProofHash:null,readmission:null}:await cleanup85NativeLineage(state,r);assertCleanup85NativeLineageOperation(state,o,lineage);
  if(canonicalJson(await new Cleanup85NativePublicRecords(state.root).load(r.parentOperationId,cleanup85NativeSlotKind(lineage)))!==canonicalJson(cleanup85NativeSlotBody(o,lineage)))cleanup85Blocked("permanent_cancellation_slot");
}
