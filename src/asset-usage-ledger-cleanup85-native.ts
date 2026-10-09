import { loadCleanup85NativeReservationIdentity } from "./circle-cleanup85-native-records.js";
import { StateStore } from "./state.js";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { assetUsageReservationId, atomic, blocked, corrupt, idempotency } from "./asset-usage-ledger-record.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import type { Cleanup85NativeReservationBody } from "./circle-cleanup85-native-ledger-authority.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "./asset-usage-ledger.js";
export interface Cleanup85NativeReservationMarker {
  readonly version:"apn.cleanup85-native-reservation.v1";readonly operationId:string;readonly fingerprint:string;
  readonly requestBinding:string;readonly envelopeHash:string;readonly signedMaximumDebitAtomic:string;
  readonly reservedAtomic:"2000000000000";readonly policyDigest:string;readonly activationDigest:string;
}
/** Data projection of the opaque verified body, never an authority creator. */
export function cleanup85NativeReservationMarker(b:Cleanup85NativeReservationBody):Cleanup85NativeReservationMarker {
  return {version:"apn.cleanup85-native-reservation.v1",operationId:b.operation.operationId,fingerprint:b.operation.fingerprint,requestBinding:hashObject(b.operation.evm!.cleanup85Cancellation!.request),envelopeHash:cleanup85OperationEnvelope(b.operation).envelopeHash,signedMaximumDebitAtomic:b.signedMaximumDebitAtomic,reservedAtomic:b.reservedAtomic,policyDigest:b.policy.digest,activationDigest:b.policy.activationDigest};
}
export function sameCleanup85NativeMarker(value:unknown,b:Cleanup85NativeReservationBody):boolean {return isPlainRecord(value)&&canonicalJson(value)===canonicalJson(cleanup85NativeReservationMarker(b));}
/** Stored public accounting data only. The root-owned opaque getter authorizes all ledger writes. */
export function validateCleanup85NativeUsage(value:Record<string,unknown>):void {
  const m=value.cleanup85NativeReservation,p=value.cleanup85NativeActual;
  if(!isPlainRecord(m)||!exactKeys(m,["version","operationId","fingerprint","requestBinding","envelopeHash","signedMaximumDebitAtomic","reservedAtomic","policyDigest","activationDigest"])||m.version!=="apn.cleanup85-native-reservation.v1"||m.reservedAtomic!=="2000000000000"||value.account!=="0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7"||value.chain!=="eip155:42161"||value.rail!=="direct"||!isPlainRecord(value.asset)||value.asset.kind!=="native"||value.asset.identifier!==null||value.amountAtomic!==m.reservedAtomic||value.policyDigest!==m.policyDigest)corrupt("Cleanup85 native reservation projection is invalid.");
  if(![m.operationId,m.fingerprint,m.requestBinding,m.envelopeHash,m.policyDigest,m.activationDigest].every(x=>typeof x==="string"&&/^[a-f0-9]{64}$/u.test(x))||atomic(m.signedMaximumDebitAtomic,true,true)>2000000000000n)corrupt("Cleanup85 native reservation identity or signed maximum is invalid.");
  const key=`apn.cleanup85-native:${m.operationId}`;
  if(value.idempotencyHash!==idempotency(key)||value.reservationId!==assetUsageReservationId(value as unknown as AssetUsageIdentity,key)||value.state==="failed_confirmed_revert")corrupt("Cleanup85 native reservation binding is invalid.");
  if(p===undefined){if(!["reserved","submitted","unknown_finality"].includes(value.state as string)||value.consumedAtomic!==undefined)corrupt("Cleanup85 native settlement proof is required.");return;}
  if(!isPlainRecord(p)||!exactKeys(p,["kind","operationId","fingerprint","requestBinding","transactionHash","receiptHash","blockHash","blockNumberAtomic","actualFeeAtomic","nativeConsumedAtomic","reservedAtomic","nativeReservationId","policyDigest","outcomeDigest"])||p.kind!=="circle_cleanup85_native_actual"||value.state!=="finalized"||p.operationId!==m.operationId||p.fingerprint!==m.fingerprint||p.requestBinding!==m.requestBinding||p.policyDigest!==m.policyDigest||p.reservedAtomic!==m.reservedAtomic)corrupt("Cleanup85 native actual debit projection is invalid.");
  if(![p.operationId,p.fingerprint,p.requestBinding,p.receiptHash,p.nativeReservationId,p.policyDigest,p.outcomeDigest].every(x=>typeof x==="string"&&/^[a-f0-9]{64}$/u.test(x))||![p.transactionHash,p.blockHash].every(x=>typeof x==="string"&&/^0x[a-f0-9]{64}$/u.test(x)))corrupt("Cleanup85 native actual debit identity is invalid.");
  const {outcomeDigest,...body}=p;
  if(value.reservationId!==p.nativeReservationId||value.outcomeDigest!==outcomeDigest||hashObject(body)!==outcomeDigest||value.consumedAtomic!==p.nativeConsumedAtomic||atomic(p.nativeConsumedAtomic,true,true)!==atomic(p.actualFeeAtomic,false,true)+1n||atomic(p.nativeConsumedAtomic,true,true)>atomic(m.signedMaximumDebitAtomic,true,true)||atomic(p.blockNumberAtomic,true,true)===0n)corrupt("Cleanup85 native actual debit conservation or binding is invalid.");
}

/** One public permanent slot and one operation only; never a profile/global scan. */
export async function assertCleanup85GenericCapacityRelease(root:string,row:AssetUsageReservation):Promise<void> {
  if(row.cleanup85NativeReservation!==undefined)throw blocked("Cleanup85 native hold requires opaque canonical settlement.");
  if(row.account!=="0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7"||row.chain!=="eip155:42161"||row.rail!=="direct"||row.asset.kind!=="native")return;
  const own=await loadCleanup85NativeReservationIdentity(new StateStore(root));
  if(own?.nativeReservationId===row.reservationId)throw blocked("Cleanup85 native hold marker is missing; opaque canonical settlement required.");
}
