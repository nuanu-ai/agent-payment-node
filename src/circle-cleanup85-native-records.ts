import { canonicalJson,domainHash } from "./canonical.js";
import { SecureStateStore } from "./secure-state-store.js";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
export class Cleanup85NativePublicRecords extends SecureStateStore {
  /** Existing-only audit peek: bound filenames BEFORE operation decoding; never initializes. */
  async cleanup85BuyerOperations(state:StateStore):Promise<readonly OperationRecord[]>{
    if(state.root!==this.root)cleanup85Blocked("absent_roster_root");const profile=state.profileHash("evm-live-buyer"),entries=await this.readDirectory(`operations/${profile}`);
    if(entries.length>256)cleanup85Blocked("absent_roster_overflow");const present:OperationRecord[]=[];
    for(const entry of entries){if(!entry.isFile()||entry.isSymbolicLink()||!/^[a-f0-9]{64}\.json$/u.test(entry.name))cleanup85Blocked("absent_roster_shape");const o=await state.loadOperation(profile,entry.name.slice(0,-5));if(o===null||o.profileHash!==profile||o.operationId!==entry.name.slice(0,-5))cleanup85Blocked("absent_roster_operation_path");if(o.evm?.cleanup85Cancellation!==undefined)present.push(o);}
    return Object.freeze(present);
  }
  async hasAnyCleanup85BuyerOperation(state:StateStore):Promise<boolean>{return (await this.cleanup85BuyerOperations(state)).length!==0;}
  /** DENY-only metadata projection. No private capability, current admission or nested ledger lock. */
  async successorProtectionLineage(state:StateStore,request:Cleanup85CancellationRequest,original:OperationRecord){
    if(state.root!==this.root)cleanup85Blocked("protection_root");const proof=await new Cleanup85UnsignedRetirementStore(this.root).load();
    if(proof===null||canonicalJson(proof.original.evm!.cleanup85Cancellation!.request)!==canonicalJson(request)||canonicalJson(original)!==canonicalJson(cleanup85UnsignedTerminal(proof)))cleanup85Blocked("protection_retirement_terminal");
    if(canonicalJson(await this.load(request.parentOperationId,"slot"))!==canonicalJson(proof.slot)||canonicalJson(await this.readJson(`direct-public-effects/${original.profileHash}/${original.operationId}.prepared.json`))!==canonicalJson(proof.prepared))cleanup85Blocked("protection_retained_original");
    await new DirectPublicEffectJournal(state).prepared(original);
    if(await this.readJson(`direct-public-effects/${original.profileHash}/${original.operationId}.signing.json`)!==null||await this.readJson(`direct-public-effects/${original.profileHash}/${original.operationId}.signed.json`)!==null||await new EvmDirectSubmissionJournal(this.root).exists(original))cleanup85Blocked("protection_original_effect_claim");
    const identity={account:original.walletAddress,chain:"eip155:42161",asset:{kind:"native",identifier:null}},bucket=domainHash("apn.asset-usage-bucket.v1",canonicalJson(identity));
    if(await this.readJson(`asset-usage/${bucket}/${original.evm!.cleanup85Cancellation!.nativeReservationId}.json`)!==null)cleanup85Blocked("protection_original_reservation_present");
    const namespace=`cleanup85-native-successor:${request.recoveryBinding}:${proof.proofHash}`;
    return Object.freeze({originalOperationId:original.operationId,operationId:state.operationId("evm-live-buyer",namespace),namespace,retirementProofHash:proof.proofHash,readmission:proof.readmission});
  }
  async load(id: string, kind: "material" | "proof" | "slot" | "failure" | "canonical" | "successor-slot"): Promise<unknown> { if(!/^[a-f0-9]{64}$/u.test(id))cleanup85Blocked("public_record_id");return this.readJson(`circle-cleanup85-native/${id}-${kind}.json`); }
  async publish(id: string, kind: "material" | "proof" | "slot" | "failure" | "canonical" | "successor-slot", body: unknown): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(id)) cleanup85Blocked("public_record_id");
    const old = await this.load(id,kind);
    if (old !== null) { if (canonicalJson(old) !== canonicalJson(body)) cleanup85Blocked("public_record_replacement"); return; }
    await this.initialize(); await this.ensureDirectory("circle-cleanup85-native"); await this.writeJson(`circle-cleanup85-native/${id}-${kind}.json`,body,true);
  }
}
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { CLEANUP85_REQUEST } from "./circle-cleanup85-native-codec.js";
import { cleanup85NativeSlotBody,assertCleanup85NativeLineageOperation } from "./circle-cleanup85-native-lineage.js";
import type { StateStore } from "./state.js";
import type { Cleanup85CancellationRequest } from "./circle-cleanup85-cancellation-contract.js";
import type { OperationRecord } from "./model.js";
import { Cleanup85UnsignedRetirementStore,cleanup85UnsignedTerminal,CLEANUP85_UNSIGNED_ORIGINAL } from "./circle-cleanup85-unsigned-retirement-store.js";
import { EvmDirectSubmissionJournal } from "./evm-direct-submission.js";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
/** Public deny/reconciliation lookup only. It never grants reservation, settlement or dispatch.
 * Fixed slots provide the normal lookup; a missing original index triggers only a
 * capped existing-only Buyer roster for denial. No chain requests or ledger locks. */
export async function loadCleanup85NativeReservationIdentity(state:StateStore):Promise<{readonly operationId:string;readonly fingerprint:string;readonly nativeReservationId:string}|null>{
 const records=new Cleanup85NativePublicRecords(state.root),original=await records.load(CLEANUP85_REQUEST.parentOperationId,"slot");
 if(original===null){
  // Untrusted metadata may only recover a DENY identity, never financial lineage.
  const proof=await new Cleanup85UnsignedRetirementStore(state.root).load(),slot=await records.load(CLEANUP85_REQUEST.parentOperationId,"successor-slot"),ops=await records.cleanup85BuyerOperations(state);
  let selected:OperationRecord|null=null;
  for(const o of ops){const binding=o.evm!.cleanup85Cancellation!,request=binding.request,originalNamespace=`cleanup85-native:${request.recoveryBinding}`,retirementProofHash=binding.successor?.retirementProofHash??null,namespace=retirementProofHash===null?originalNamespace:`cleanup85-native-successor:${request.recoveryBinding}:${retirementProofHash}`;
   const lineage={originalOperationId:state.operationId("evm-live-buyer",originalNamespace),operationId:state.operationId("evm-live-buyer",namespace),namespace,retirementProofHash,readmission:null};if(lineage.originalOperationId!==CLEANUP85_UNSIGNED_ORIGINAL)cleanup85Blocked("reservation_orphan_original_identity");assertCleanup85NativeLineageOperation(state,o,lineage);
   if(retirementProofHash!==null){if(selected?.evm?.cleanup85Cancellation?.successor!==undefined)cleanup85Blocked("reservation_orphan_successor_ambiguity");selected=o;}else if(selected===null)selected=o;
  }
  if(selected!==null){const binding=selected.evm!.cleanup85Cancellation!;
   if((proof!==null||slot!==null)&&binding.successor===undefined)cleanup85Blocked("reservation_original_slot_missing");
   if(proof!==null&&(binding.successor!.retirementProofHash!==proof.proofHash||canonicalJson(binding.request)!==canonicalJson(proof.original.evm!.cleanup85Cancellation!.request)))cleanup85Blocked("reservation_orphan_proof_binding");
   if(slot!==null){const namespace=`cleanup85-native-successor:${binding.request.recoveryBinding}:${binding.successor!.retirementProofHash}`,lineage={originalOperationId:binding.successor!.originalOperationId,operationId:selected.operationId,namespace,retirementProofHash:binding.successor!.retirementProofHash,readmission:null};if(canonicalJson(slot)!==canonicalJson(cleanup85NativeSlotBody(selected,lineage)))cleanup85Blocked("reservation_orphan_slot_binding");}
   return Object.freeze({operationId:selected.operationId,fingerprint:selected.fingerprint,nativeReservationId:binding.nativeReservationId});
  }
  if(proof!==null||slot!==null)cleanup85Blocked("reservation_original_slot_missing");return null;
 }
 if(!isPlainRecord(original)||!exactKeys(original,["version","parentOperationId","oldCleanupMaterialHash","requestBinding","operationId","fingerprint"])||original.version!=="apn.cleanup85-single-cancellation.v1"||typeof original.operationId!=="string")cleanup85Blocked("reservation_original_slot_public_binding");
 const originalOperation=await state.findOperation(original.operationId);if(originalOperation?.evm?.cleanup85Cancellation===undefined)cleanup85Blocked("reservation_original_operation");
 const request=originalOperation.evm.cleanup85Cancellation.request,namespace=`cleanup85-native:${request.recoveryBinding}`;
 // Original public denial lookup keeps legacy accounting compatibility; it grants no effect.
 if(!originalOperation.terminal||originalOperation.state!=="failed_before_effect"){
  const lineage={originalOperationId:state.operationId("evm-live-buyer",namespace),operationId:state.operationId("evm-live-buyer",namespace),namespace,retirementProofHash:null,readmission:null};assertCleanup85NativeLineageOperation(state,originalOperation,lineage);
  if(canonicalJson(original)!==canonicalJson(cleanup85NativeSlotBody(originalOperation,lineage)))cleanup85Blocked("reservation_original_slot_binding");
  return Object.freeze({operationId:originalOperation.operationId,fingerprint:originalOperation.fingerprint,nativeReservationId:originalOperation.evm.cleanup85Cancellation.nativeReservationId});
 }
 const lineage=await records.successorProtectionLineage(state,request,originalOperation),slot=await records.load(CLEANUP85_REQUEST.parentOperationId,"successor-slot"),o=await state.loadOperation(state.profileHash("evm-live-buyer"),lineage.operationId);
 if(slot===null){if(o!==null)cleanup85Blocked("reservation_successor_slot_missing");return null;}
 if(o===null)cleanup85Blocked("reservation_slot_durable_operation");assertCleanup85NativeLineageOperation(state,o,lineage);
 if(canonicalJson(slot)!==canonicalJson(cleanup85NativeSlotBody(o,lineage)))cleanup85Blocked("reservation_slot_request_identity");
 return Object.freeze({operationId:o.operationId,fingerprint:o.fingerprint,nativeReservationId:o.evm!.cleanup85Cancellation!.nativeReservationId});
}
