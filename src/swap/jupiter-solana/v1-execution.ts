import { canonicalJson, domainHash, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import { rpcAtomic, SolanaRpc, solanaSignature, type SolanaMethod, type SolanaBatchRead } from "../../solana/rpc.js";
import type { SwapOperationRecord, SwapReceiptEconomics } from "../model.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../runtime.js";
import type { GuardedSwapService } from "../service.js";
import type { JupiterV1OwnerAdmission } from "./v1-admission.js";
import { detached } from "./v1-admission.js";
import { createJupiterV1ExecutionBinding, type JupiterV1ExecutionBindingStore, JupiterV1LocalSigner } from "./v1-effects.js";
import { guardJupiterV1WhirlpoolMaterial, validateJupiterV1GuardedMaterial } from "./v1-guard.js";
import { jupiterV1SameMessageExceptLifetime, validateJupiterV1PreparedMaterial, type SavedJupiterV1MaterialStore } from "./v1-material.js";
import { proveJupiterV1Simulation, validateFinalizedJupiterV1Receipt, type JupiterV1SimulationProof } from "./v1-proof.js";
import type { JupiterV1ResolvedMaterial } from "./v1-material.js";
import { JupiterV1MaterialResolver } from "./v1-resolver.js";
import { routeConfigForMaterial } from "./v1-route-config.js";
import { JupiterV1DispatchStore, jupiterV1DispatchResult } from "./v1-dispatch.js";
import { JupiterV1ExecutionFailureStore } from "./v1-execution-failure.js";
import { proveSolanaUnlanded, type SwapUnlandedProof } from "../unlanded.js";

/** The public sender reloads durable ownership and consumes its fsynced create-only claim under the operation lock. */
export class JupiterV1SingleSender {
 constructor(private readonly core:GuardedSwapService,private readonly materials:SavedJupiterV1MaterialStore,
 private readonly bindings:JupiterV1ExecutionBindingStore,private readonly native:JupiterV1LocalSigner,
 private readonly rpc:SolanaRpc,private readonly clock:ClockPort){JupiterV1LocalSigner.assertGenuine(native,core.operations.root);}
 async sendOnce(operationId:string):Promise<SwapOperationRecord>{return await this.core.operations.withLocks([`jupiter-v1-operation:${operationId}`],async()=>{
  const op=await this.core.operations.loadAny(operationId);if(op===null)throw new ApnError("APN_OPERATION_NOT_FOUND","Jupiter operation was not found.");
  if(op.state!=="submitting"||op.submissionMarker===null||await this.bindings.loadClaim(op)!==null)blocked("Jupiter's first send is already consumed or unavailable.");
  const material=await this.materials.load(op.quote.quoteHash);if(material===null)corrupt();const binding=await this.bindings.load(op,material);if(binding===null)corrupt();
  let observedHeight:string|null=null,lastValid=material.execution.lifetime.lastValidBlockHeight;
  try{
  const {fresh}=await this.bindings.loadFresh(op,binding);lastValid=fresh.lifetime.lastValidBlockHeight;await validateJupiterV1GuardedMaterial(await guardJupiterV1WhirlpoolMaterial(fresh,{deadline:op.quote.expiresAt}));
  const effect=await this.native.savedEffect(op,binding);if(effect===null)corrupt();
  const height=rpcAtomic(await this.rpc.call("getBlockHeight",[{commitment:"confirmed"}]));observedHeight=height.toString();if(height>BigInt(fresh.lifetime.lastValidBlockHeight))blocked("Jupiter's frozen blockhash expired before send.");
  const at=this.clock.now();if(at.toISOString()>=op.quote.expiresAt||at.getTime()-Date.parse(binding.checkedAt)>30000||this.rpc.budget===undefined||
   this.rpc.budget.remainingPhysicalRequests<1||!this.rpc.hasPersistentPacer)blocked("Jupiter send freshness or runtime RPC budget is unavailable.");
  // Persist before any transport. A crash from here permanently makes this operation observe-only.
  await this.native.assertDispatchAdmission(op,binding);
  await this.bindings.claim(op,binding,effect,at);let state:"submitted"|"unknown_finality"="unknown_finality",dispatch=jupiterV1DispatchResult("signature_mismatch");
  try{const returned=await this.rpc.sendTransactionAtStart([effect.rawPayload,{encoding:"base64",skipPreflight:false,preflightCommitment:"confirmed",maxRetries:0}],async()=>{
   await this.native.assertDispatchAdmission(op,binding);
   if(this.clock.now().toISOString()>=op.quote.expiresAt||this.clock.now().getTime()-Date.parse(binding.checkedAt)>30000)blocked("Jupiter expired before physical send.");
  });if(solanaSignature(returned)===effect.transactionId){state="submitted";dispatch=jupiterV1DispatchResult("acknowledged");}}
  catch(error){dispatch=jupiterV1DispatchResult("error",error);/* The permanent claim remains consumed even when transport is ambiguous. */}
  await new JupiterV1DispatchStore(this.core.operations.root).save(op,binding.bindingHash,dispatch,this.clock.now());
  return await this.core.recordPossibleSend(op,state,this.clock.now());
  }catch(error){
   // A diagnostic cannot release the marked lease or restore a first-send grant.
   if(await this.bindings.loadClaim(op)===null)await new JupiterV1ExecutionFailureStore(this.core.operations.root).save(op,"sender_preflight",error,lastValid,observedHeight,this.clock.now());
   throw error;
  }
 });}
}
/** Executable bytes, exact-message simulation and balance deltas proved before the owner's prompt, for the send after it. */
export interface JupiterV1PreconsentProof {readonly operationId:string;readonly materialDigest:string;readonly fresh:JupiterV1ResolvedMaterial;readonly simulation:JupiterV1SimulationProof}
/**
 * Every program-byte, account and simulation check that can fail runs before consent, against the exact message signed
 * after it. The approval freezes its own lifetime: the configured RPC's latest blockhash, read after this command's fresh
 * account reads, so the human gets a whole blockhash lifetime instead of what the quote and prepare commands left of the
 * quote's. Only those 32 bytes are new; every instruction, account, privilege, lookup table and program authority must
 * be the quoted one. After the prompt only the lifetime reserve, the local owner re-check, the marker, the signature and
 * the one send remain.
 */
export async function proveJupiterV1Preconsent(rpc:SolanaRpc,clock:ClockPort,op:SwapOperationRecord,materialValue:unknown):Promise<JupiterV1PreconsentProof>{
 const material=validateJupiterV1PreparedMaterial(materialValue),quoted=material.execution;
 let fresh:JupiterV1ResolvedMaterial;
 try{fresh=await new JupiterV1MaterialResolver(rpc).resolve(quoted.payer,quoted.quoteResponse,quoted.rawBuildResponse,quoted.maximumNativeExpenseLamports,undefined,routeConfigForMaterial(quoted).routeId,true);}
 catch(error){
  // A lifetime outside the window ends this approval, not the operation: nothing was marked, so it may approve again.
  if(error instanceof ApnError&&error.code==="APN_REPREPARE_REQUIRED"&&error.details?.minimumRemainingBlocks!==undefined)throw new ApnError("APN_OPERATION_BLOCKED",
   "The configured Solana RPC answered a blockhash outside the approval lifetime window; nothing was signed, approve again.",{...error.details,reason:"jupiter_v1_approval_lifetime_window"});
  throw error;
 }
 // A routine upgrade by the pinned authority between quote and consent is accepted: the simulation below runs against the
 // program as deployed now. The program identities and authorities must stay those the quote was built with.
 if(fresh.lookupBindingDigest!==quoted.lookupBindingDigest||!jupiterV1SameMessageExceptLifetime(quoted.messageBase64,fresh.messageBase64)||
  canonicalJson(programIdentities(fresh))!==canonicalJson(programIdentities(quoted)))blocked("Jupiter's frozen message, lookup or program authority changed.");
 const guarded=await guardJupiterV1WhirlpoolMaterial(fresh,{now:clock.now().getTime(),deadline:op.quote.expiresAt}),simulation=await proveJupiterV1Simulation(rpc,guarded);
 return detached({operationId:op.operationId,materialDigest:material.execution.materialDigest,fresh,simulation});
}
function programIdentities(m:JupiterV1ResolvedMaterial){return m.programPins.map(({programId,loader,programDataAddress,upgradeAuthority})=>({programId,loader,programDataAddress,upgradeAuthority}));}
export interface JupiterV1ExecutionDependencies {
 readonly core:GuardedSwapService;readonly materials:SavedJupiterV1MaterialStore;readonly bindings:JupiterV1ExecutionBindingStore;
 readonly admission:JupiterV1OwnerAdmission;readonly native:JupiterV1LocalSigner;readonly sender:JupiterV1SingleSender;
 readonly rpc:SolanaRpc;readonly clock:ClockPort;
 /** Filled by the foreground approval of this process before its prompt; consumed once by the first execution. */
 readonly preconsent:Map<string,JupiterV1PreconsentProof>;
}
export class JupiterV1ExecutionDriver implements GuardedSwapExecutionDriver {
 constructor(private readonly d:JupiterV1ExecutionDependencies){JupiterV1LocalSigner.assertGenuine(d.native,d.core.operations.root);}
 async execute(input:GuardedSwapExecutionInput):Promise<SwapOperationRecord>{
  const op=detached(input.operation),material=detached(validateJupiterV1PreparedMaterial(input.material));
  if(op.state!=="reserved"||op.submissionMarker!==null||!this.d.native.hasForegroundGrant(op))blocked("A fresh genuine TTY grant is required before Jupiter's first effect marker.");
  const admission=await this.d.admission.assert(op,material);await this.d.bindings.assertPrepared(op,admission,material);
  // The executable bytes and the exact-message simulation were proved before the prompt; only their use remains here.
  const proved=this.d.preconsent.get(op.operationId);this.d.preconsent.delete(op.operationId);
  if(proved===undefined||proved.materialDigest!==material.execution.materialDigest)blocked("Jupiter's pre-consent executable and simulation proof is missing; approve again in this terminal.");
  const {fresh,simulation}=proved;
  const height=rpcAtomic(await this.d.rpc.call("getBlockHeight",[{commitment:"confirmed"}]));if(height>BigInt(fresh.lifetime.lastValidBlockHeight))blocked("Jupiter's frozen blockhash expired before signing.");
  // Leave a bounded reserve for custody, final ownership checks, paced send and preflight.
  // This refuses before any marker or signature; it never replaces the frozen lifetime.
  if(BigInt(fresh.lifetime.lastValidBlockHeight)-height<24n)throw new ApnError("APN_REPREPARE_REQUIRED","Jupiter's frozen blockhash has insufficient reserve before signing.",{remainingBlocksAtomic:(BigInt(fresh.lifetime.lastValidBlockHeight)-height).toString(),minimumRemainingBlocksAtomic:"24"});
  const currentAdmission=await this.d.admission.assert(op,material);if(canonicalJson(currentAdmission)!==canonicalJson(admission))blocked("Jupiter's owner or active policy changed after simulation.");
  let signed=false;
  const marked=await this.d.core.operations.withLocks([`jupiter-v1-operation:${op.operationId}`],async()=>{
   const current=await this.d.core.operations.loadAny(op.operationId);if(current===null)corrupt();if(current.submissionMarker!==null)return current;
   if(current.integrityHash!==op.integrityHash)blocked("Jupiter's operation changed concurrently.");
   const checkedAt=this.d.clock.now();if(checkedAt.toISOString()>=op.quote.expiresAt)blocked("Jupiter's approval expired before its effect marker.");
   const marked=await this.d.core.markSubmitting(current,checkedAt);
   try{const binding=createJupiterV1ExecutionBinding(marked,material,currentAdmission,simulation,checkedAt,fresh);
    await this.d.bindings.saveFresh(marked,fresh,simulation);await this.d.bindings.save(marked,binding,material);
    await this.d.native.sign(marked,binding,material,currentAdmission);signed=true;return marked;
   }catch(error){
    try{await new JupiterV1ExecutionFailureStore(this.d.core.operations.root).save(marked,"binding_and_sign",error,fresh.lifetime.lastValidBlockHeight,null,this.d.clock.now());}catch{/* Diagnostic failure never grants a retry of this marked operation. */}
    return await this.d.core.recordPossibleSend(marked,"unknown_finality",this.d.clock.now());}
  });
  if(!signed)return marked;
  let result:SwapOperationRecord;try{result=await this.d.sender.sendOnce(marked.operationId);}catch{return await this.observe({ ...input,operation:marked });}
  return await this.observe({...input,operation:result});
 }
 async observe(input:GuardedSwapObservationInput):Promise<SwapOperationRecord>{return await this.d.core.operations.withLocks([`jupiter-v1-operation:${input.operation.operationId}`],async()=>{
  let op=await this.d.core.operations.loadAny(input.operation.operationId);if(op===null)corrupt();if(op.submissionMarker===null)blocked("Jupiter observation requires its durable effect marker.");
  if(["finalized","failed_confirmed_revert","expired_unlanded","abandoned_unknown"].includes(op.state))return op;
  if(op.state==="submitting")op=await this.d.core.recordPossibleSend(op,"unknown_finality",this.d.clock.now());
  const material=validateJupiterV1PreparedMaterial(input.material),binding=await this.d.bindings.load(op,material);if(binding===null)return op;
  // Read the public signature marker first. Status never decrypts custody and never signs or sends.
  const signature=await this.d.bindings.loadSignature(op,binding);if(signature===null)return op;
  const claim=await this.d.bindings.loadClaim(op);if(claim!==null&&claim.signature!==signature)corrupt();
  const {fresh}=await this.d.bindings.loadFresh(op,binding),guarded=await guardReceipt(fresh);
  // Only the chain answer may leave the operation pending: no finalized status yet, or a failed or refused read.
  let receipt:Awaited<ReturnType<typeof validateFinalizedJupiterV1Receipt>>;
  try{receipt=await validateFinalizedJupiterV1Receipt(this.d.rpc,guarded,{signature});}catch{return op;}
  // A finalized receipt is always recorded. One clock read is both the transition instant and the proof's observedAt:
  // two reads could straddle a millisecond and fail the receipt time binding (observedAt after the transition).
  const at=this.d.clock.now();
  // The finalized receipt proved spend = exact input + fee - closed wSOL refund; its own output, fee and spend are the facts.
  return await this.d.core.finalize(op,at,{receiptHash:receipt.receiptHash,transactionHash:receipt.signature,observedAt:at.toISOString(),finalized:true,
   economics:{inputAtomic:guarded.inputAtomic,outputAtomic:receipt.recipientOutputAtomic,networkFeeAtomic:receipt.feeLamports,nativeDebitAtomic:receipt.nativeSpendLamports}});
 });}
 async proveUnlanded(input:GuardedSwapObservationInput):Promise<SwapUnlandedProof|null>{return await proveJupiterV1Unlanded(this.d,input);}
 /** A swap finalized before its economics were recorded: its own finalized receipt read once more (observe only). */
 async receiptEconomics(input:GuardedSwapObservationInput):Promise<SwapReceiptEconomics>{
  const op=input.operation,material=validateJupiterV1PreparedMaterial(input.material),binding=await this.d.bindings.load(op,material);
  const signature=binding===null?null:await this.d.bindings.loadSignature(op,binding);
  if(binding===null||signature===null||signature!==op.receiptProof?.transactionHash||op.state!=="finalized")throw new ApnError("APN_RPC_PROTOCOL","Jupiter receipt facts need the record's proven signature.",{reason:"receipt_facts_binding"});
  const guarded=await guardReceipt((await this.d.bindings.loadFresh(op,binding)).fresh),receipt=await validateFinalizedJupiterV1Receipt(this.d.rpc,guarded,{signature});
  return {inputAtomic:guarded.inputAtomic,outputAtomic:receipt.recipientOutputAtomic,networkFeeAtomic:receipt.feeLamports,nativeDebitAtomic:receipt.nativeSpendLamports};
 }
}
/** Under the operation lock that marking, signing and the single send hold: the frozen lifetime passed at finality and
 * the persisted signature, if any, has no status. Nothing is decrypted, signed or sent. */
export async function proveJupiterV1Unlanded(d:Pick<JupiterV1ExecutionDependencies,"core"|"bindings"|"rpc">,input:GuardedSwapObservationInput):Promise<SwapUnlandedProof|null>{
 return await d.core.operations.withLocks([`jupiter-v1-operation:${input.operation.operationId}`],async()=>{
  const op=await d.core.operations.loadAny(input.operation.operationId);if(op===null)corrupt();
  if(op.submissionMarker===null||op.receiptProof!==null||!["submitting","submitted","unknown_finality"].includes(op.state))return null;
  const material=validateJupiterV1PreparedMaterial(input.material),binding=await d.bindings.load(op,material);
  // The bound fresh message is the only one ever signed, so its lifetime (the approval's) bounds landing, not the quote's.
  // Without a binding nothing was signed (signing follows the binding), so the quoted lifetime bounds nothing that exists.
  const lastValidBlockHeight=binding===null?material.execution.lifetime.lastValidBlockHeight:(await d.bindings.loadFresh(op,binding)).fresh.lifetime.lastValidBlockHeight;
  return await proveSolanaUnlanded(d.rpc,{lastValidBlockHeight,loadSignature:async()=>{
   const bound=await d.bindings.load(op,material);return bound===null?null:await d.bindings.loadSignature(op,bound);}});
 });
}
async function guardReceipt(fresh:Parameters<typeof guardJupiterV1WhirlpoolMaterial>[0]){
 return await guardJupiterV1WhirlpoolMaterial(fresh);
}
function blocked(message:string):never{throw new ApnError("APN_OPERATION_BLOCKED",message,{reason:"jupiter_v1_execution_boundary"});}
function corrupt():never{throw new ApnError("APN_STATE_CORRUPT","Jupiter V1 execution evidence is missing or changed.");}

/**
 * The Jupiter rail transport: the configured Solana RPC with its per-command physical budget (solanaSwapCommandRequests)
 * and persistent provider pacing. No read budget is stored or carried across commands (SWAP-19), so retrying a command
 * after a rate limit never exhausts an operation. A height read uses a one-element batch: PublicNode returns another
 * shape for the scalar call.
 */
export class JupiterV1BudgetedRpc extends SolanaRpc{
 override readonly originHash:string;override readonly budget:SolanaRpc["budget"];
 constructor(private readonly base:SolanaRpc){super();this.originHash=base.originHash;this.budget=base.budget;}
 override get hasPersistentPacer(){return this.base.hasPersistentPacer;}
 override async call(method:SolanaMethod,params:readonly unknown[]):Promise<unknown>{
  if(method==="getBlockHeight"&&typeof this.base.batch==="function"){
   const results=await this.base.batch([{method,params}]);
   if(!Array.isArray(results)||results.length!==1)throw new ApnError("APN_RPC_PROTOCOL","Jupiter height batch is incomplete.");
   return results[0];
  }
  return await this.base.call(method,params);}
 override async batch(reads:readonly SolanaBatchRead[]):Promise<readonly unknown[]>{return await this.base.batch(reads);}
 override async sendTransactionAtStart(params:readonly unknown[],beforeStart:()=>void|Promise<void>):Promise<unknown>{return await this.base.sendTransactionAtStart(params,beforeStart);}
}
