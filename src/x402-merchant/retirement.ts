import { canonicalJson, hashObject } from "../canonical.js";
import { evmAddressLock, assertExclusiveEvmRawSigner } from "../evm-address-ownership.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import type { StateStore } from "../state.js";
import { canonicalOperationId } from "../transfer-policy.js";
import { merchantMove, type MerchantOperation } from "./model.js";
import { MerchantRepository } from "./repository.js";
import { MerchantOwner, merchantUsageIdentity, merchantNativeUsageIdentity, merchantUsageKey, merchantNativeUsageKey } from "./owner.js";
import { MerchantRetirementClaims } from "./retirement-claims.js";
import { merchantUnsentProof } from "./retirement-proof.js";
import type { MerchantRpcPort } from "./rpc.js";
import { MERCHANT_OWNER } from "./pins.js";
import { refuse } from "./protocol.js";
export class MerchantRetirement {
 constructor(private readonly state:StateStore,private readonly rpc:MerchantRpcPort,private readonly now:()=>Date){}
 async retire(id:string):Promise<MerchantOperation>{
  const records=new MerchantRepository(this.state.root),claims=new MerchantRetirementClaims(this.state.root),owner=new MerchantOwner(this.state,this.now),ledger=new AssetUsageLedger(this.state.root);
  const found=await records.findOperation(canonicalOperationId(id));if(found===null)refuse("merchant_operation_missing");
  return this.state.withLocks([`profile:${found.profileHash}`,`operation:${found.operationId}`,`operation:idempotency:${found.idempotencyHash}`,evmAddressLock(MERCHANT_OWNER),`custody:${found.profileHash}`],()=>owner.withPolicyLock(found.profile,async locked=>{
   let o=await records.findOperation(found.operationId);if(o===null)refuse("merchant_operation_missing");
   if(!["unknown_finality","retired_unsent"].includes(o.state)||o.profile!=="default")refuse("merchant_retirement_phase");
   const signAt=o.events.find(e=>e.state==="signing_started")?.at;
   if(signAt===undefined||this.now().getTime()<Date.parse(signAt)+60000||this.now().getTime()<Date.parse(o.expiresAt))refuse("merchant_retirement_foreground_live");
   await claims.unsent(o);await assertEvmNativeCustody(this.state,o.profile,o.custody);await assertExclusiveEvmRawSigner(this.state,MERCHANT_OWNER,o.profileHash);
   await locked.admit(o.profile,o); // Current true-policy owner/admission, not stale parent activation permission.
   let claim=await claims.find(o);
   if(claim===null){const proofHash=await merchantUnsentProof(this.rpc,o);await locked.admit(o.profile,o);await assertEvmNativeCustody(this.state,o.profile,o.custody);await claims.unsent(o);claim=await claims.mark(o,proofHash,this.now().toISOString());}
   await claims.unsent(o); // Check again AFTER durable permanent tombstone, before either hold changes.
   if(o.state==="retired_unsent"&&o.retirementDigest!==claim.claimDigest)refuse("merchant_retirement_tombstone_required");
   for(const [identity,key] of [[merchantUsageIdentity,merchantUsageKey(o.operationId)],[merchantNativeUsageIdentity,merchantNativeUsageKey(o.operationId)]] as const){
    await locked.admit(o.profile,o);await claims.unsent(o);const reservationId=assetUsageReservationId(identity,key),r=await ledger.load(identity,reservationId),amount=identity.asset.kind==="native"?o.effectBinding?.nativeAmountAtomic:o.frozen.accepted.amount;
    const outcomeDigest=hashObject({kind:"merchant_retired_unsent",operationId:o.operationId,fingerprint:o.fingerprint,retirementDigest:claim.claimDigest,consumedAtomic:"0"});
    if(r===null||r.policyDigest!==o.policy.digest||r.rail!=="x402"||r.amountAtomic!==amount)refuse("merchant_retirement_hold_binding");
    if(r.state==="released_unsubmitted"){if(r.outcomeDigest!==outcomeDigest)refuse("merchant_retirement_hold_binding");continue;}
    if(!["unknown_finality","reserved"].includes(r.state))refuse("merchant_retirement_hold_binding");
    await ledger.transition({...identity,reservationId,policyDigest:r.policyDigest,state:"released_unsubmitted",expectedCurrentStates:[r.state],outcomeDigest,now:this.now()});
   }
   if(o.state!=="retired_unsent"){o=merchantMove(o,"retired_unsent",this.now().toISOString(),{retirementDigest:claim.claimDigest});await records.persist(o);}
   return o;
  }));
 }
}
