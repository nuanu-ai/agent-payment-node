import { hashObject } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { keccak256, parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { SEI_FUNDING, seiFail, seiHash, seiUint } from "./sei-gaszip-contract.js";
import type { BridgeOwner, BridgeProviderBinding } from "./model.js";
export interface SeiFundingPlan { readonly blockHash: Hex; readonly nonce: string; readonly gas: string; readonly maxFee: string;
  readonly tip: string; readonly l1FeeUpper: string; readonly operatorFeeUpper: string; readonly feeUpper: string }
export interface SeiFundingRecord {
  readonly schemaVersion: "apn.sei-gaszip-operation.v1"; readonly operationId: string; readonly profileHash: string;
  readonly idempotencyHash: string; readonly requestHash: string; readonly profile: string; readonly owner: BridgeOwner;
  readonly providerBinding: BridgeProviderBinding; readonly amountAtomic: string; readonly minimumOutputAtomic: string;
  readonly maximumFeeAtomic: string; readonly quoteDigest: string; readonly quoteExpectedAtomic: string; readonly expiresAt: string;
  readonly policyDigest: string; readonly policyRevision: number; readonly activationDigest?: string; readonly plan: SeiFundingPlan;
  readonly state: "prepared"|"signing_started"|"sealed"|"submitting"|"submitted"|"unknown_finality"|"completed"|"failed_before_effect"|"failed_confirmed_revert";
  readonly terminal: boolean; readonly rawTransaction: Hex|null; readonly transactionHash: Hex|null; readonly submissionAttempts: 0|1;
  readonly usageReservationId: string|null; readonly outcomeDigest: string|null; readonly sourceProof: unknown|null; readonly destinationProof: unknown|null;
  readonly integrityHash: string;
}
export function sealSeiFunding(body: Omit<SeiFundingRecord,"integrityHash">): SeiFundingRecord { const { integrityHash: _old, ...clean } = body as SeiFundingRecord; return validateSeiFunding({...clean,integrityHash:hashObject(clean)}); }
export function validateSeiFunding(value: unknown): SeiFundingRecord {
  const r=value as SeiFundingRecord; if(r===null || typeof r!=="object") seiFail("record"); const {integrityHash,...body}=r;
  if(r.schemaVersion!=="apn.sei-gaszip-operation.v1" || hashObject(body)!==integrityHash) seiFail("record_integrity");
  if(r.activationDigest!==undefined)stateIdentifier(r.activationDigest,"GasZip policy activation");
  for(const s of [r.operationId,r.profileHash,r.idempotencyHash,r.requestHash,r.policyDigest,r.quoteDigest]) stateIdentifier(s,"GasZip record identity");
  if(r.profileHash!==r.owner.profileHash || r.profile!==r.owner.profile || seiUint(r.amountAtomic)<=0n || seiUint(r.amountAtomic)>SEI_FUNDING.maximumAmount ||
    seiUint(r.maximumFeeAtomic)>SEI_FUNDING.maximumFee || seiUint(r.minimumOutputAtomic)<SEI_FUNDING.minimumOutput ||
    seiUint(r.quoteExpectedAtomic)<seiUint(r.minimumOutputAtomic) || !Number.isFinite(Date.parse(r.expiresAt)) || !Number.isSafeInteger(r.policyRevision) || r.policyRevision<1) seiFail("record_terms");
  seiHash(r.plan.blockHash); for(const x of [r.plan.nonce,r.plan.gas,r.plan.maxFee,r.plan.tip,r.plan.l1FeeUpper,r.plan.operatorFeeUpper,r.plan.feeUpper]) seiUint(x);
  if(seiUint(r.plan.feeUpper)!==seiUint(r.plan.gas)*seiUint(r.plan.maxFee)+seiUint(r.plan.l1FeeUpper)+seiUint(r.plan.operatorFeeUpper) ||
    seiUint(r.plan.feeUpper)>seiUint(r.maximumFeeAtomic) || seiUint(r.plan.tip)>seiUint(r.plan.maxFee)) seiFail("record_fee");
  const terminal=["completed","failed_before_effect","failed_confirmed_revert"].includes(r.state);
  if(terminal!==r.terminal || !["prepared","signing_started","sealed","submitting","submitted","unknown_finality","completed","failed_before_effect","failed_confirmed_revert"].includes(r.state)) seiFail("record_state");
  if(r.transactionHash===null ? r.rawTransaction!==null : r.rawTransaction===null || keccak256(r.rawTransaction)!==r.transactionHash) seiFail("record_transaction");
  if(r.rawTransaction!==null){ const t=parseTransaction(r.rawTransaction);
    if(t.type!=="eip1559" || t.chainId!==8453 || t.to?.toLowerCase()!==SEI_FUNDING.target.toLowerCase() || t.data!==SEI_FUNDING.data || t.value!==seiUint(r.amountAtomic) ||
      t.nonce?.toString()!==r.plan.nonce || t.gas?.toString()!==r.plan.gas || t.maxFeePerGas?.toString()!==r.plan.maxFee ||
      t.maxPriorityFeePerGas?.toString()!==r.plan.tip || (t.accessList??[]).length!==0 || t.r===undefined || t.s===undefined) seiFail("record_envelope"); }
  if((r.state==="prepared" || r.state==="signing_started" || r.state==="failed_before_effect") && r.rawTransaction!==null ||
    r.submissionAttempts!==0 && r.submissionAttempts!==1 || ["submitting","submitted","completed","failed_confirmed_revert"].includes(r.state) && r.submissionAttempts!==1 ||
    r.state==="completed" && (r.sourceProof===null || r.destinationProof===null || r.outcomeDigest===null)) seiFail("record_phase");
  return r;
}
export function publicSeiFunding(r: SeiFundingRecord): unknown { const {rawTransaction:_raw,...rest}=validateSeiFunding(r); return rest; }
export class SeiFundingJournal extends SecureStateStore {
  private path(id:string):string {stateIdentifier(id,"GasZip operation");return `sei-gaszip/${id}.json`;}
  async findOperation(id:string):Promise<SeiFundingRecord|null>{const v=await this.readJson(this.path(id));return v===null?null:validateSeiFunding(v);}
  async listAllOperations():Promise<readonly SeiFundingRecord[]>{const rows: SeiFundingRecord[]=[]; for(const e of await this.readDirectory("sei-gaszip")){ if(!e.isFile() || e.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(e.name))seiFail("journal_entry");const r=await this.findOperation(e.name.slice(0,-5));if(r===null)seiFail("journal_missing");rows.push(r);}return rows;}
  async listOperations(profileHash:string):Promise<readonly SeiFundingRecord[]>{return (await this.listAllOperations()).filter(x=>x.profileHash===profileHash);}
  async saveLocked(r:SeiFundingRecord, create=false):Promise<void>{validateSeiFunding(r);await this.ensureDirectory("sei-gaszip");await this.writeJson(this.path(r.operationId),r,create);}
  async sealTransaction(r:SeiFundingRecord,raw:Hex):Promise<SeiFundingRecord>{
    if(r.state!=="signing_started" || await recoverTransactionAddress({serializedTransaction:raw as `0x02${string}`})!==r.owner.address) seiFail("signer_binding");
    const sealed=sealSeiFunding({...r,state:"sealed",rawTransaction:raw,transactionHash:keccak256(raw)});await this.saveLocked(sealed);return sealed;
  }
  async assertNoEffectClaimsLocked(r:SeiFundingRecord):Promise<void>{
    if(await this.readJson(`sei-gaszip-first-sign/${r.operationId}.json`)!==null || await this.readJson(`sei-gaszip-first-send/${r.operationId}.json`)!==null)seiFail("effect_marker_blocks_retirement");
  }
  async claimSigningLocked(r:SeiFundingRecord):Promise<void>{
    await this.ensureDirectory("sei-gaszip-first-sign");await this.writeJson(`sei-gaszip-first-sign/${r.operationId}.json`,{operationId:r.operationId,fingerprint:r.integrityHash,nonce:r.plan.nonce},true);
  }
  async claimSendLocked(r:SeiFundingRecord):Promise<void>{
    if(r.transactionHash===null)seiFail("send_missing_hash");await this.ensureDirectory("sei-gaszip-first-send");
    await this.writeJson(`sei-gaszip-first-send/${r.operationId}.json`,{operationId:r.operationId,transactionHash:r.transactionHash},true);
  }
  async claimDestinationLocked(hash:Hex,id:string):Promise<void>{
    const path=`sei-gaszip-destination-claims/${hash.slice(2)}.json`;const prior=await this.readJson(path);
    if(prior!==null){if((prior as {operationId:string}).operationId!==id)seiFail("destination_already_claimed");return;}
    await this.ensureDirectory("sei-gaszip-destination-claims");await this.writeJson(path,{operationId:id,destinationHash:hash},true);
  }
}
