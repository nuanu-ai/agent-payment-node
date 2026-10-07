import { canonicalJson } from "../../canonical.js";
import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import { ApnError } from "../../errors.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { SolanaRpc } from "../../solana/rpc.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapRuntime, GuardedSwapApprovalRepository, validateGuardedSwapApprovalArtifact, type GuardedSwapApprovalIntent } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { JupiterV1OwnerAdmission, detached } from "./v1-admission.js";
import { JupiterV1QuoteBuilder, type JupiterV1QuoteRequest } from "./v1-builder.js";
import { JupiterV1ExecutionBindingStore, JupiterV1LocalSigner } from "./v1-effects.js";
import { JupiterV1ExecutionDriver, JupiterV1SingleSender, JupiterV1BudgetedRpc } from "./v1-execution.js";
import { SavedJupiterV1MaterialStore, validateJupiterV1PreparedMaterial } from "./v1-material.js";
import { JUPITER_V1_PROTOCOL_REGISTRY, JUPITER_V1_WHIRLPOOL_MECHANISM_PIN } from "./v1-pins.js";
import { proveJupiterV1Quote } from "./v1-proof.js";
import { JupiterV1ReadOnlyProvider, jupiterV1HttpsFetch } from "./v1-provider.js";
import { JupiterV1MaterialResolver } from "./v1-resolver.js";

const canonicalRuntimes=new WeakMap<object,string>();
export function assertJupiterV1Runtime(runtime:object,root:string):void{if(canonicalRuntimes.get(runtime)!==root)blocked("Jupiter commands require the canonical finite V1 runtime for this state root.");}

export interface JupiterV1RuntimeOptions {
 readonly state:StateStore;readonly clock:ClockPort;readonly rpc:SolanaRpc;readonly wrappingSecret:WrappingSecretPort;
 readonly foreground:boolean;readonly stage:"quote"|"prepare"|"execute"|"observe";readonly operationId?:string;
 /** Official read-only API test transport. No injected signer, sender, custody, financial driver or approval actor. */
 readonly providerFetch?:typeof fetch;
}
/** Additive finite V1 lane. Existing V2/Quantum remains separately dormant. */
export function createJupiterV1Runtime(options:JupiterV1RuntimeOptions):GuardedSwapRuntime<JupiterV1QuoteRequest>{
 const {state,clock}=options,rpc=new JupiterV1BudgetedRpc(options.rpc,state.root,options.stage,options.operationId),usage=new AssetUsageLedger(state.root),operations=new SwapOperationRepository(state.root),core=new GuardedSwapService(operations,usage),
 materials=new SavedJupiterV1MaterialStore(state.root),bindings=new JupiterV1ExecutionBindingStore(state.root),native=new JupiterV1LocalSigner(state.root,options.wrappingSecret),
 activePolicy=(profile:string)=>loadActiveAssetPolicyRegistry({state,clock},profile);
 const admission=new JupiterV1OwnerAdmission({account:profile=>native.publicOwner(profile),ownerBinding:profile=>native.publicOwner(profile)},activePolicy,usage,()=>clock.now());
 const builder=new JupiterV1QuoteBuilder(new JupiterV1ReadOnlyProvider(async(input,init)=>{await rpc.chargeOfficialRead();return await (options.providerFetch??jupiterV1HttpsFetch)(input,init);}),new JupiterV1MaterialResolver(rpc),materials,{
 resolvePayer:async profile=>(await admission.resolve(profile,"1000000","1")).account.address,
 maximumNativeExpenseLamports:"6000000",computeUnitPriceMicroLamports:1000,
 proveQuote:async(execution,input)=>{
  const owner=await admission.resolve(input.profile,input.amountAtomic,execution.quoteResponse.otherAmountThreshold,input.account);
  if(owner.account.address!==execution.payer||input.recipient!==execution.payer||input.amountAtomic!=="1000000"||input.slippageBps!==50)blocked("Jupiter V1 admits only the exact owned 1,000,000-lamport SOL to USDC lane.");
  return await proveJupiterV1Quote(rpc,execution,{profile:input.profile,account:input.account,recipient:input.recipient,
   amountAtomic:input.amountAtomic,slippageBps:input.slippageBps,now:input.now},new Date(input.now.getTime()+90000).toISOString());
 }});
 const sender=new JupiterV1SingleSender(core,materials,bindings,native,rpc,clock),execution=new JupiterV1ExecutionDriver({core,materials,bindings,admission,native,sender,rpc,clock});
 class JupiterRuntime extends GuardedSwapRuntime<JupiterV1QuoteRequest>{
  override async quote(request:JupiterV1QuoteRequest,now:Date):Promise<unknown>{
   if(request.amountAtomic!=="1000000"||request.recipient!==request.account||request.slippageBps!==50||request.ownerSlippageCapBps<50)blocked("Jupiter V1 request is outside the admitted exact lane.");
   await admission.resolve(request.profile,request.amountAtomic,"1",request.account);const result=await super.quote(detached(request),now);
   if(result!==null&&typeof result==="object"&&"quoteHash" in result&&typeof result.quoteHash==="string")await rpc.bindQuote(result.quoteHash);else blocked("Jupiter quote did not supply its durable runtime budget binding.");return result;
  }
  override async prepare(request:{readonly profile:string;readonly quoteHash:string;readonly idempotencyKey:string},now:Date){
   const saved=await materials.load(request.quoteHash);if(saved===null)throw new ApnError("APN_OPERATION_NOT_FOUND","Jupiter quote was not found.");
   await admission.resolve(request.profile,saved.quote.inputAmountAtomic,saved.quote.minimumOutputAtomic,saved.quote.account);
   const operation=await super.prepare(detached(request),now),owner=await admission.assert(operation,saved);await bindings.bindPrepared(operation,owner,saved);return operation;
  }
  override async approve(operationId:string,_now:Date){
   if(!options.foreground)throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED","Open the exact Jupiter approval command in a foreground terminal.");
   const operation=detached(await required(operationId));if(operation.submissionMarker!==null)blocked("Jupiter's marker already exists; status must only observe.");
   if(!["awaiting_approval","reserved"].includes(operation.state))blocked("Jupiter operation is not awaiting its first foreground approval.");
   const material=detached(validateJupiterV1PreparedMaterial(await materials.load(operation.quote.quoteHash))),owner=await admission.assert(operation,material);
   await bindings.assertPrepared(operation,owner,material);
   const intent:GuardedSwapApprovalIntent=detached({operationId:operation.operationId,profile:operation.quote.profile,account:operation.quote.account,recipient:operation.quote.recipient,
    inputAmountAtomic:operation.quote.inputAmountAtomic,expectedOutputAtomic:operation.quote.expectedOutputAtomic,minimumOutputAtomic:operation.quote.minimumOutputAtomic,
    slippageBps:operation.quote.slippageBps,gasOrEnergy:material.gasOrEnergy,deadline:operation.quote.expiresAt,quoteHash:operation.quote.quoteHash,
    policyDigest:operation.policyDigest,mechanismDigest:operation.mechanismDigest,protocolRegistryDigest:operation.protocolRegistryDigest});
   const answer=await native.approve(operation,material,owner);
   const fresh=await required(operationId);if(fresh.integrityHash!==operation.integrityHash)blocked("Jupiter operation changed during approval.");
   const freshOwner=await admission.assert(fresh,material);if(canonicalJson(owner)!==canonicalJson(freshOwner))blocked("Jupiter owner admission changed during approval.");
   const artifact=validateGuardedSwapApprovalArtifact(answer,fresh,intent,clock.now());
   if(fresh.state==="reserved")return fresh;
   const policy=await activePolicy(operation.quote.profile);if(policy===null)blocked("Jupiter owner policy was revoked.");
   const reserved=await core.reserve(fresh,policy.registry,new Date(artifact.approvedAt));await this.dependencies.approvals.store(reserved,artifact);return reserved;
  }
  override async execute(operationId:string,now:Date){
   const operation=await required(operationId);if(operation.submissionMarker!==null)return await super.status(operationId,now);await rpc.bindOperation(operation.quote.quoteHash);
   if(!native.hasForegroundGrant(operation))await this.approve(operationId,now);
   return await super.execute(operationId,clock.now());
  }
 }
 async function required(operationId:string){const op=await operations.loadAny(operationId);if(op===null)throw new ApnError("APN_OPERATION_NOT_FOUND","Jupiter operation was not found.");return op;}
 const runtime=new JupiterRuntime({chain:JUPITER_V1_WHIRLPOOL_MECHANISM_PIN.chain,builder,policy:async profile=>(await activePolicy(profile))?.registry??null,clock,
 protocolRegistry:JUPITER_V1_PROTOCOL_REGISTRY,usage,operations,ownerAdmission:admission,foregroundApproval:{approve:async()=>{throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED","Use Jupiter's finite Native foreground approval.");}},
 execution,approvals:new GuardedSwapApprovalRepository(state.root),rpc,effectStore:native,signer:native,sender,observer:execution,caps:{approvalCapAtomic:"0",maximumNativeExpenseLamports:"6000000",logicalReadStageCap:"64",cumulativeReadCap:"192"}});
 canonicalRuntimes.set(runtime,state.root);return runtime;
}
function blocked(message:string):never{throw new ApnError("APN_OPERATION_BLOCKED",message,{reason:"jupiter_v1_runtime_binding"});}
