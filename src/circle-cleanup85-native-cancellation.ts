import { privateKeyToAccount } from "viem/accounts";
import { hashObject, canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { APPROVAL_WINDOW_MS, STATE_VERSION } from "./constants.js";
import { activeAssetPolicyFromState } from "./allowlist-active-policy.js";
import { AllowlistPolicyStore } from "./allowlist-policy-store.js";
import { allowlistProfileHash } from "./allowlist-policy-overlay.js";
import { evaluateAssetPolicy } from "./asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageReservation } from "./asset-usage-ledger.js";
import { approvalCode } from "./approval-code.js";
import { ApnError } from "./errors.js";
import { EncryptedWalletStore, walletCustodyLock, type DirectEffectMaterial } from "./encrypted-wallet-store.js";
import { assertEvmNativeCustody, evmNativeCustody, validateEvmNativeCustody } from "./evm-native-custody.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "./evm-address-ownership.js";
import { DirectPublicEffectJournal, directCustodyPayload } from "./direct-public-effect.js";
import { publishDirectPublicEffect } from "./direct-public-attestation.js";
import { EvmDirectSubmissionJournal } from "./evm-direct-submission.js";
import { evmDirectFingerprint } from "./evm-direct.js";
import { resolveEvmAsset } from "./evm-asset.js";
import { effectSlot } from "./local-wallet-native-fields.js";
import { OperationService } from "./operation-service.js";
import { Cleanup85NativePublicRecords as PublicRecords } from "./circle-cleanup85-native-records.js";
import { appendTransition, sealOperation, sealReceipt, type StateStore } from "./state.js";
import { exactChainConsent } from "./tty-approval.js";
import { validateEconomics } from "./transfer-policy.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { Hex, OperationRecord } from "./model.js";
import { BridgeHttps } from "./lifi/https.js";
import { CircleRpc } from "./circle-v2-evm/rpc.js";
import { verifyCleanup85RecoveryAdmission, verifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import { assertCleanup85Window } from "./circle-v2-evm/cleanup85-recovery-store.js";
import { reanchorCleanup85Recovery } from "./circle-cleanup85-native-reanchors.js";
import { withCleanup85NativeAuthority } from "./circle-cleanup85-native-authority.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import { CLEANUP85_OWNER, CLEANUP85_RECIPIENT, cleanup85Blocked, validateCleanup85Request, verifyCleanup85Raw, verifyCleanup85Observation } from "./circle-cleanup85-native-codec.js";
import { Cleanup85NativeRpc } from "./circle-cleanup85-native-rpc.js";
import { assertCleanup85NativeSlot, verifyCleanup85NativeReservation, verifyCleanup85NativeSettlement, verifiedCleanup85NativeSettlement, type VerifiedCleanup85NativeReservation, type VerifiedCleanup85NativeSettlement } from "./circle-cleanup85-native-ledger-authority.js";
import type { Cleanup85CancellationPort, Cleanup85CancellationProof, Cleanup85CancellationRequest, Cleanup85CancellationStatus } from "./circle-cleanup85-cancellation-contract.js";
const FAILURE_CODES=new Set(["APN_OPERATION_BLOCKED","APN_STATE_SECURITY","APN_STATE_CORRUPT","APN_STATE_BUSY","APN_RPC_CONFIG","APN_RPC_PROTOCOL","APN_RPC_AMBIGUOUS","APN_RPC_RATE_LIMITED","APN_RPC_BUDGET_EXCEEDED","APN_ALLOWLIST_REFUSED","APN_FOREGROUND_APPROVAL_REQUIRED","APN_PROFILE_DRIFT","APN_WALLET_MISMATCH","APN_INSUFFICIENT_GAS","APN_FEE_BUDGET_EXCEEDED"]);

export interface Cleanup85NativeLedgerPort {
  reserveCleanup85Native(authority: VerifiedCleanup85NativeReservation, now: Date): Promise<AssetUsageReservation>;
  settleCleanup85Native(authority: VerifiedCleanup85NativeSettlement, now: Date): Promise<AssetUsageReservation>;
}
export interface Cleanup85NativeCancellationOptions {
  readonly https?: Pick<BridgeHttps,"request">;
  readonly sourceArchiveRpcUrl?: string;
  readonly nativeRpcUrl?: string;
  readonly now?: () => number;
  readonly approve?: (operation: OperationRecord) => Promise<void>;
  readonly ledger?: Cleanup85NativeLedgerPort;
}
/** One fixed recovery request, normal native custody/operation/claims and finite full native accounting.
 * execute is foreground only. inspect contains no custody secret/material loader and never submits. */
export class Cleanup85NativeCancellation implements Cleanup85CancellationPort {
  private readonly now: () => number; private readonly ledger: AssetUsageLedger; private readonly accounting: Cleanup85NativeLedgerPort;
  private readonly records: PublicRecords;
  constructor(private readonly state: StateStore, private readonly wrapping: WrappingSecretPort, private readonly environment: Readonly<Record<string,string|undefined>>, private readonly options: Cleanup85NativeCancellationOptions = {}) {
    this.now=options.now??Date.now; this.ledger=new AssetUsageLedger(state.root); this.accounting=options.ledger??this.ledger as unknown as Cleanup85NativeLedgerPort; this.records=new PublicRecords(state.root);
  }
  private id(r:Cleanup85CancellationRequest) { return this.state.operationId("evm-live-buyer",`cleanup85-native:${r.recoveryBinding}`); }
  private identity() { return {account:CLEANUP85_OWNER,chain:"eip155:42161",asset:{kind:"native" as const,identifier:null}}; }
  private locks(id:string) { return [`profile:${this.state.profileHash("evm-live-buyer")}`,`profile:${this.state.profileHash("default")}`,`operation:${id}`,`operation:${"4ee24e4501478193bd84aa89463eb673d539db23cbb7cdbf56f8fe197d792a33"}`,evmAddressLock(CLEANUP85_OWNER),evmAddressLock(CLEANUP85_RECIPIENT)]; }
  private readers() {
    let requests=0;const counts=new Map<string,number>(); const underlying=this.options.https??new BridgeHttps();
    const https:Pick<BridgeHttps,"request">={request:async(...args)=>{if(++requests>448)cleanup85Blocked("all_physical_rpc_budget");counts.set(new URL(args[0]).href,(counts.get(new URL(args[0]).href)??0)+1);return underlying.request(...args);}};
    const source=this.options.sourceArchiveRpcUrl??this.environment.APN_ARBITRUM_RPC_URL, native=this.options.nativeRpcUrl??this.environment.APN_ARBITRUM_RPC_URL, destination=this.environment.APN_SEI_RPC_URL;
    if(source===undefined||native===undefined||destination===undefined)cleanup85Blocked("rpc_configuration");
    return {source:new CircleRpc(source,42161,https,192),destination:new CircleRpc(destination,1329,https,192),native:new Cleanup85NativeRpc(native,https,224,this.now),sourceUrl:native,remainingRequests:()=>448-requests,remainingSource:()=>192-(counts.get(new URL(source).href)??0),remainingDestination:()=>192-(counts.get(new URL(destination).href)??0)};
  }
  private async policy(o:OperationRecord) {
    const b=o.evm!.cleanup85Cancellation!,p=activeAssetPolicyFromState(await new AllowlistPolicyStore(this.state.root).readUnderProfileLock(o.profile),new Date(this.now()));
    if(p===null||p.accounts.evm!==CLEANUP85_OWNER||p.digest!==o.allowlist?.policyDigest||p.revision!==o.allowlist.policyRevision||p.activationDigest!==b.activationDigest)cleanup85Blocked("active_policy_drift");
    const own=await this.ledger.load(this.identity(),b.nativeReservationId),usage=await this.ledger.usage(this.identity(),new Date(this.now()));
    if(own!==null&&(!["reserved","submitted","unknown_finality"].includes(own.state)||own.amountAtomic!==b.nativeReserveAtomic||own.policyDigest!==p.digest))cleanup85Blocked("native_hold_drift");
    evaluateAssetPolicy(p.registry,{chain:"eip155:42161",asset:{kind:"native",identifier:null},rail:"direct",amountAtomic:b.nativeReserveAtomic,dailyUsageAtomic:(BigInt(usage.amountAtomic)-(own===null?0n:BigInt(own.amountAtomic))).toString(),asOfDate:new Date(this.now()).toISOString().slice(0,10),asOf:new Date(this.now()).toISOString()});return p;
  }
  private async load(r:Cleanup85CancellationRequest):Promise<OperationRecord|null> {
    const o=await this.state.findOperation(this.id(r));if(o!==null&&(o.evm?.cleanup85Cancellation===undefined||hashObject(o.evm.cleanup85Cancellation.request)!==hashObject(r)))cleanup85Blocked("saved_request_drift");return o;
  }
  async execute(input:Cleanup85CancellationRequest):Promise<Cleanup85CancellationStatus> {
    const r=validateCleanup85Request(input),id=this.id(r),read=this.readers();await this.state.initialize();
    const existing=await this.load(r);if(existing!==null&&existing.state!=="awaiting_approval")return this.inspect(r);
    return this.state.withLocks([walletCustodyLock(this.state,"evm-live-buyer"),walletCustodyLock(this.state,"default")],()=>this.state.withLocks(this.locks(id),()=>this.state.withLocks([`profile:${allowlistProfileHash("evm-live-buyer")}`],async()=>{
      const savedPrepared=await this.load(r);if(savedPrepared!==null&&savedPrepared.state!=="awaiting_approval")return this.status(savedPrepared,r);
      const admission=await verifyCleanup85RecoveryAdmission(this.state,read.source,read.destination,r),verified=verifiedCleanup85RecoveryAdmission(admission,r);assertCleanup85Window(verified.intent,this.now());
      await new OperationService(this.state).assertCleanup85NativeAccountAvailable(admission,r,savedPrepared??undefined);
      await assertExclusiveEvmRawSigner(this.state,CLEANUP85_OWNER,verified.parent.profileHash);await assertExclusiveEvmRawSigner(this.state,CLEANUP85_RECIPIENT,this.state.profileHash("default"));
      let o:OperationRecord;if(savedPrepared!==null)o=savedPrepared;else{
      const snapshot=await read.native.snapshot();await assertReadWriteAnchor(read.source,snapshot);const p=activeAssetPolicyFromState(await new AllowlistPolicyStore(this.state.root).readUnderProfileLock("evm-live-buyer"),new Date(this.now()));
      if(p===null||p.accounts.evm!==CLEANUP85_OWNER)cleanup85Blocked("prepare_native_policy");
      const e=snapshot.envelope,economics=validateEconomics("85",{gasLimitAtomic:e.gasLimitAtomic,maxFeePerGasAtomic:e.maxFeePerGasAtomic,maxPriorityFeePerGasAtomic:e.maxPriorityFeePerGasAtomic});
      const preparedAt=new Date(Math.floor(this.now()/1000)*1000).toISOString(),expiresAt=new Date(Math.min(Date.parse(preparedAt)+APPROVAL_WINDOW_MS,Date.parse(p.registry.expiresAt??new Date(Date.parse(preparedAt)+APPROVAL_WINDOW_MS).toISOString()),Date.parse(verified.intent.windowEndsAt??new Date(Date.parse(preparedAt)+APPROVAL_WINDOW_MS).toISOString()))).toISOString();
      const evm={schemaVersion:"apn.evm-direct.v1" as const,asset:resolveEvmAsset({chainId:42161,token:"native"},18),transactionTo:CLEANUP85_RECIPIENT,valueAtomic:"1",maxFeeWei:"2000000000000",
        feeQuote:{chainId:42161 as const,l1DataFeeUpperWei:"0",operatorFeeUpperWei:"0",maximumExecutionFeeWei:economics.maximumGasCostAtomic,totalQuoteWei:economics.maximumGasCostAtomic,totalFeeEnforcedOnchain:false as const,feeModel:"arbitrum-inclusive" as const,blockNumberAtomic:snapshot.blockNumberAtomic,blockHash:snapshot.blockHash,rpcOrigin:new URL(read.sourceUrl).origin,observedAt:new Date(this.now()).toISOString()},
        nativeCustody:await evmNativeCustody(this.state,"evm-live-buyer"),cleanup85Cancellation:{version:"apn.circle-cleanup85-native-binding.v1" as const,request:r,recipientCustody:verified.intent.recipientCustody,activationDigest:p.activationDigest,nativeReservationId:assetUsageReservationId(this.identity(),`apn.cleanup85-native:${id}`),nativeReserveAtomic:"2000000000000" as const,senderCode:snapshot.senderCode,recipientCode:snapshot.recipientCode,recipientDelegateCodeHash:snapshot.recipientDelegateCodeHash}} as const;
      const frozen={operationId:id,profile:"evm-live-buyer",chainId:42161,token:evm.asset.address,walletAddress:CLEANUP85_OWNER,recipient:CLEANUP85_RECIPIENT,amountAtomic:"1",transactionData:"0x" as const,economics,preparedAt,expiresAt,evm} as const;
      o=sealOperation({...frozen,schemaVersion:STATE_VERSION,profileHash:this.state.profileHash(frozen.profile),idempotencyHash:this.state.idempotencyHash(`cleanup85-native:${r.recoveryBinding}`),requestHash:hashObject({method:"apn.cleanup85-native.v1",request:r}),fingerprint:evmDirectFingerprint(frozen),amountDecimal:"0.000000000000000001",preparedBlockNumberAtomic:snapshot.blockNumberAtomic,allowlist:{schemaVersion:"apn.direct-allowlist.v1",policyDigest:p.digest,policyRevision:p.revision},state:"awaiting_approval",terminal:false,reason:"prepared_and_frozen",proofClass:"durable_pre_effect",transitions:appendTransition([],{at:preparedAt,state:"awaiting_approval",terminal:false,reason:"prepared_and_frozen",proofClass:"durable_pre_effect"})});
      await this.policy(o);await this.records.publish(r.parentOperationId,"slot",{version:"apn.cleanup85-single-cancellation.v1",parentOperationId:r.parentOperationId,oldCleanupMaterialHash:r.oldCleanupMaterialHash,requestBinding:hashObject(r),operationId:id,fingerprint:o.fingerprint});await this.persist(o);await new DirectPublicEffectJournal(this.state).prepare(o);}
      const p=await this.policy(o),e=cleanup85OperationEnvelope(o),custody=o.evm!.nativeCustody!,binding=o.evm!.cleanup85Cancellation!;
      const reserve=await verifyCleanup85NativeReservation(this.state,id,read.source,read.destination,read.native,()=>new Date(this.now()));await this.accounting.reserveCleanup85Native(reserve,new Date(this.now()));
      return withCleanup85NativeAuthority(o.fingerprint,o.expiresAt,this.now,async()=>{
        if(this.options.approve!==undefined)await this.options.approve(o);else await exactChainConsent(["Finite Arbitrum cleanup85 native cancellation",`Owner ${CLEANUP85_OWNER}; recipient ${CLEANUP85_RECIPIENT}; value1wei; nonce85; type2; empty calldata and no authorization`,"Full native reservation 2000000000000 wei includes value and fee; maxfee replacement>=45000000 wei/gas; priority>=1",`Operation ${id}; parent ${r.parentOperationId}; fingerprint ${o.fingerprint}; old cleanup retained, never re-sent`],approvalCode("transfer",id,o.fingerprint),o.expiresAt,{});
      },async authority=>{
        let witnessAt=0;const check=async(fresh:boolean)=>{
          const slot=await this.records.load(r.parentOperationId,"slot");if(canonicalJson(slot)!==canonicalJson({version:"apn.cleanup85-single-cancellation.v1",parentOperationId:r.parentOperationId,oldCleanupMaterialHash:r.oldCleanupMaterialHash,requestBinding:hashObject(r),operationId:id,fingerprint:o.fingerprint}))cleanup85Blocked("permanent_cancellation_slot");
          const saved=await this.load(r);if(saved?.integrityHash!==o.integrityHash)cleanup85Blocked("execution_operation_changed");
          await assertEvmNativeCustody(this.state,o.profile,custody);await assertEvmNativeCustody(this.state,"default",binding.recipientCustody);
          const active=await this.policy(o);authority.assert(o.fingerprint,active.registry.expiresAt??o.expiresAt);assertCleanup85Window(verified.intent,this.now());
          await new OperationService(this.state).assertCleanup85NativeAccountAvailable(admission,r,o);
          if(fresh){await Promise.all([assertReadWriteAnchorAfterSnapshot(read.source,read.native,e),reanchorCleanup85Recovery(read.source,read.destination,verified)]);witnessAt=this.now();}authority.assert(o.fingerprint,active.registry.expiresAt??o.expiresAt);return active;
        };
        await check(true);authority.assertRemaining(o.fingerprint,20_000);const futureSourceAnchors=new Set([verified.evidence.approvalProof.blockNumberAtomic,verified.evidence.approvalProof.finalityBlockNumberAtomic,verified.evidence.consumerProof.blockNumberAtomic,verified.evidence.consumerProof.finalityBlockNumberAtomic,verified.deployments.source.blockNumberAtomic]).size;const futureSource=4*(futureSourceAnchors+4),futureDestination=12;
        if(read.remainingRequests()<153+futureSource+futureDestination||read.native.remainingRequests<153||read.remainingSource()<futureSource||read.remainingDestination()<futureDestination)cleanup85Blocked("pre_sign_mandatory_public_rpc_budget");o=await this.move(o,"started","foreground_signing_started","durable_pre_effect");
        await new DirectPublicEffectJournal(this.state).beginSigning(o);
        let raw:Hex|undefined,phase:"wallet_load"|"sign"|"seal"|"pre_send"|"send"="wallet_load";
        try {
          const wallets=new EncryptedWalletStore(this.state,this.wrapping),w=await wallets.describe(o.profile,()=>authority.assertRemaining(o.fingerprint,20_000),async identity=>{await check(true);authority.assertRemaining(o.fingerprint,20_000);await assertEvmNativeCustody(this.state,o.profile,custody,identity);});
          if(w===null)cleanup85Blocked("custody_unavailable");
          try {
            await check(true);authority.assertRemaining(o.fingerprint,20_000);const account=privateKeyToAccount(w.secret.privateKey);if(account.address!==CLEANUP85_OWNER)cleanup85Blocked("custody_owner");
            phase="sign";raw=await account.signTransaction({type:"eip1559",chainId:42161,to:CLEANUP85_RECIPIENT,value:1n,data:"0x",nonce:85,gas:BigInt(e.gasLimitAtomic),maxFeePerGas:BigInt(e.maxFeePerGasAtomic),maxPriorityFeePerGas:BigInt(e.maxPriorityFeePerGasAtomic),accessList:[]});
            const hash=await verifyCleanup85Raw(e,raw);authority.assert(o.fingerprint,p.registry.expiresAt??o.expiresAt);
            const material:DirectEffectMaterial={payloadHash:hashObject(directCustodyPayload(o)),transactionHash:hash,rawTransaction:raw,rawTransactionHash:hash};
            const slot=effectSlot("apn-effect-v1",o.profile,id,o.fingerprint);if(w.secret.directEffects[slot]!==undefined)cleanup85Blocked("material_already_present");
            phase="seal";w.secret.directEffects[slot]=material;await wallets.save(w.identity,w.secret);await publishDirectPublicEffect(this.state,o,material,account);
            await this.records.publish(id,"material",{operationId:id,fingerprint:o.fingerprint,transactionHash:hash,materialHash:hashObject(material)});
            o=await this.move(o,"signed_not_submitted","native_effect_material_bound","native_transaction_hash",{transactionHash:hash,rawTransactionHash:hash});
          }finally{wallets.clear(w.secret);}
          phase="pre_send";await check(true);
          const guard=authority.beforeSend(o.fingerprint,raw,o.transactionHash!,()=>{if(this.now()-witnessAt>10_000)cleanup85Blocked("source_witness_expired");});
          await new EvmDirectSubmissionJournal(this.state.root).fence(o,raw);
          await this.ledger.transition({...this.identity(),reservationId:binding.nativeReservationId,policyDigest:p.digest,state:"unknown_finality",now:new Date(this.now())});
          phase="send";if(await read.native.call("eth_sendRawTransaction",[raw],guard)!==o.transactionHash)cleanup85Blocked("send_hash");
          o=await this.move(o,"submitted_pending","source_submission_returned","transaction_hash");return this.status(o,r);
        }catch(error){
          await this.records.publish(id,"failure",{version:"apn.cleanup85-sanitized-failure.v1",operationId:id,fingerprint:o.fingerprint,phase,errorCode:error instanceof ApnError&&FAILURE_CODES.has(error.code)?error.code:"APN_OPERATION_BLOCKED"});
          if(o.state==="signed_not_submitted")o=await this.move(o,"unknown_finality","native_dispatch_unknown","retained_signed_effect");
          await this.ledger.transition({...this.identity(),reservationId:binding.nativeReservationId,policyDigest:p.digest,state:"unknown_finality",now:new Date(this.now())});
          // After permanent SIGN, every failure stays observation-only, including no hash/no SEND.
          return this.status(o,r);
        }
      });
    })));
  }
  async inspect(input:Cleanup85CancellationRequest):Promise<Cleanup85CancellationStatus> {
    const r=validateCleanup85Request(input),id=this.id(r),url=this.options.nativeRpcUrl??this.environment.APN_ARBITRUM_RPC_URL;if(url===undefined)cleanup85Blocked("rpc_configuration");const read={native:new Cleanup85NativeRpc(url,this.options.https??new BridgeHttps(),224,this.now)};
    return this.state.withLocks(this.locks(id),async()=>{
      let o=await this.load(r);if(o===null)return {operationId:null,phase:"absent",transactionHash:null,proof:null};
      const existingProof=await this.records.load(id,"proof");if(existingProof!==null){const authority=await verifyCleanup85NativeSettlement(this.state,id,read.native);await this.accounting.settleCleanup85Native(authority,new Date(this.now()));return this.status(o,r);}
      if(o.state==="awaiting_approval"||o.state==="started")return this.status(o,r);
      const effect=await new DirectPublicEffectJournal(this.state).effect(o),observation=await read.native.observation(effect.transactionHash);
      if(observation===null)return this.status(o,r);
      const receipt=await verifyCleanup85Observation(cleanup85OperationEnvelope(o),effect.transactionHash,observation);
      if(!o.terminal)o=await this.move(o,"completed","confirmed_exact_native_transfer","included_native_transaction_and_receipt",{}, {blockNumberAtomic:receipt.blockNumberAtomic,evmEvidence:{blockHash:receipt.blockHash,transactionVerified:true,tokenBalanceDeltasVerified:false,safeBlockNumberAtomic:String(BigInt((observation.finalityHead as Record<string,unknown>).number as string)),safeBlockHash:(observation.finalityHead as Record<string,unknown>).hash as Hex}});
      const authority=await verifyCleanup85NativeSettlement(this.state,id,read.native),{settlement}=verifiedCleanup85NativeSettlement(authority,this.state.root);
      const canonical=await this.records.load(id,"canonical") as {observation:import("./circle-v2-evm/protocol.js").CircleObservation};
      const material=await this.records.load(id,"material") as {materialHash:string}|null;if(material===null)cleanup85Blocked("public_material_proof_missing");
      const body={version:"apn.circle-cleanup85-native-cancellation-proof.v1" as const,requestBinding:hashObject(r),operationId:id,fingerprint:o.fingerprint,materialHash:material.materialHash,transactionHash:effect.transactionHash,envelope:cleanup85OperationEnvelope(o),sourceCustody:o.evm!.nativeCustody!,recipientCustody:o.evm!.cleanup85Cancellation!.recipientCustody,observation:canonical.observation,actualFeeAtomic:receipt.actualFeeAtomic,nativeReservationId:settlement.nativeReservationId,nativeOutcomeDigest:settlement.outcomeDigest,nativeConsumedAtomic:receipt.nativeConsumedAtomic};
      const proof={...body,proofHash:hashObject(body)};await this.records.publish(id,"proof",proof);await this.accounting.settleCleanup85Native(authority,new Date(this.now()));return {operationId:id,phase:"finalized",transactionHash:effect.transactionHash,proof};
    });
  }
  private async status(o:OperationRecord,r:Cleanup85CancellationRequest):Promise<Cleanup85CancellationStatus> {
    const proof=await this.records.load(o.operationId,"proof") as Cleanup85CancellationProof|null;
    if(proof!==null){await verifyCleanup85CancellationAccounting(this.state,r,proof);return {operationId:o.operationId,phase:"finalized",transactionHash:o.transactionHash??null,proof};}
    return {operationId:o.operationId,phase:o.state==="awaiting_approval"?"prepared":"unknown",transactionHash:o.transactionHash??null,proof:null};
  }
  private async move(o:OperationRecord,state:OperationRecord["state"],reason:string,proofClass:string,extra:Partial<Pick<OperationRecord,"transactionHash"|"rawTransactionHash">>={},receipt?:{blockNumberAtomic:string;evmEvidence:import("./evm-ports.js").EvmTransferEvidence}) {
    const {integrityHash:_,...base}=o,terminal=state==="completed",at=new Date(this.now()).toISOString();const next=sealOperation({...base,...extra,state,terminal,reason,proofClass,transitions:appendTransition(o.transitions,{at,state,terminal,reason,proofClass})});await this.persist(next,receipt);return next;
  }
  private async persist(o:OperationRecord,receipt?:{blockNumberAtomic:string;evmEvidence:import("./evm-ports.js").EvmTransferEvidence}) {
    await this.state.writeReceipt(o.profileHash,sealReceipt({schemaVersion:STATE_VERSION,operationId:o.operationId,state:o.state,terminal:o.terminal,reason:o.reason,proofClass:o.proofClass,evm:o.evm!,amountAtomic:o.amountAtomic,...(o.transactionHash===undefined?{}:{transactionHash:o.transactionHash}),...receipt,createdAt:o.transitions.at(-1)!.at,operationIntegrityHash:o.integrityHash}));await this.state.writeOperation(o);
  }
}
/** Pure public accounting reconciliation. A owns its locks and independent canonical RPC reanchor. */
export async function verifyCleanup85CancellationAccounting(state:StateStore,request:Cleanup85CancellationRequest,proof:Cleanup85CancellationProof):Promise<void> {
  validateCleanup85Request(request);
  if(!isPlainRecord(proof)||!exactKeys(proof,["version","requestBinding","operationId","fingerprint","materialHash","transactionHash","envelope","sourceCustody","recipientCustody","observation","actualFeeAtomic","nativeReservationId","nativeOutcomeDigest","nativeConsumedAtomic","proofHash"])||proof.version!=="apn.circle-cleanup85-native-cancellation-proof.v1")cleanup85Blocked("accounting_proof_shape");
  if(![proof.requestBinding,proof.operationId,proof.fingerprint,proof.materialHash,proof.nativeReservationId,proof.nativeOutcomeDigest,proof.proofHash].every(x=>typeof x==="string"&&/^[a-f0-9]{64}$/u.test(x))||typeof proof.transactionHash!=="string"||!/^0x[a-f0-9]{64}$/u.test(proof.transactionHash)||![proof.actualFeeAtomic,proof.nativeConsumedAtomic].every(x=>typeof x==="string"&&/^(?:0|[1-9][0-9]{0,77})$/u.test(x)))cleanup85Blocked("accounting_proof_identity");
  validateEvmNativeCustody(proof.sourceCustody);validateEvmNativeCustody(proof.recipientCustody);
  const o=await state.findOperation(proof.operationId);if(o===null||o.state!=="completed"||!o.terminal||o.evm?.cleanup85Cancellation===undefined||hashObject(o.evm!.cleanup85Cancellation!.request)!==hashObject(request)||o.fingerprint!==proof.fingerprint||o.transactionHash!==proof.transactionHash||hashObject(cleanup85OperationEnvelope(o))!==hashObject(proof.envelope))cleanup85Blocked("accounting_native_operation");
  await assertCleanup85NativeSlot(state,o);
  if(canonicalJson(proof.sourceCustody)!==canonicalJson(o.evm!.nativeCustody)||canonicalJson(proof.recipientCustody)!==canonicalJson(o.evm!.cleanup85Cancellation!.recipientCustody))cleanup85Blocked("accounting_frozen_custody");
  const receipt=await verifyCleanup85Observation(cleanup85OperationEnvelope(o),proof.transactionHash as Hex,proof.observation);
  if(receipt.actualFeeAtomic!==proof.actualFeeAtomic||receipt.nativeConsumedAtomic!==proof.nativeConsumedAtomic)cleanup85Blocked("accounting_canonical_fee");
  const {proofHash,...body}=proof;if(hashObject(body)!==proofHash||proof.requestBinding!==hashObject(request)||canonicalJson(await new PublicRecords(state.root).load(o.operationId,"proof"))!==canonicalJson(proof))cleanup85Blocked("accounting_durable_proof");
  const signed=await new DirectPublicEffectJournal(state).effect(o);if(signed.transactionHash!==proof.transactionHash)cleanup85Blocked("accounting_sign_claim");await new EvmDirectSubmissionJournal(state.root).exists(o);
  const material=await new PublicRecords(state.root).load(o.operationId,"material");if(!isPlainRecord(material)||!exactKeys(material,["operationId","fingerprint","transactionHash","materialHash"])||material.operationId!==o.operationId||material.fingerprint!==o.fingerprint||material.transactionHash!==o.transactionHash||material.materialHash!==proof.materialHash||!/^([a-f0-9]{64})$/u.test(proof.materialHash))cleanup85Blocked("accounting_material_hash");
  const row=await new AssetUsageLedger(state.root).load({account:CLEANUP85_OWNER,chain:"eip155:42161",asset:{kind:"native",identifier:null}},proof.nativeReservationId);
  if(row===null||row.state!=="finalized"||row.amountAtomic!=="2000000000000"||row.reservationId!==o.evm!.cleanup85Cancellation!.nativeReservationId||row.policyDigest!==o.allowlist?.policyDigest||row.outcomeDigest!==proof.nativeOutcomeDigest||row.consumedAtomic!==proof.nativeConsumedAtomic||row.cleanup85NativeActual?.receiptHash!==receipt.receiptHash||row.cleanup85NativeActual?.blockHash!==receipt.blockHash||row.cleanup85NativeActual?.transactionHash!==receipt.transactionHash||BigInt(proof.nativeConsumedAtomic)!==BigInt(proof.actualFeeAtomic)+1n)cleanup85Blocked("accounting_native_ledger");
}

async function assertReadWriteAnchor(source:CircleRpc,snapshot:import("./circle-cleanup85-native-rpc.js").Cleanup85NativeSnapshot):Promise<void>{
  const header=await source.block(`0x${BigInt(snapshot.blockNumberAtomic).toString(16)}`);if(header.hash!==snapshot.blockHash)cleanup85Blocked("archive_native_anchor_agreement");await source.identity();
}

async function assertReadWriteAnchorAfterSnapshot(source:CircleRpc,native:Cleanup85NativeRpc,envelope:import("./circle-cleanup85-cancellation-contract.js").Cleanup85CancellationEnvelope):Promise<void>{await assertReadWriteAnchor(source,await native.snapshot(envelope));}
