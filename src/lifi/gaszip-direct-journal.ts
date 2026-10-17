import { hashObject } from "../canonical.js";
import { GASZIP_STATES, GASZIP_TERMINAL_STATES, type GaszipTerminalState } from "./gaszip-outcome.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { keccak256, parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { gaszipCodec, type GaszipDirectRoute } from "./gaszip-direct-route.js";
import type { BridgeOwner, BridgeProviderBinding } from "./model.js";
export interface GaszipFundingPlan { readonly blockHash: Hex; readonly nonce: string; readonly gas: string; readonly maxFee: string;
  readonly tip: string; readonly l1FeeUpper: string; readonly operatorFeeUpper: string; readonly feeUpper: string }
export interface GaszipFundingRecord {
  readonly schemaVersion: GaszipDirectRoute["schemaVersion"]; readonly operationId: string; readonly profileHash: string;
  readonly idempotencyHash: string; readonly requestHash: string; readonly profile: string; readonly owner: BridgeOwner;
  readonly providerBinding: BridgeProviderBinding; readonly amountAtomic: string; readonly minimumOutputAtomic: string;
  readonly maximumFeeAtomic: string; readonly quoteDigest: string; readonly quoteExpectedAtomic: string; readonly expiresAt: string;
  readonly policyDigest: string; readonly policyRevision: number; readonly activationDigest?: string; readonly plan: GaszipFundingPlan;
  readonly state: "prepared"|"signing_started"|"sealed"|"submitting"|"submitted"|"unknown_finality"|GaszipTerminalState;
  readonly terminal: boolean; readonly rawTransaction: Hex|null; readonly transactionHash: Hex|null; readonly submissionAttempts: 0|1;
  readonly usageReservationId: string|null; readonly outcomeDigest: string|null; readonly sourceProof: unknown|null; readonly destinationProof: unknown|null;
  readonly integrityHash: string;
}
export function sealGaszipFunding(route: GaszipDirectRoute, body: Omit<GaszipFundingRecord,"integrityHash">): GaszipFundingRecord {
  const { integrityHash: _old, ...clean } = body as GaszipFundingRecord; return validateGaszipFunding(route, {...clean,integrityHash:hashObject(clean)});
}
/** Checked against the record's own seal and owner record; the route table supplies only protocol data (target, calldata, chain). */
export function validateGaszipFunding(route: GaszipDirectRoute, value: unknown): GaszipFundingRecord {
  const c=gaszipCodec(route),r=value as GaszipFundingRecord; if(r===null || typeof r!=="object") c.fail("record"); const {integrityHash,...body}=r;
  if(r.schemaVersion!==route.schemaVersion || hashObject(body)!==integrityHash) c.fail("record_integrity");
  if(r.activationDigest!==undefined)stateIdentifier(r.activationDigest,"GasZip policy activation");
  for(const s of [r.operationId,r.profileHash,r.idempotencyHash,r.requestHash,r.policyDigest,r.quoteDigest]) stateIdentifier(s,"GasZip record identity");
  // The payer is the record's own owner (recorded from custody at prepare); the owner policy caps the amount.
  if(r.profileHash!==r.owner.profileHash || r.profile!==r.owner.profile || c.uint(r.amountAtomic)<=0n ||
    c.uint(r.maximumFeeAtomic)<=0n || c.uint(r.minimumOutputAtomic)<=0n ||
    c.uint(r.quoteExpectedAtomic)<c.uint(r.minimumOutputAtomic) || !Number.isFinite(Date.parse(r.expiresAt)) || !Number.isSafeInteger(r.policyRevision) || r.policyRevision<1) c.fail("record_terms");
  c.hash(r.plan.blockHash); for(const x of [r.plan.nonce,r.plan.gas,r.plan.maxFee,r.plan.tip,r.plan.l1FeeUpper,r.plan.operatorFeeUpper,r.plan.feeUpper]) c.uint(x);
  if(c.uint(r.plan.feeUpper)!==c.uint(r.plan.gas)*c.uint(r.plan.maxFee)+c.uint(r.plan.l1FeeUpper)+c.uint(r.plan.operatorFeeUpper) ||
    c.uint(r.plan.feeUpper)>c.uint(r.maximumFeeAtomic) || c.uint(r.plan.tip)>c.uint(r.plan.maxFee)) c.fail("record_fee");
  const terminal=GASZIP_TERMINAL_STATES.includes(r.state);
  if(terminal!==r.terminal || !GASZIP_STATES.includes(r.state)) c.fail("record_state");
  if(r.transactionHash===null ? r.rawTransaction!==null : r.rawTransaction===null || keccak256(r.rawTransaction)!==r.transactionHash) c.fail("record_transaction");
  if(r.rawTransaction!==null){ const t=parseTransaction(r.rawTransaction);
    if(t.type!=="eip1559" || t.chainId!==route.sourceChain || t.to?.toLowerCase()!==route.target.toLowerCase() || t.data!==route.data || t.value!==c.uint(r.amountAtomic) ||
      t.nonce?.toString()!==r.plan.nonce || t.gas?.toString()!==r.plan.gas || t.maxFeePerGas?.toString()!==r.plan.maxFee ||
      t.maxPriorityFeePerGas?.toString()!==r.plan.tip || (t.accessList??[]).length!==0 || t.r===undefined || t.s===undefined) c.fail("record_envelope"); }
  if((r.state==="prepared" || r.state==="signing_started" || r.state==="failed_before_effect") && r.rawTransaction!==null ||
    r.submissionAttempts!==0 && r.submissionAttempts!==1 || ["submitting","submitted","completed","failed_confirmed_revert","destination_failed"].includes(r.state) && r.submissionAttempts!==1 ||
    (r.state==="completed" || r.state==="destination_failed") && (r.sourceProof===null || r.destinationProof===null || r.outcomeDigest===null)) c.fail("record_phase");
  return r;
}
export function publicGaszipFunding(route: GaszipDirectRoute, r: GaszipFundingRecord): unknown { const {rawTransaction:_raw,...rest}=validateGaszipFunding(route,r); return rest; }
/** One journal per route; each keeps the directories and claim files its route has always written. */
export class GaszipFundingJournal extends SecureStateStore {
  private readonly directory: string;
  constructor(root: string, readonly route: GaszipDirectRoute) { super(root); this.directory = `${route.lane}-gaszip`; }
  private path(id:string):string {stateIdentifier(id,"GasZip operation");return `${this.directory}/${id}.json`;}
  async findOperation(id:string):Promise<GaszipFundingRecord|null>{const v=await this.readJson(this.path(id));return v===null?null:validateGaszipFunding(this.route,v);}
  async listAllOperations():Promise<readonly GaszipFundingRecord[]>{const rows: GaszipFundingRecord[]=[]; for(const e of await this.readDirectory(this.directory)){ if(!e.isFile() || e.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(e.name))gaszipCodec(this.route).fail("journal_entry");const r=await this.findOperation(e.name.slice(0,-5));if(r===null)gaszipCodec(this.route).fail("journal_missing");rows.push(r!);}return rows;}
  async saveLocked(r:GaszipFundingRecord, create=false):Promise<void>{validateGaszipFunding(this.route,r);await this.ensureDirectory(this.directory);await this.writeJson(this.path(r.operationId),r,create);}
  async sealTransaction(r:GaszipFundingRecord,raw:Hex):Promise<GaszipFundingRecord>{
    if(r.state!=="signing_started" || await recoverTransactionAddress({serializedTransaction:raw as `0x02${string}`})!==r.owner.address) gaszipCodec(this.route).fail("signer_binding");
    const sealed=sealGaszipFunding(this.route,{...r,state:"sealed",rawTransaction:raw,transactionHash:keccak256(raw)});await this.saveLocked(sealed);return sealed;
  }
  /** The create-only first-send marker precedes every broadcast; without it APN never sent these bytes. */
  async sendClaimedLocked(r:{operationId:string}):Promise<boolean>{return await this.readJson(`${this.directory}-first-send/${r.operationId}.json`)!==null;}
  async claimSigningLocked(r:GaszipFundingRecord):Promise<void>{
    await this.ensureDirectory(`${this.directory}-first-sign`);await this.writeJson(`${this.directory}-first-sign/${r.operationId}.json`,{operationId:r.operationId,fingerprint:r.integrityHash,nonce:r.plan.nonce},true);
  }
  async claimSendLocked(r:GaszipFundingRecord):Promise<void>{
    if(r.transactionHash===null)gaszipCodec(this.route).fail("send_missing_hash");await this.ensureDirectory(`${this.directory}-first-send`);
    await this.writeJson(`${this.directory}-first-send/${r.operationId}.json`,{operationId:r.operationId,transactionHash:r.transactionHash},true);
  }
  /** Caller holds `<lane>-gaszip:destination-claims`; one destination payout can complete only one operation. */
  async claimDestinationLocked(hash:Hex,id:string):Promise<void>{
    const path=`${this.directory}-destination-claims/${hash.slice(2)}.json`;const prior=await this.readJson(path);
    if(prior!==null){if((prior as {operationId:string}).operationId!==id)gaszipCodec(this.route).fail("destination_already_claimed");return;}
    await this.ensureDirectory(`${this.directory}-destination-claims`);await this.writeJson(path,{operationId:id,destinationHash:hash},true);
  }
}
