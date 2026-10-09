import { canonicalJson, hashObject } from "../canonical.js";
import { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage } from "../circle-cleanup85-unsigned-retirement.js";
import { CircleRepository } from "./repository.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest, type Cleanup85RecoveryIntent } from "./cleanup85-recovery-store.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import type { StateStore } from "../state.js";
export interface VerifiedCleanup86RecoveryContext{readonly kind:"verified-cleanup86-recovery-context";}
export interface Cleanup86RecoveryContext{readonly original:Cleanup85RecoveryIntent;readonly readmission:Cleanup85RecoveryIntent;readonly retirementProofHash:string|null;readonly readmissionHash:string;}
const contexts=new WeakMap<VerifiedCleanup86RecoveryContext,{state:StateStore;parentHash:string;originalHash:string;body:Cleanup86RecoveryContext}>();
export async function verifyCleanup86RecoveryContext(state:StateStore,op:CircleOperationV1,original:Cleanup85RecoveryIntent):Promise<VerifiedCleanup86RecoveryContext>{
 const saved=await new CircleRepository(state.root).load(op.operationId);if(saved===null||canonicalJson(saved)!==canonicalJson(op))circleBlocked("cleanup86_context_durable_parent");
 const parent=await new CircleNonceRetirementStore(state.root).intent(saved);if(parent===null)circleBlocked("cleanup86_context_original_intent");
 const frame=await new Cleanup85RecoveryStore(state.root).load(saved,parent);if(frame===null||canonicalJson(frame)!==canonicalJson(original))circleBlocked("cleanup86_context_frozen_original");
 const request=cleanup85CancellationRequest(frame),lineage=verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(state,request),state,request),readmission=lineage.readmission??frame;
 const body={original:frame,readmission,retirementProofHash:lineage.retirementProofHash,readmissionHash:hashObject(readmission)};
 const retained=structuredClone(body),freeze=(v:unknown):void=>{if(v!==null&&typeof v==="object"){for(const x of Object.values(v))freeze(x);Object.freeze(v);}};freeze(retained);
 const token=Object.freeze({kind:"verified-cleanup86-recovery-context" as const});contexts.set(token,{state,parentHash:op.integrityHash,originalHash:hashObject(original),body:retained});return token;
}
export function verifiedCleanup86RecoveryContext(token:VerifiedCleanup86RecoveryContext,state:StateStore,op:CircleOperationV1,original:Cleanup85RecoveryIntent):Cleanup86RecoveryContext{
 const value=contexts.get(token);if(value===undefined||value.state!==state||value.parentHash!==op.integrityHash||value.originalHash!==hashObject(original))circleBlocked("cleanup86_private_recovery_context_required");return value.body;
}
