import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { circleBlocked, advanceCircle, validateCircle, type CircleOperationV1 } from "./operation-model.js";
import type { Cleanup86Intent } from "./cleanup86-store.js";
import type { Cleanup86FirstDispatchPurpose } from "./cleanup86-first-dispatch-purpose.js";
import { validateCircleNonceRetirementProof, type CircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import { validateAssetUsageReservation } from "../asset-usage-ledger.js";
import type { Cleanup86FileIdentity, Cleanup86Snapshot } from "./cleanup86-snapshot.js";
export interface Cleanup86FirstDispatchAnchor {
  readonly version: "apn.circle-cleanup86-first-dispatch-anchor.v1";
  readonly purpose: Cleanup86FirstDispatchPurpose; readonly originalParent: CircleOperationV1; readonly originalSnapshotHash: string;
  readonly originalArtifacts: Readonly<Record<string,Cleanup86FileIdentity>>; readonly anchorHash: string;
}
export interface Cleanup86FirstDispatchHistory {
  readonly version: "apn.circle-cleanup86-first-dispatch-history.v1"; readonly anchorHash: string;
  readonly intentHash: string; readonly transactionHash: string; readonly materialHash: string;
  readonly phase: "authorized" | "submission_started" | "unknown";
  readonly sequence: number; readonly previousHash: string | null; readonly historyHash: string;
}
const digest=(v:unknown):v is string=>typeof v==="string" && /^[a-f0-9]{64}$/u.test(v);
export function validateCleanup86FirstDispatchAnchor(v:unknown,i:Cleanup86Intent):Cleanup86FirstDispatchAnchor {
  if(!isPlainRecord(v)||!exactKeys(v,["version","purpose","originalParent","originalSnapshotHash","originalArtifacts","anchorHash"])||v.version!=="apn.circle-cleanup86-first-dispatch-anchor.v1"||!digest(v.originalSnapshotHash)||!isPlainRecord(v.purpose)||!isPlainRecord(v.originalArtifacts)) circleBlocked("cleanup86_first_dispatch_anchor_shape");
  const a=v as unknown as Cleanup86FirstDispatchAnchor,{anchorHash,...body}=a,p=a.purpose,{purposeHash,...purposeBody}=p;
  validateCircle(a.originalParent);
  if(anchorHash!==hashObject(body)||purposeHash!==hashObject(purposeBody)||!exactKeys(v.purpose,["version","action","binding","originalIntentDigest","originalPurposeDigest","parentDigest","parentFingerprint","custodyDigest","policies","maximumFeeAtomic","frozenFeeUpperAtomic","nativeUsageAtomic","capturedAt","windowEndsAt","purposeHash"])||p.version!=="apn.circle-cleanup86-first-dispatch-purpose.v1"||p.action!=="first_dispatch_exact_sealed_zero_approval"||!isPlainRecord(p.binding)||!exactKeys(p.binding,["root","operationId","intentHash","recoveryId","envelopeHash","transactionHash","materialHash"])||p.binding.intentHash!==i.intentHash||p.binding.recoveryId!==i.recoveryBinding||p.binding.envelopeHash!==i.envelope.envelopeHash||p.originalIntentDigest!==hashObject(i)||p.originalPurposeDigest!==hashObject(i.currentPurpose)||p.maximumFeeAtomic!=="15000000000000"||p.frozenFeeUpperAtomic!==(BigInt(i.envelope.gasLimitAtomic)*BigInt(i.envelope.maxFeePerGasAtomic)).toString()||!/^0x[a-f0-9]{64}$/u.test(p.binding.transactionHash)||!digest(p.binding.materialHash)||!Array.isArray(p.policies)||p.policies.length!==2||!Number.isFinite(Date.parse(p.capturedAt))||!Number.isFinite(Date.parse(p.windowEndsAt))||Date.parse(p.windowEndsAt)<=Date.parse(p.capturedAt)||Date.parse(p.windowEndsAt)-Date.parse(p.capturedAt)>60_000) circleBlocked("cleanup86_first_dispatch_anchor_binding");
  for(const [name,f] of Object.entries(a.originalArtifacts)) if(!name.startsWith(`${p.binding.operationId}-cleanup86-`)||name.includes("first-dispatch-")||!isPlainRecord(f)||!exactKeys(f,["sha256","dev","ino","uid","mode","nlink","size","mtimeMs","ctimeMs"])||!digest(f.sha256)||f.nlink!==1||Object.entries(f).some(([k,x])=>k!=="sha256"&&(typeof x!=="number"||!Number.isFinite(x)||x<0))) circleBlocked("cleanup86_first_dispatch_anchor_identity");
  if(hashObject(a.originalParent)!==p.parentDigest||a.originalParent.fingerprint!==p.parentFingerprint||a.originalParent.operationId!==p.binding.operationId) circleBlocked("cleanup86_first_dispatch_original_parent_changed");
  return a;
}
export function validateCleanup86FirstDispatchHistory(v:unknown,a:Cleanup86FirstDispatchAnchor):Cleanup86FirstDispatchHistory {
  if(!isPlainRecord(v)||!exactKeys(v,["version","anchorHash","intentHash","transactionHash","materialHash","phase","sequence","previousHash","historyHash"])) circleBlocked("cleanup86_first_dispatch_history_shape");
  const h=v as unknown as Cleanup86FirstDispatchHistory,{historyHash,...body}=h,b=a.purpose.binding;
  if(h.version!=="apn.circle-cleanup86-first-dispatch-history.v1"||h.anchorHash!==a.anchorHash||h.intentHash!==b.intentHash||h.transactionHash!==b.transactionHash||h.materialHash!==b.materialHash||historyHash!==hashObject(body)||!Number.isSafeInteger(h.sequence)||h.sequence<0||h.sequence>2||h.phase!==["authorized","submission_started","unknown"][h.sequence]||h.previousHash!==null&&!digest(h.previousHash)) circleBlocked("cleanup86_first_dispatch_history_binding");
  return h;
}
/** Observer/storage authentication only; persisted authorization is never a live capability. */
export function assertCleanup86FirstDispatchRecords(s:Cleanup86Snapshot,root:string,op:CircleOperationV1,i:Cleanup86Intent):void {
  const prefix=`${op.operationId}-cleanup86-`, names=Object.keys(s.entries).filter(n=>n.startsWith(`${prefix}first-dispatch-`));
  if(names.length===0) return;
  if(i.version!=="apn.circle-cleanup86-intent.v5"||names.some(n=>!new RegExp(`^${prefix}first-dispatch-(?:anchor|history-[012])\\.json$`,"u").test(n))) circleBlocked("cleanup86_first_dispatch_unknown_artifact");
  const anchor=s.entries[`${prefix}first-dispatch-anchor.json`]; if(anchor===undefined) circleBlocked("cleanup86_first_dispatch_anchor_required");
  const a=validateCleanup86FirstDispatchAnchor(anchor.value,i),p=a.purpose;
  if(p.binding.root!==root||p.binding.operationId!==op.operationId||p.parentFingerprint!==op.fingerprint||p.custodyDigest!==hashObject(op.sourceCustody)) circleBlocked("cleanup86_first_dispatch_anchor_binding");
  if(hashObject(op)!==p.parentDigest) assertFirstDispatchSettlementParent(s,op,i,a);
  const originals=Object.fromEntries(Object.entries(s.entries).filter(([n])=>!n.startsWith(`${prefix}first-dispatch-`)&&n!==`${prefix}send.json`&&n!==`${prefix}finalized-proof.json`));
  if(hashObject(Object.keys(originals).sort())!==hashObject(Object.keys(a.originalArtifacts).sort())||Object.entries(originals).some(([n,e])=>hashObject(e.identity)!==hashObject(a.originalArtifacts[n]))||hashObject({...s,entries:originals})!==a.originalSnapshotHash) circleBlocked("cleanup86_first_dispatch_original_drift");
  const histories=names.filter(n=>n.includes("first-dispatch-history-")).sort().map(n=>validateCleanup86FirstDispatchHistory(s.entries[n]!.value,a));
  if(histories.some((h,n)=>h.sequence!==n||h.previousHash!==(n===0?null:histories[n-1]!.historyHash))||s.entries[`${prefix}send.json`]!==undefined&&histories.length<2||histories.length===3&&s.entries[`${prefix}send.json`]===undefined) circleBlocked("cleanup86_first_dispatch_history_changed");
}
/** Only the existing canonical-settlement transition can change the anchored public parent.
 * Normal observer independently re-verifies the full chain proof before settlement/replay. */
function assertFirstDispatchSettlementParent(s:Cleanup86Snapshot,op:CircleOperationV1,i:Cleanup86Intent,a:Cleanup86FirstDispatchAnchor):void {
  const raw=s.entries[`${op.operationId}-cleanup86-finalized-proof.json`]?.value;
  if(!isPlainRecord(raw)||op.state!=="nonce_retired"||!op.terminal||!op.usageFinalized||op.residualAllowanceAtomic!=="0") circleBlocked("cleanup86_first_dispatch_parent_changed");
  const proof=raw as unknown as CircleNonceRetirementProof; validateCircleNonceRetirementProof(proof,a.originalParent);
  const p=proof.cleanup85Recovery,b=a.purpose.binding;
  if(p?.mode!=="cancelled_then_cleanup86"||proof.cleanupTransactionHash!==b.transactionHash||p.cleanupMaterialHash!==b.materialHash||p.cleanupIntentHash!==i.intentHash||hashObject(p.cleanupEnvelope)!==hashObject(i.envelope)||hashObject(op.nonceRetirement)!==hashObject(proof)||op.usage.length!==a.originalParent.usage.length) circleBlocked("cleanup86_first_dispatch_settlement_changed");
  for(const [n,row] of op.usage.entries()) {
    validateAssetUsageReservation(row); const old=a.originalParent.usage[n]!;
    const historical=(v:typeof row)=>{const {state:_state,updatedAt:_updated,effectAt:_effect,consumedAtomic:_consumed,outcomeDigest:_outcome,reservationDigest:_digest,...body}=v;return body;};
    const fee=n===1?"1116903336000":n===3?proof.actualCleanupFeeAtomic:"0",outcome=hashObject({version:"apn.circle-cleanup85-retirement-usage.v1",proofHash:proof.proofHash,operationId:op.operationId,reservationId:old.reservationId,index:n});
    if(hashObject(historical(row))!==hashObject(historical(old))||row.state!=="failed_confirmed_revert"||row.consumedAtomic!==fee||row.outcomeDigest!==outcome) circleBlocked("cleanup86_first_dispatch_settlement_usage_changed");
  }
  const last=op.transitions.at(-1),allowed=["cleanup86_finalized_retirement_original_unknown_preserved","cleanup85_frozen_finalized_retirement_reconciled"];
  if(last===undefined||!allowed.includes(last.reason)||hashObject(advanceCircle(a.originalParent,{usage:op.usage,usageFinalized:true,residualAllowanceAtomic:"0",state:"nonce_retired",terminal:true,nonceRetirement:proof},last.reason,Date.parse(last.at)))!==hashObject(op)) circleBlocked("cleanup86_first_dispatch_settlement_parent_changed");
}
