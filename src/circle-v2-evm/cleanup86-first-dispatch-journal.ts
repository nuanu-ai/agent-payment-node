import { hashObject, isPlainRecord } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import { Cleanup86Store, validateCleanup86Effect, type Cleanup86Intent } from "./cleanup86-store.js";
import { Cleanup86SnapshotStore, type Cleanup86Snapshot } from "./cleanup86-snapshot.js";
import { type Cleanup86FirstDispatchPurpose } from "./cleanup86-first-dispatch-purpose.js";
import { validateCleanup86FirstDispatchAnchor, validateCleanup86FirstDispatchHistory, type Cleanup86FirstDispatchAnchor, type Cleanup86FirstDispatchHistory } from "./cleanup86-first-dispatch-record.js";
import { assertCleanup86FirstDispatchJournalBinding, type Cleanup86FirstDispatchGrant, type Cleanup86FirstDispatchBinding } from "./cleanup86-first-dispatch-authority.js";
function detached<T>(v:T):T { const copy=structuredClone(v); const freeze=(x:unknown):void=>{if(x!==null&&typeof x==="object"){for(const y of Object.values(x))freeze(y);Object.freeze(x);}};freeze(copy);return copy;}
const admitted = new WeakSet<Cleanup86FirstDispatchJournal>(), admissionKey=Symbol("private-cleanup86-first-dispatch-admission");
export function assertAuthenticatedCleanup86FirstDispatchJournal(journal:Cleanup86FirstDispatchJournal,grant:Cleanup86FirstDispatchGrant,binding:Cleanup86FirstDispatchBinding):void {
  if(!admitted.has(journal)) circleBlocked("cleanup86_private_first_dispatch_journal_required");
  assertCleanup86FirstDispatchJournalBinding(grant,binding,journal);
}
export function assertAdmittedCleanup86FirstDispatchJournal(journal:Cleanup86FirstDispatchJournal,binding:Cleanup86FirstDispatchBinding):void {
  if(!admitted.has(journal)||journal.root!==binding.root||journal.operation.operationId!==binding.operationId||journal.intent.intentHash!==binding.intentHash||journal.intent.recoveryBinding!==binding.recoveryId||journal.intent.envelope.envelopeHash!==binding.envelopeHash||hashObject(journal.metadata())!==hashObject({transactionHash:binding.transactionHash,materialHash:binding.materialHash})) circleBlocked("cleanup86_private_first_dispatch_journal_required");
}

/** Complete immutable original journal plus a separate create-only first-dispatch namespace. */
export class Cleanup86FirstDispatchJournal extends SecureStateStore {
  #expected: Cleanup86Snapshot;
  readonly #original: Cleanup86Snapshot;
  #anchor: Cleanup86FirstDispatchAnchor | undefined;
  #history: Cleanup86FirstDispatchHistory | undefined;
  private constructor(key:symbol,root:string,readonly operation:CircleOperationV1,readonly intent:Cleanup86Intent,original:Cleanup86Snapshot) { super(root); if(key!==admissionKey) circleBlocked("cleanup86_private_first_dispatch_journal_required"); this.#original=detached(original); this.#expected=this.#original; this.operation=detached(operation); this.intent=detached(intent); admitted.add(this); Object.freeze(this); }
  static async admit(root:string,op:CircleOperationV1,i:Cleanup86Intent):Promise<Cleanup86FirstDispatchJournal> {
    if(i.version!=="apn.circle-cleanup86-intent.v5") circleBlocked("cleanup86_first_dispatch_generation_required");
    const store=new Cleanup86Store(root); await store.assertGeneration(op,i);
    const s=await new Cleanup86SnapshotStore(root).capture(op.operationId), prefix=`${op.operationId}-cleanup86-`;
    const kinds=["intent","generation-1-intent","effect","history-0","generation-2-intent","generation-2-effect","generation-2-history-0","generation-2-history-1","generation-2-history-2","generation-2-history-3","sign","material","first-failure"];
    if(hashObject(Object.keys(s.entries).sort())!==hashObject(kinds.map(k=>`${prefix}${k}.json`).sort())||!await store.claimed(op,i,"sign")||await store.claimed(op,i,"send")) circleBlocked("cleanup86_first_dispatch_provenance_required_existing_observe_only");
    const histories=[0,1,2,3].map(n=>validateCleanup86Effect(s.entries[`${prefix}generation-2-history-${n}.json`]!.value,i));
    for(const [n,h] of histories.entries()) if(h.sequence!==n||h.phase!==["prepared","signing_started","sealed","unknown"][n]||h.previousHash!==(n===0?null:histories[n-1]!.effectHash)||n<2&&h.transactionHash!==null||n>=2&&h.transactionHash===null) circleBlocked("cleanup86_first_dispatch_ordered_history_required");
    const effect=validateCleanup86Effect(s.entries[`${prefix}generation-2-effect.json`]!.value,i), sealed=histories[2]!, unknown=histories[3]!;
    if(hashObject(effect)!==hashObject(unknown)||unknown.transactionHash!==sealed.transactionHash||unknown.materialHash!==sealed.materialHash) circleBlocked("cleanup86_first_dispatch_sealed_identity_changed");
    const h=s.entries[`${prefix}material.json`]!.value;
    if(!isPlainRecord(h)||h.transactionHash!==sealed.transactionHash||h.materialHash!==sealed.materialHash||h.intentHash!==i.intentHash||h.envelopeHash!==i.envelope.envelopeHash) circleBlocked("cleanup86_first_dispatch_material_changed");
    const failure=await store.failure(op,i); if(!isPlainRecord(failure)||failure.code!=="APN_OPERATION_BLOCKED"||Object.keys(failure).sort().join(",")!==["code","failureHash","intentHash","version"].sort().join(",")) circleBlocked("cleanup86_first_dispatch_failure_provenance_required");
    // All secure identities, original ordered history and absence witnesses are rechecked twice.
    await store.assertGeneration(op,i); if(hashObject(s)!==hashObject(await new Cleanup86SnapshotStore(root).capture(op.operationId))) circleBlocked("cleanup86_snapshot_drift");
    return new Cleanup86FirstDispatchJournal(admissionKey,root,op,i,s);
  }
  metadata():{transactionHash:`0x${string}`;materialHash:string} { const e=validateCleanup86Effect(this.#original.entries[`${this.operation.operationId}-cleanup86-generation-2-effect.json`]!.value,this.intent); return {transactionHash:e.transactionHash!,materialHash:e.materialHash!}; }
  async assertStable():Promise<void> { if(hashObject(await new Cleanup86SnapshotStore(this.root).capture(this.operation.operationId))!==hashObject(this.#expected)) circleBlocked("cleanup86_snapshot_drift"); }
  protected override async beforeCreateOnlyPublication():Promise<void> { await this.assertStable(); }
  private path(kind:string) { return `circle-cleanup85-recovery/${this.operation.operationId}-cleanup86-first-dispatch-${kind}.json`; }
  private async adopt(kind:string,value:unknown):Promise<void> {
    const next=await new Cleanup86SnapshotStore(this.root).capture(this.operation.operationId),name=`${this.operation.operationId}-cleanup86-${kind}.json`,entry=next.entries[name];
    if(entry===undefined||hashObject(entry.value)!==hashObject(value)||this.#expected.entries[name]!==undefined||hashObject({...this.#expected,entries:{...this.#expected.entries,[name]:entry}})!==hashObject(next)) circleBlocked("cleanup86_snapshot_drift");
    this.#expected=next;
  }
  async authorize(purpose:Cleanup86FirstDispatchPurpose):Promise<void> {
    await this.assertStable(); if(this.#anchor!==undefined) circleBlocked("cleanup86_first_dispatch_already_authorized");
    const body={version:"apn.circle-cleanup86-first-dispatch-anchor.v1" as const,purpose,originalParent:this.operation,originalSnapshotHash:hashObject(this.#original),originalArtifacts:Object.fromEntries(Object.entries(this.#original.entries).map(([n,e])=>[n,e.identity]))};
    const a=validateCleanup86FirstDispatchAnchor({...body,anchorHash:hashObject(body)},this.intent);
    await this.writeJson(this.path("anchor"),a,true); await this.adopt("first-dispatch-anchor",a); this.#anchor=a;
    await this.append("authorized");
  }
  async append(phase:Cleanup86FirstDispatchHistory["phase"]):Promise<void> {
    await this.assertStable(); if(this.#anchor===undefined) circleBlocked("cleanup86_first_dispatch_anchor_required");
    const b=this.#anchor.purpose.binding,body={version:"apn.circle-cleanup86-first-dispatch-history.v1" as const,anchorHash:this.#anchor.anchorHash,intentHash:b.intentHash,transactionHash:b.transactionHash,materialHash:b.materialHash,phase,sequence:(this.#history?.sequence??-1)+1,previousHash:this.#history?.historyHash??null};
    const h=validateCleanup86FirstDispatchHistory({...body,historyHash:hashObject(body)},this.#anchor);
    await this.writeJson(this.path(`history-${h.sequence}`),h,true); await this.adopt(`first-dispatch-history-${h.sequence}`,h); this.#history=h;
  }
  async claimSend():Promise<void> {
    await this.assertStable(); if(this.#history?.phase!=="submission_started") circleBlocked("cleanup86_first_dispatch_submission_required");
    const store=new Cleanup86Store(this.root),effect=await store.effect(this.operation,this.intent);
    if(effect===null||effect.phase!=="unknown"||await store.claimed(this.operation,this.intent,"send")) circleBlocked("cleanup86_first_dispatch_observe_only");
    if(!await store.claimed(this.operation,this.intent,"sign")) circleBlocked("cleanup86_sign_claim_required");
    await store.assertGeneration(this.operation,this.intent); await this.assertStable();
    const value={version:"apn.circle-cleanup86-claim.v1",boundary:"send",intentHash:this.intent.intentHash,recoveryBinding:this.intent.recoveryBinding,cancellationProofHash:this.intent.cancellationProofHash,transactionHash:effect.transactionHash,materialHash:effect.materialHash};
    // Same global path/shape and atomic O_EXCL link publication, with complete secure snapshot
    // checked again at the create-only publication seam. There is no per-generation SEND.
    await this.writeJson(`circle-cleanup85-recovery/${this.operation.operationId}-cleanup86-send.json`,value,true); await this.adopt("send",value);
  }
}
