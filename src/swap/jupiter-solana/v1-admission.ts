import { canonicalJson, domainHash } from "../../canonical.js";
import { evaluateAssetPolicy } from "../../asset-policy-registry.js";
import type { ActiveAssetPolicy } from "../../allowlist-active-policy.js";
import type { AssetUsageLedger } from "../../asset-usage-ledger.js";
import type { ChainAccount, ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import { swapMechanismDigest } from "../pin.js";
import { validateJupiterV1PreparedMaterial } from "./v1-material.js";
import { JUPITER_V1_FINITE_ROUTES, routeConfigForMaterial, type JupiterV1RouteConfig } from "./v1-route-config.js";
import { JUPITER_V1_WHIRLPOOL_MECHANISM_PIN } from "./v1-pins.js";

export interface JupiterV1OwnerBinding {
 readonly account: ChainAccount; readonly accountBindingHash: string;
 readonly policyDigest: string; readonly activationDigest: string; readonly admissionHash: string;
}
export const JUPITER_V1_MECHANISM_DIGEST = swapMechanismDigest(JUPITER_V1_WHIRLPOOL_MECHANISM_PIN);
/** Resolves the owner-activated sealed policy and both public/envelope identities before any custody access. */
export class JupiterV1OwnerAdmission {
 constructor(private readonly accounts: Pick<ChainWalletStoragePort,"account"|"ownerBinding">,
   private readonly activePolicy: (profile:string)=>Promise<ActiveAssetPolicy|null>,
   private readonly usage: AssetUsageLedger, private readonly now:()=>Date) {}
 async localAccount(profile:string, expected?:string):Promise<ChainAccount>{
   const publicAccount=await this.accounts.account(profile,"solana"), envelopeAccount=await this.accounts.ownerBinding(profile,"solana");
   if(publicAccount===null||envelopeAccount===null||canonicalJson(publicAccount)!==canonicalJson(envelopeAccount)||
     publicAccount.profile!==profile||publicAccount.rail!=="solana"||publicAccount.network!=="mainnet"||publicAccount.provider!=="local"||
     publicAccount.custody!=="local_software"||expected!==undefined&&publicAccount.address!==expected) blocked("The profile's public and encrypted Solana owner binding changed.");
   return detached(publicAccount);
 }
 async resolve(profile:string, amountAtomic:string, minimumOutputAtomic:string, expected?:string, ownReservationAtomic="0"):Promise<JupiterV1OwnerBinding>{
   return (await this.resolveRoute(profile,amountAtomic,minimumOutputAtomic,expected,ownReservationAtomic)).owner;
 }
 async resolveRoute(profile:string, amountAtomic:string, minimumOutputAtomic:string, expected?:string, ownReservationAtomic="0"):Promise<{readonly route:JupiterV1RouteConfig;readonly owner:JupiterV1OwnerBinding}>{
   const account=await this.localAccount(profile,expected), active=await this.activePolicy(profile), now=this.now(), at=now.toISOString();
   if(active===null||active.profile!==profile||active.accounts.solana!==account.address||active.digest!==active.registry.policyDigest) blocked("The exact active owner policy is required.");
   let selected:JupiterV1RouteConfig|undefined;
   for(const [asset,amount] of [[{kind:"native" as const,identifier:null},amountAtomic],[{kind:"token" as const,identifier:"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},minimumOutputAtomic]] as const){
     const used=await this.usage.usage({account:account.address,chain:JUPITER_V1_WHIRLPOOL_MECHANISM_PIN.chain,asset},now);
     const admitted=evaluateAssetPolicy(active.registry,{chain:JUPITER_V1_WHIRLPOOL_MECHANISM_PIN.chain,asset,rail:"swap",amountAtomic:amount,
       dailyUsageAtomic:asset.kind==="native"?(BigInt(used.amountAtomic)-BigInt(ownReservationAtomic)).toString():used.amountAtomic,asOfDate:at.slice(0,10),asOf:at});
     const pin=admitted.asset.mechanismPins?.swap,digest=pin===undefined?null:swapMechanismDigest(pin);
     const route=JUPITER_V1_FINITE_ROUTES.find(r=>swapMechanismDigest(r.mechanismPin)===digest);
     if(route===undefined||selected!==undefined&&selected.routeId!==route.routeId)blocked("Both assets require the same exact finite Jupiter V1 mechanism admission.");selected=route;
   }
   const body={account,accountBindingHash:jupiterV1AccountBindingHash(account),policyDigest:active.digest,activationDigest:active.activationDigest};
   return {route:selected!,owner:detached({...body,admissionHash:domainHash("apn.jupiter-v1-owner-admission.v1",canonicalJson(body))})};
 }
 async assert(operationValue:SwapOperationRecord, materialValue:unknown):Promise<JupiterV1OwnerBinding>{
   const op=validateSwapOperation(operationValue),material=validateJupiterV1PreparedMaterial(materialValue);
   const config=routeConfigForMaterial(material.execution),registry=config.protocolRegistry;
   if(op.mechanismDigest!==swapMechanismDigest(config.mechanismPin)||op.protocolRegistryDigest!==registry.registryDigest||op.protocolRegistryVersion!==registry.registryVersion||canonicalJson(op.quote)!==canonicalJson(material.quote)||
      op.approvalCapAtomic!==material.approvalCapAtomic) blocked("The prepared Jupiter operation or material changed.");
   const resolved=await this.resolveRoute(op.quote.profile,op.quote.inputAmountAtomic,op.quote.minimumOutputAtomic,op.quote.account,op.usageLease!==null&&["reserved","submitted","unknown_finality"].includes(op.usageLease.state)?op.usageLease.amountAtomic:"0");
   const admission=resolved.owner;if(resolved.route.routeId!==config.routeId)blocked("Jupiter saved material differs from active mechanism admission.");
   if(admission.policyDigest!==op.policyDigest) blocked("The active Jupiter owner policy changed after preparation.");
   return admission;
 }
}
export function jupiterV1AccountBindingHash(account:ChainAccount):string{return domainHash("apn.jupiter-v1-owner-account.v1",canonicalJson(account));}
export function detached<T>(value:T):T{const copy=JSON.parse(JSON.stringify(value)) as T; const freeze=(v:unknown):void=>{if(v!==null&&typeof v==="object"){for(const child of Object.values(v))freeze(child);Object.freeze(v);}};freeze(copy);return copy;}
function blocked(message:string):never{throw new ApnError("APN_OPERATION_BLOCKED",message,{reason:"jupiter_v1_owner_admission"});}
