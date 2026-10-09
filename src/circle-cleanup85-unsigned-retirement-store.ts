import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { SecureStateStore } from "./secure-state-store.js";
import { validateOperation, appendTransition, sealOperation } from "./state-integrity.js";
import { DirectPublicEffectJournal } from "./direct-public-effect.js";
import { EvmDirectSubmissionJournal } from "./evm-direct-submission.js";
import { AssetUsageLedger } from "./asset-usage-ledger.js";
import { Cleanup85NativePublicRecords } from "./circle-cleanup85-native-records.js";
import { assertCleanup85NativeSlot } from "./circle-cleanup85-native-ledger-authority.js";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
import type { OperationRecord } from "./model.js";
import type { Cleanup85RecoveryIntent } from "./circle-v2-evm/cleanup85-recovery-store.js";
import type { StateStore } from "./state.js";
export const CLEANUP85_UNSIGNED_ORIGINAL = "4b5fc09e077b6c171083edb6c89ce31b5f8e881e1db4f279a866548aade0aef1";
export const CLEANUP85_UNSIGNED_FINGERPRINT = "9fc2d56c8a231489251178dade7a47f4d6807f3ddd454080d1b2e9119b81bcf5";
export interface Cleanup85UnsignedRetirementProof {
 readonly version: "apn.cleanup85-expired-unsigned-retirement.v1";
 readonly original: OperationRecord;
 readonly slot: unknown;
 readonly prepared: unknown;
 readonly readmission: Cleanup85RecoveryIntent;
 readonly retiredAt: string;
 readonly proofHash: string;
}
export function cleanup85UnsignedTerminal(p: Cleanup85UnsignedRetirementProof): OperationRecord {
 const {integrityHash:_,...original}=p.original;
 const transition={at:p.retiredAt,state:"failed_before_effect" as const,terminal:true,reason:`cleanup85_expired_unsigned_retired:${p.proofHash}`,proofClass:"durable_pre_effect" as const};
 return sealOperation({...original,state:transition.state,terminal:transition.terminal,reason:transition.reason,proofClass:transition.proofClass,transitions:appendTransition(original.transitions,transition)});
}
export class Cleanup85UnsignedRetirementStore extends SecureStateStore {
 private path(){return `circle-cleanup85-recovery/${CLEANUP85_UNSIGNED_ORIGINAL}-unsigned-retirement.json`;}
 async load():Promise<Cleanup85UnsignedRetirementProof|null>{const v=await this.readJson(this.path());if(v===null)return null;return this.validate(v);}
 validate(v:unknown):Cleanup85UnsignedRetirementProof{
  if(!isPlainRecord(v)||!exactKeys(v,["version","original","slot","prepared","readmission","retiredAt","proofHash"])||v.version!=="apn.cleanup85-expired-unsigned-retirement.v1"||typeof v.retiredAt!=="string"||!Number.isFinite(Date.parse(v.retiredAt))||new Date(v.retiredAt).toISOString()!==v.retiredAt)cleanup85Blocked("unsigned_retirement_proof_shape");
  const p=v as unknown as Cleanup85UnsignedRetirementProof,{proofHash,...body}=p,o=validateOperation(p.original);
  if(proofHash!==hashObject(body)||o.operationId!==CLEANUP85_UNSIGNED_ORIGINAL||o.fingerprint!==CLEANUP85_UNSIGNED_FINGERPRINT||o.integrityHash!=="4ef03d808f8a7ad75289c12c254e968fea717e73db05cf865ccc096493b9dd90"||hashObject(p.slot)!=="dd3189ea1dfee12747a784292d9f0fd2fcbcc4aa8c65a53bf49bcf2a2f034708"||hashObject(p.prepared)!=="2ef3caffb1506b0a162a87331c94f03d6a5609ae0da95772fd4f2d2020a937ea"||o.state!=="awaiting_approval"||o.terminal||o.allowlistLease!==undefined||o.transactionHash!==undefined||o.rawTransactionHash!==undefined||o.lastSubmissionAt!==undefined||o.providerEffect!==undefined||Date.parse(p.retiredAt)<Date.parse(o.expiresAt))cleanup85Blocked("unsigned_retirement_exact_original");
  return p;
 }
 async publish(p:Cleanup85UnsignedRetirementProof):Promise<void>{this.validate(p);const old=await this.load();if(old!==null){if(canonicalJson(old)!==canonicalJson(p))cleanup85Blocked("unsigned_retirement_replacement");return;}await this.initialize();await this.ensureDirectory("circle-cleanup85-recovery");await this.writeJson(this.path(),p,true);}
 async prepared(o:OperationRecord):Promise<unknown>{return this.readJson(`direct-public-effects/${o.profileHash}/${o.operationId}.prepared.json`);}
 async assertAbsence(state:StateStore,o:OperationRecord):Promise<void>{
  if(await this.readJson(`direct-public-effects/${o.profileHash}/${o.operationId}.signing.json`)!==null||await this.readJson(`direct-public-effects/${o.profileHash}/${o.operationId}.signed.json`)!==null||await new EvmDirectSubmissionJournal(state.root).exists(o))cleanup85Blocked("unsigned_retirement_permanent_effect_claim");
  const b=o.evm?.cleanup85Cancellation;if(b===undefined||await new AssetUsageLedger(state.root).load({account:o.walletAddress,chain:"eip155:42161",asset:{kind:"native",identifier:null}},b.nativeReservationId)!==null)cleanup85Blocked("unsigned_retirement_reservation");
 }
 async verifyRetained(state:StateStore,p:Cleanup85UnsignedRetirementProof,allowOriginal=false):Promise<OperationRecord>{
  this.validate(p);const saved=await state.findOperation(p.original.operationId),terminal=cleanup85UnsignedTerminal(p);
  if(saved===null||canonicalJson(saved)!==canonicalJson(terminal)&&(!allowOriginal||canonicalJson(saved)!==canonicalJson(p.original)))cleanup85Blocked("unsigned_retirement_durable_terminal");
  await assertCleanup85NativeSlot(state,saved);await new DirectPublicEffectJournal(state).prepared(saved);await this.assertAbsence(state,saved);
  if(canonicalJson(await new Cleanup85NativePublicRecords(state.root).load(p.original.evm!.cleanup85Cancellation!.request.parentOperationId,"slot"))!==canonicalJson(p.slot)||canonicalJson(await this.prepared(saved))!==canonicalJson(p.prepared))cleanup85Blocked("unsigned_retirement_retained_records");
  return saved;
 }
}
