import { privateKeyToAccount } from "viem/accounts";
import { type Hex } from "viem";
import { approvalCode } from "../approval-code.js";
import { hashObject } from "../canonical.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { activeAssetPolicyFromState, loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageState } from "../asset-usage-ledger.js";
import { EncryptedSmartAccountPermissionStore } from "../encrypted-smart-account-permission-store.js";
import { withGaszipForegroundAuthority, gaszipEffectBinding, gaszipGuardRefused } from "./gaszip-authority.js";
import { gaszipNonceConsumed, gaszipUnlandedReason, gaszipUsageState, type GaszipTerminalState } from "./gaszip-outcome.js";
import { ApnError } from "../errors.js";
import { EncryptedWalletStore, walletCustodyLock } from "../encrypted-wallet-store.js";
import { assertExclusiveEvmOwner, assertExclusiveEvmOwnerIncludingGrants, evmAddressLock } from "../evm-address-ownership.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { OperationService } from "../operation-service.js";
import type { StateStore } from "../state.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { exactChainConsent } from "../tty-approval.js";
import { canonicalProfile } from "../wallet-policy.js";
import { assertBridgeOwner, bridgeOwner } from "./owner.js";
import { BridgeHttps } from "./https.js";
import { MEGA_FUNDING, inspectMegaDelivery, inspectMegaFundingQuote, megaFail, megaHash, megaJson, megaQuantity, megaUint } from "./mega-gaszip-contract.js";
import { MegaFundingJournal, publicMegaFunding, sealMegaFunding, type MegaFundingRecord } from "./mega-gaszip-journal.js";
import { MegaFundingRpc, assertMegaFundingFresh, readMegaFundingPlan, proveMegaDelivery, proveMegaSource, type MegaRpcPort, type MegaSafeProof } from "./mega-gaszip-rpc.js";
import { gaszipObservationRefusal } from "./gaszip-native-delivery.js";
const ORIGIN="https://backend.gas.zip";
export interface MegaFundingPrepareRequest {readonly profile:string;readonly expectedPayer:string;readonly amountAtomic:string;
  readonly minimumOutputAtomic:string;readonly maximumFeeAtomic:string;readonly idempotencyKey:string}
export interface MegaFundingPorts { readonly https?:Pick<BridgeHttps,"request">;readonly source?:()=>MegaRpcPort;readonly destination?:()=>MegaRpcPort;
  readonly approve?:(record:MegaFundingRecord)=>Promise<void>;readonly now?:()=>number }
/** Strictly Base-native to Mega-native, self recipient; adapters cannot supply authoritative receipts in place of RPC reads. */
export class MegaFundingService {
  private readonly journal:MegaFundingJournal;private readonly ledger:AssetUsageLedger;private readonly https:Pick<BridgeHttps,"request">;private readonly now:()=>number;
  constructor(private readonly state:StateStore,private readonly wrapping:WrappingSecretPort,
    private readonly environment:Readonly<Record<string,string|undefined>>,private readonly ports:MegaFundingPorts={}){
    this.journal=new MegaFundingJournal(state.root);this.ledger=new AssetUsageLedger(state.root);this.https=ports.https??new BridgeHttps();this.now=ports.now??Date.now;
  }
  private rpc(kind:"source"|"destination"):MegaRpcPort{
    const injected=this.ports[kind];if(injected!==undefined)return injected();const name=kind==="source"?"APN_BASE_RPC_URL":"APN_MEGA_RPC_URL";
    const url=this.environment[name];if(url===undefined)megaFail(`${kind}_rpc_missing`);return new MegaFundingRpc(url,this.https);
  }
  private identity(r:Pick<MegaFundingRecord,"owner">){return {account:r.owner.address,chain:"eip155:8453",asset:{kind:"native" as const,identifier:null}};}
  private async policy(r:Pick<MegaFundingRecord,"profile"|"owner"|"amountAtomic">,expected?:Pick<MegaFundingRecord,"policyDigest"|"policyRevision"|"activationDigest">,underLock=false){
    const p=underLock ? activeAssetPolicyFromState(await new AllowlistPolicyStore(this.state.root).readUnderProfileLock(r.profile),new Date(this.now())) : await loadActiveAssetPolicyRegistry(this.state.root,r.profile,new Date(this.now()));
    if(p===null || p.accounts.evm!==r.owner.address || expected!==undefined && (p.digest!==expected.policyDigest || p.revision!==expected.policyRevision || p.activationDigest!==expected.activationDigest))megaFail("owner_policy_drift");
    const u=await this.ledger.usage(this.identity(r),new Date(this.now()));
    const reference=(r as Partial<MegaFundingRecord>).usageReservationId; const own=reference===undefined || reference===null ? null : await this.ledger.load(this.identity(r),reference);
    if(own!==null && (own.policyDigest!==p.digest || own.amountAtomic!==r.amountAtomic || !["reserved","unknown_finality"].includes(own.state)))megaFail("prepared_usage_binding");
    const daily=(BigInt(u.amountAtomic)-(own===null?0n:BigInt(own.amountAtomic))).toString();evaluateAssetPolicy(p.registry,{chain:"eip155:8453",asset:{kind:"native",identifier:null},rail:"bridge",mechanism:MEGA_FUNDING.mechanism,
      amountAtomic:r.amountAtomic,dailyUsageAtomic:daily,asOfDate:new Date(this.now()).toISOString().slice(0,10),asOf:new Date(this.now()).toISOString()});return p;
  }
  private async required(id:string):Promise<MegaFundingRecord>{const r=await this.journal.findOperation(id);if(r===null)megaFail("missing_operation");return r;}
  private locks(r:Pick<MegaFundingRecord,"profileHash"|"operationId"|"owner">):string[]{return [`profile:${r.profileHash}`,`operation:${r.operationId}`,evmAddressLock(r.owner.address)];}
  async prepare(input:MegaFundingPrepareRequest):Promise<unknown>{
    const profile=canonicalProfile(input.profile),idempotency=canonicalIdempotencyKey(input.idempotencyKey),bound=await bridgeOwner(this.state,profile);
    if(profile!==MEGA_FUNDING.profile || bound.owner.address!==MEGA_FUNDING.owner || bound.owner.address!==input.expectedPayer)megaFail("expected_payer");
    const amount=megaUint(input.amountAtomic),floor=megaUint(input.minimumOutputAtomic),fee=megaUint(input.maximumFeeAtomic);
    if(amount!==MEGA_FUNDING.maximumAmount || floor<MEGA_FUNDING.minimumOutput || fee<=0n || fee>MEGA_FUNDING.maximumFee)megaFail("input_caps");
    const operationId=this.state.operationId(profile,idempotency),idempotencyHash=this.state.idempotencyHash(idempotency),requestHash=hashObject(input);
    const ops=new OperationService(this.state);const prior=await ops.resolvePrepare({kind:"mega_gaszip",profileHash:bound.owner.profileHash,operationId,idempotencyHash,requestHash});
    if(prior!==null){if(prior.kind!=="mega_gaszip")megaFail("idempotency_kind");return publicMegaFunding(prior.record);}
    const p=await this.policy({profile,owner:bound.owner,amountAtomic:amount.toString()});
    const url=new URL(`${ORIGIN}/v2/quotes/8453/${amount}/4326`);url.searchParams.set("from",bound.owner.address);url.searchParams.set("to",bound.owner.address);
    const response=await this.https.request(url.toString(),"GET",null,64*1024,"APN_HTTP_CONFIG");if(response.status!==200)megaFail("quote_http");
    const quote=inspectMegaFundingQuote(megaJson(response.body),this.now());if(BigInt(quote.expectedAtomic)<floor)megaFail("quote_owner_floor");
    const plan=await readMegaFundingPlan(this.rpc("source"),bound.owner.address,amount.toString(),fee.toString());
    if(Date.parse(quote.expiresAt)-this.now()<30_000)megaFail("prepare_quote_expired");
    const record=sealMegaFunding({schemaVersion:"apn.mega-gaszip-operation.v1",operationId,profileHash:bound.owner.profileHash,idempotencyHash,requestHash,profile,...bound,
      amountAtomic:amount.toString(),minimumOutputAtomic:floor.toString(),maximumFeeAtomic:fee.toString(),quoteDigest:quote.digest,quoteExpectedAtomic:quote.expectedAtomic,
      expiresAt:quote.expiresAt,policyDigest:p.digest,policyRevision:p.revision,activationDigest:p.activationDigest,plan,state:"prepared",terminal:false,rawTransaction:null,transactionHash:null,
      submissionAttempts:0,usageReservationId:assetUsageReservationId({account:bound.owner.address,chain:"eip155:8453",asset:{kind:"native",identifier:null}},`mega-gaszip:${operationId}`),outcomeDigest:null,sourceProof:null,destinationProof:null});
    await this.state.initialize();return this.state.withLocks([...this.locks(record),`operation:idempotency:${idempotencyHash}`],async()=>this.state.withLocks([`profile:${allowlistProfileHash(profile)}`],async()=>{
      const found=await ops.resolvePrepare({kind:"mega_gaszip",profileHash:record.profileHash,operationId,idempotencyHash,requestHash});
      if(found!==null){if(found.kind!=="mega_gaszip")megaFail("idempotency_kind");return publicMegaFunding(found.record);}
      await ops.assertEvmAccountAvailable(record.profileHash,8453,record.owner.address);await assertExclusiveEvmOwner(this.state,record.owner.address,record.profileHash);
      await assertBridgeOwner(this.state,record);await this.policy(record,record,true);await this.journal.saveLocked(record,true);return publicMegaFunding(record);
    }));
  }
  async approve(id:string):Promise<unknown>{
    let r=await this.required(id);if(r.state!=="prepared")return publicMegaFunding(r);
    if(r.activationDigest===undefined)megaFail("legacy_activation_missing");
    await assertBridgeOwner(this.state,r);await this.policy(r,r);
    if(Date.parse(r.expiresAt)-this.now()<20_000)megaFail("approval_expiry");
    const binding=gaszipEffectBinding(r,"mega");
    return withGaszipForegroundAuthority(binding,r.expiresAt,this.now,async()=>{
      if(this.ports.approve!==undefined)await this.ports.approve(r);else await exactChainConsent([
      `GasZip direct Base ETH -> Mega ETH SELF ONLY`, `Profile ${r.profile}; owner and recipient ${r.owner.address}`,
      `Source ${r.amountAtomic} wei; source network fee quote ceiling ${r.maximumFeeAtomic} wei (Base total is not an on-chain cap)`,
      `Target ${MEGA_FUNDING.target}; calldata ${MEGA_FUNDING.data}; minimum delivered ${r.minimumOutputAtomic} wei ETH`,
      `Destination floor is an acceptance requirement, not enforced by the source transaction.`,
      `No approval transactions. One signature and one send. Unknown outcomes retain their hold.`,
      `Operation ${r.operationId}; policy ${r.policyDigest}; quote ${r.quoteDigest}; expires ${r.expiresAt}`,
      ],approvalCode("bridge",r.operationId,r.integrityHash),r.expiresAt,{});
    },async authority=>this.state.withLocks([walletCustodyLock(this.state,r.profile)],async()=>
      this.state.withLocks(this.locks(r),async()=>this.state.withLocks([`profile:${allowlistProfileHash(r.profile)}`],async()=>{
        let saved=await this.required(id);if(saved.state!=="prepared" || saved.integrityHash!==r.integrityHash)megaFail("approval_record_drift");
        const check=async()=>{
          await assertBridgeOwner(this.state,saved);
          await assertExclusiveEvmOwnerIncludingGrants(this.state,new EncryptedSmartAccountPermissionStore(this.state,this.wrapping),saved.owner.address,saved.profileHash);
          const active=await this.policy(saved,saved,true);authority.assert(gaszipEffectBinding(saved,"mega"),active.registry.expiresAt);return active;
        };
        let active=await check();
        const fresh=await readMegaFundingPlan(this.rpc("source"),saved.owner.address,saved.amountAtomic,saved.maximumFeeAtomic,saved.plan);assertMegaFundingFresh(saved.plan,fresh,saved.maximumFeeAtomic);
        active=await check();
        const reservation=await this.ledger.reserve({...this.identity(saved),registry:active.registry,rail:"bridge",mechanism:MEGA_FUNDING.mechanism,
          amountAtomic:saved.amountAtomic,idempotencyKey:`mega-gaszip:${id}`,now:new Date(this.now())});
        if(reservation.reservationId!==saved.usageReservationId)megaFail("reservation_reference");
        const wallet=new EncryptedWalletStore(this.state,this.wrapping),loaded=await wallet.describe(saved.profile);if(loaded===null)megaFail("wallet_missing");
        try{
          const account=privateKeyToAccount(loaded.secret.privateKey);if(account.address!==saved.owner.address || loaded.identity.bindingHash!==saved.owner.walletBindingHash)megaFail("signing_owner");
          await check();authority.assert(binding);if(Date.parse(saved.expiresAt)-this.now()<10_000)megaFail("post_approval_expiry");
          await this.journal.claimSigningLocked(saved);saved=sealMegaFunding({...saved,state:"signing_started"});await this.journal.saveLocked(saved);
          await this.usage(saved,"unknown_finality");
          authority.assert(binding);
          const raw=await account.signTransaction({type:"eip1559",chainId:8453,to:MEGA_FUNDING.target,data:MEGA_FUNDING.data,value:BigInt(saved.amountAtomic),
            nonce:Number(BigInt(saved.plan.nonce)),gas:BigInt(saved.plan.gas),maxFeePerGas:BigInt(saved.plan.maxFee),maxPriorityFeePerGas:BigInt(saved.plan.tip)});
          saved=await this.journal.sealTransaction(saved,raw);
        }finally{wallet.clear(loaded.secret);}
        await check();authority.assert(binding);
        if(saved.rawTransaction===null || saved.transactionHash===null)megaFail("sealed_material_missing");
        const guard=authority.beforeSend(binding,saved.rawTransaction,saved.transactionHash);
        await this.journal.claimSendLocked(saved);saved=sealMegaFunding({...saved,state:"submitting",submissionAttempts:1});await this.journal.saveLocked(saved);
        let sent=false,unsent:"send_rejected"|"authority_refused_before_transport"|null=null;
        try{const returned=await this.rpc("source").call("eth_sendRawTransaction",[saved.rawTransaction],guard);if(megaHash(returned)!==saved.transactionHash)megaFail("send_hash");sent=true;}
        catch(error){
          // A refused guard proves the bytes never left APN; a definite JSON-RPC refusal proves the node did not take them.
          // Every other failure keeps unknown finality and is never resent.
          unsent=gaszipGuardRefused(guard)?"authority_refused_before_transport":
            error instanceof ApnError && error.details?.reason==="mega_gaszip_send_rejected"?"send_rejected":null;
        }
        saved=unsent===null?sealMegaFunding({...saved,state:sent?"submitted":"unknown_finality"}):this.unlanded(saved,unsent);
        await this.journal.saveLocked(saved);if(saved.terminal)await this.usage(saved,"failed_before_effect");return publicMegaFunding(saved);
      }))));
  }
  private async usage(r:MegaFundingRecord,state:Exclude<AssetUsageState,"reserved">):Promise<void>{
    const current=r.usageReservationId===null?null:await this.ledger.load(this.identity(r),r.usageReservationId);if(current===null || r.usageReservationId===null)return;
    // The hold moved to unknown finality before signing; bytes proven never sent release it as unsubmitted.
    const target=state==="failed_before_effect" && ["unknown_finality","released_unsubmitted"].includes(current.state)?"released_unsubmitted":state;
    await this.ledger.transition({...this.identity(r),reservationId:r.usageReservationId,policyDigest:r.policyDigest,
      state:target,now:new Date(this.now()),...(r.outcomeDigest===null?{}:{outcomeDigest:r.outcomeDigest})});
  }
  /** A signed effect APN proved never landed ends before effect: its bytes are scrubbed and never sent again. */
  private unlanded(r:MegaFundingRecord,reason:Parameters<typeof gaszipUnlandedReason>[0]):MegaFundingRecord{
    return sealMegaFunding({...r,state:"failed_before_effect",terminal:true,rawTransaction:null,transactionHash:null,
      outcomeDigest:hashObject({id:r.operationId,...gaszipUnlandedReason(reason,r.transactionHash)})});
  }
  private async retireUnlanded(r:MegaFundingRecord,reason:"signed_never_sent"|"nonce_consumed_unlanded"):Promise<MegaFundingRecord>{
    const ended=await this.state.withLocks(this.locks(r),async()=>{
      const saved=await this.required(r.operationId);if(saved.terminal || saved.transactionHash!==r.transactionHash || saved.state!==r.state)return saved;
      // Every broadcast follows the create-only first-send marker. A marker the journal never recorded is an interrupted send
      // step: it becomes an observed unknown attempt, never a resend.
      const next=reason==="signed_never_sent" && saved.state==="sealed" && await this.journal.sendClaimedLocked(saved)
        ?sealMegaFunding({...saved,state:"unknown_finality",submissionAttempts:1}):this.unlanded(saved,reason);
      await this.journal.saveLocked(next);return next;
    });
    if(ended.terminal)await this.usage(ended,gaszipUsageState(ended.state as GaszipTerminalState));return ended;
  }
  async status(id:string):Promise<unknown>{
    let r=await this.required(id);
    if(r.terminal){await this.usage(r,gaszipUsageState(r.state as GaszipTerminalState));return publicMegaFunding(r);}
    if(r.state==="prepared"){
      if(this.now()<Date.parse(r.expiresAt))return publicMegaFunding(r);
      const ended=await this.state.withLocks(this.locks(r),async()=>{const saved=await this.required(id);if(saved.state!=="prepared")return saved;
        // Signing follows the durable signing_started save, so a first-sign marker on a prepared record signed nothing; only a
        // first-send marker could mean a broadcast.
        if(await this.journal.sendClaimedLocked(saved))megaFail("effect_marker_blocks_retirement"); const next=sealMegaFunding({...saved,state:"failed_before_effect",terminal:true,outcomeDigest:hashObject({id,reason:"unsigned_quote_expired"})});await this.journal.saveLocked(next);return next;}); if(ended.state==="failed_before_effect")await this.usage(ended,"failed_before_effect");return publicMegaFunding(ended);
    }
    // Approve never resumes a record that left "prepared", and the send step always runs to a recorded outcome, so a signed
    // effect still at signing_started or sealed was never broadcast.
    if(r.state==="signing_started" || r.state==="sealed")return publicMegaFunding(await this.retireUnlanded(r,"signed_never_sent"));
    if(r.transactionHash===null)return publicMegaFunding(r);
    let phase="source_proof",source:MegaSafeProof|null=null,destination:unknown=null,claimHash:Hex|null=null,failed=false;
    try{
      source=await proveMegaSource(this.rpc("source"),r);
      if(source===null)return await gaszipNonceConsumed(this.rpc("source"),r.owner.address,r.plan.nonce,megaQuantity)
        ?publicMegaFunding(await this.retireUnlanded(r,"nonce_consumed_unlanded")):publicMegaFunding(r);
      if(source.status==="success"){
        phase="provider_correlation";const response=await this.https.request(`${ORIGIN}/v2/deposit/${r.transactionHash}`,"GET",null,256*1024,"APN_HTTP_CONFIG");
        if(response.status!==200)megaFail("status_http");const d=inspectMegaDelivery(megaJson(response.body),r.transactionHash,r.owner.address,r.amountAtomic,source.blockNumber);
        if(d===null)return publicMegaFunding(r);
        if("providerFailure" in d){destination=d;failed=true;}
        else{
          phase="destination_proof";const proof=await proveMegaDelivery(this.rpc("destination"),r.owner.address,d);if(proof===null)return publicMegaFunding(r);
          // A proved payout below the owner's floor still arrived: it ends as a destination failure, not an open operation.
          failed=BigInt(proof.amount)<BigInt(r.minimumOutputAtomic);destination={...proof,providerDigest:d.providerDigest,...(failed?{belowOwnerFloor:true}:{})};claimHash=d.hash;
        }
      }
    }catch(error){return gaszipObservationRefusal(error,id,phase,"apn mega funding status");}
    if(source===null)return publicMegaFunding(r);
    // The Base L1 part is not capped by the signature: an actual fee over the owner's quote ceiling is reported, never a wedge.
    const sourceProof={...source,feeCapExceeded:source.actualFee===null || BigInt(source.actualFee)>BigInt(r.maximumFeeAtomic)};
    r=await this.state.withLocks([...this.locks(r),"mega-gaszip:destination-claims"],async()=>{
      const saved=await this.required(id);if(saved.terminal)return saved;if(saved.transactionHash!==r.transactionHash)megaFail("observation_record_drift");
      if(claimHash!==null)await this.journal.claimDestinationLocked(claimHash,id);
      const outcomeDigest=hashObject({source:sourceProof,destination});
      const next=sealMegaFunding({...saved,state:sourceProof.status!=="success"?"failed_confirmed_revert":failed?"destination_failed":"completed",
        terminal:true,sourceProof,destinationProof:destination,outcomeDigest});await this.journal.saveLocked(next);return next;
    });
    await this.usage(r,gaszipUsageState(r.state as GaszipTerminalState));return publicMegaFunding(r);
  }
}
