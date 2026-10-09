import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { MerchantOperation } from "./model.js";
import { refuse } from "./protocol.js";
export interface MerchantRetirementClaim {
 readonly schemaVersion:"apn.merchant-retirement.v1";readonly operationId:string;readonly profileHash:string;readonly fingerprint:string;readonly sourceNonce:string;
 readonly signClaimDigest:string;readonly priorIntegrityHash:string;readonly retiredAt:string;readonly proofHash:string;readonly claimDigest:string;
}
export class MerchantRetirementClaims extends SecureStateStore {
 private path(o:MerchantOperation){return `merchant-retirement/${o.operationId}.json`;}
 async assertNoRetirement(o:MerchantOperation){if(await this.readJson(this.path(o))!==null)refuse("merchant_retirement_permanent_fence");}
 async unsent(o:MerchantOperation):Promise<string>{
  if(o.feeContext===undefined||o.effectBinding===undefined||o.signingAttempts!==1||o.submissionAttempts!==0||o.txHash!==null||o.receipt!==null||o.deliveryAttempts.length!==0)refuse("merchant_retirement_not_unsent");
  const binding={schemaVersion:"apn.merchant-effect-claim.v1",operationId:o.operationId,profileHash:o.profileHash,fingerprint:o.fingerprint,effect:"sign",txHash:null};
  const sign=await this.readJson(`merchant-effect-claims/${o.operationId}.sign.json`),digest=hashObject(binding);
  if(canonicalJson(sign)!==canonicalJson({...binding,claimDigest:digest}))refuse("merchant_retirement_sign_claim_required");
  for(const path of [`merchant-effect-claims/${o.operationId}.send.json`,`merchant-material/${o.operationId}.json`])if(await this.readJson(path)!==null)refuse("merchant_retirement_exposed");return digest;
 }
 async find(o:MerchantOperation):Promise<MerchantRetirementClaim|null>{
  const value=await this.readJson(this.path(o));if(value===null)return null;
  if(!isPlainRecord(value)||!exactKeys(value,["schemaVersion","operationId","profileHash","fingerprint","sourceNonce","signClaimDigest","priorIntegrityHash","retiredAt","proofHash","claimDigest"]))refuse("merchant_retirement_claim_shape");
  const c=value as unknown as MerchantRetirementClaim,{claimDigest,...body}=c;
  if(c.schemaVersion!=="apn.merchant-retirement.v1"||c.operationId!==o.operationId||c.profileHash!==o.profileHash||c.fingerprint!==o.fingerprint||c.sourceNonce!==o.envelope.nonce||claimDigest!==hashObject(body)||![c.signClaimDigest,c.priorIntegrityHash,c.proofHash].every(h=>/^[a-f0-9]{64}$/u.test(h))||!Number.isFinite(Date.parse(c.retiredAt))||new Date(c.retiredAt).toISOString()!==c.retiredAt)refuse("merchant_retirement_claim_binding");
  if(await this.unsent(o)!==c.signClaimDigest)refuse("merchant_retirement_claim_binding");return c;
 }
 async mark(o:MerchantOperation,proofHash:string,at:string):Promise<MerchantRetirementClaim>{
  const existing=await this.find(o);if(existing!==null)return existing;
  const body={schemaVersion:"apn.merchant-retirement.v1" as const,operationId:o.operationId,profileHash:o.profileHash,fingerprint:o.fingerprint,sourceNonce:o.envelope.nonce,signClaimDigest:await this.unsent(o),priorIntegrityHash:o.integrityHash,retiredAt:at,proofHash};
  const c={...body,claimDigest:hashObject(body)};await this.initialize();await this.ensureDirectory("merchant-retirement");await this.writeJson(this.path(o),c,true);return c;
 }
}
