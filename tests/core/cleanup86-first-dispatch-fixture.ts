import { readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCipheriv,hkdfSync } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";
import { canonicalJson,hashObject } from "../../src/canonical.js";
import { cleanup85PublicState,cleanup85PublicTransport } from "./cleanup85-native-public-fixture.js";
import { CircleNonceRetirementStore } from "../../src/circle-v2-evm/nonce-retirement-store.js";
import { Cleanup85RecoveryStore } from "../../src/circle-v2-evm/cleanup85-recovery-store.js";
import { Cleanup86SnapshotStore } from "../../src/circle-v2-evm/cleanup86-snapshot.js";
import { validateCleanup86Intent,type Cleanup86Intent,type Cleanup86Effect } from "../../src/circle-v2-evm/cleanup86-store.js";
import { circleEnvelope } from "../../src/circle-v2-evm/operation-model.js";
import { circleMechanism,CircleUsage } from "../../src/circle-v2-evm/usage.js";
import { CIRCLE_SOURCE_TOKEN,circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { executeAllowlistPolicyCommand } from "../../src/allowlist-policy-command.js";
import { withCleanup85FinancialScope } from "../../src/circle-cleanup85-financial-scope.js";
import { resolveCleanup85NativeLineage,verifiedCleanup85NativeLineage } from "../../src/circle-cleanup85-unsigned-retirement.js";
import type { Cleanup85CancellationProof } from "../../src/circle-cleanup85-cancellation-contract.js";
import type { Cleanup86Material } from "../../src/circle-v2-evm/cleanup86-custody.js";

/** TEMP-only canonical journal fixture. The TEST wire signer is deliberately NOT the live Buyer.
 * This supports genuine authority/cipher negative tests; it is not live-owner restoration proof. */
export async function firstDispatchFixture(root:string) {
  const f=await cleanup85PublicState(root),parentIntent=(await new CircleNonceRetirementStore(root).intent(f.parent))!,recovery=(await new Cleanup85RecoveryStore(root).load(f.parent,parentIntent))!;
  let clock=Date.parse("2026-10-09T20:00:00.000Z"); const now=()=>clock;
  const renew=async()=> {
    for(const profile of [f.parent.profile,f.parent.destinationProfile]) {
      const old=await new AllowlistPolicyStore(root).read(profile),route=circleRoute(1329),file=join(root,`first-dispatch-policy-${profile}-${old.records.length}.json`);
      const policy={schemaVersion:"apn.allowlist-policy-file.v1",overlayVersion:`dispatch.test.${old.records.length+1}`,accounts:{evm:profile===f.parent.profile?f.parent.sourceCustody.walletAddress:f.parent.destinationCustody.walletAddress},effectiveAt:new Date(clock-60_000).toISOString(),expiresAt:new Date(clock+3_600_000).toISOString(),admissions:[
        {chain:"eip155:42161",kind:"token",identifier:CIRCLE_SOURCE_TOKEN,rail:"bridge",maximumPerTransferAtomic:"40100",dailyLimitAtomic:"40100",mechanism:circleMechanism(1329)},
        {chain:"eip155:42161",kind:"native",rail:"bridge",maximumPerTransferAtomic:"30000000000000",dailyLimitAtomic:"500000000000000",mechanism:circleMechanism(1329)},
        {chain:"eip155:1329",kind:"native",rail:"bridge",maximumPerTransferAtomic:route.destinationNativeCap,dailyLimitAtomic:route.destinationNativeCap,mechanism:circleMechanism(1329)}]};
      await writeFile(file,JSON.stringify(policy),{mode:0o600});
      const context={state:f.state,clock:{now:()=>new Date(clock)},allowlistPolicyApproval:{approve:async()=>{}}};
      const staged=await executeAllowlistPolicyCommand({command:"allowlist.policy.stage",profile,file,...(old.records.length===0?{}:{expectedRevision:old.records.at(-1)!.revision})},context);
      const revision=(staged.data as {revision:number}).revision; await executeAllowlistPolicyCommand({command:"allowlist.policy.activate",profile,revision},context);
    }
  }; await renew();
  const lineage=verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(f.state,f.request),f.state,f.request),transport=await cleanup85PublicTransport(),head=transport.snapshot.archiveAnchor;
  const eb={chainId:42161,from:f.parent.sourceCustody.walletAddress,to:recovery.recipientCustody.walletAddress,nonceAtomic:"85",valueAtomic:"1",data:"0x" as const,gasLimitAtomic:"21000",maxFeePerGasAtomic:"45000000",maxPriorityFeePerGasAtomic:"1"};
  const pb={version:"apn.circle-cleanup85-native-cancellation-proof.v1" as const,requestBinding:hashObject(f.request),operationId:lineage.operationId,fingerprint:"a".repeat(64),materialHash:"b".repeat(64),transactionHash:`0x${"c".repeat(64)}` as const,envelope:{...eb,envelopeHash:hashObject(eb)},sourceCustody:recovery.sourceCustody,recipientCustody:recovery.recipientCustody,observation:{transaction:{},receipt:{blockNumber:head.number,blockHash:head.hash},canonicalBlock:head,recheckedBlock:head,finalityHead:head,chainId:42161,finalityTag:"finalized" as const},actualFeeAtomic:"1",nativeConsumedAtomic:"2",nativeReservationId:"d".repeat(64),nativeOutcomeDigest:"e".repeat(64)};
  const proof={...pb,proofHash:hashObject(pb)} as Cleanup85CancellationProof;
  const {envelopeHash:_e,...original}=f.parent.effects[2]!.envelope,envelope=circleEnvelope({...original,nonceAtomic:"86",gasLimitAtomic:"46936",maxFeePerGasAtomic:"80024000",maxPriorityFeePerGasAtomic:"0"});
  const prefix=join(root,"circle-cleanup85-recovery",`${f.parent.operationId}-cleanup86-`),put=async(k:string,v:unknown)=>writeFile(`${prefix}${k}.json`,canonicalJson(v)+"\n",{mode:0o600});
  let policies!:Awaited<ReturnType<CircleUsage["retirementPolicies"]>>,windowEndsAt!:string|null;
  await withCleanup85FinancialScope(f.state,f.request,lineage.operationId,async scope=> {
    const usage=new CircleUsage(f.state,now); await usage.withCleanup85HeldPolicyScope(scope,f.request,lineage.operationId,async()=> {policies=await usage.retirementPolicies(f.parent);windowEndsAt=await usage.authorizationDeadline(f.parent,policies);});
  });
  const row=f.parent.usage[3]!,{state:_s,updatedAt:_at,effectAt:_ef,outcomeDigest:_out,consumedAtomic:_c,reservationDigest:_d,...historical}=row;
  const pf={version:"apn.circle-cleanup86-current-purpose.v1" as const,rootBinding:hashObject({root}),parentOperationId:f.parent.operationId,parentFingerprint:f.parent.fingerprint,recoveryBinding:recovery.recoveryBinding,recoveryHash:hashObject(recovery),requestBinding:hashObject(f.request),cancellationProofHash:proof.proofHash,sourceCustodyHash:hashObject(f.parent.sourceCustody),envelopeHash:envelope.envelopeHash,cleanupReservationId:row.reservationId,cleanupReservationHash:hashObject(historical),maximumFeeAtomic:"15000000000000" as const,policies,capturedAt:new Date(clock).toISOString(),asOfDate:"2026-10-09",windowEndsAt};
  const purpose={...pf,purposeHash:hashObject(pf)},base={recoveryBinding:recovery.recoveryBinding,cancellationProofHash:proof.proofHash,envelope,policies,capturedAt:purpose.capturedAt,windowEndsAt,currentPurpose:purpose};
  const b3={version:"apn.circle-cleanup86-intent.v3" as const,...base},i3={...b3,intentHash:hashObject(b3)};await put("intent",i3);
  const s3=await new Cleanup86SnapshotStore(root).capture(f.parent.operationId),legacy=s3.entries[`${f.parent.operationId}-cleanup86-intent.json`]!;
  const unsignedPredecessor={intentHash:i3.intentHash,file:legacy.identity,rootIdentity:s3.rootIdentity,directoryIdentity:s3.directoryIdentity};
  const b4={version:"apn.circle-cleanup86-intent.v4" as const,...base,unsignedPredecessor},i4={...b4,intentHash:hashObject(b4)};await put("generation-1-intent",i4);
  const e0={version:"apn.circle-cleanup86-effect.v1",intentHash:i4.intentHash,phase:"prepared",transactionHash:null,materialHash:null,sequence:0,previousHash:null},prepared={...e0,effectHash:hashObject(e0)};await put("effect",prepared);await put("history-0",prepared);
  const s4=await new Cleanup86SnapshotStore(root).capture(f.parent.operationId),identity=(k:string)=>s4.entries[`${f.parent.operationId}-cleanup86-${k}.json`]!.identity;
  const b5={version:"apn.circle-cleanup86-intent.v5" as const,...base,unsignedPredecessor,unsignedPreparedPredecessor:{intentHash:i4.intentHash,intent:identity("generation-1-intent"),effect:identity("effect"),history0:identity("history-0")}};
  const intent=validateCleanup86Intent({...b5,intentHash:hashObject(b5)},recovery,undefined,{root,op:f.parent});await put("generation-2-intent",intent);
  const account=privateKeyToAccount(`0x${"01".repeat(32)}`),rawTransaction=await account.signTransaction({type:"eip1559",chainId:42161,nonce:86,to:envelope.to,data:envelope.data,value:0n,gas:46936n,maxFeePerGas:80024000n,maxPriorityFeePerGas:0n,accessList:[]});
  const mb={version:"apn.circle-cleanup86-material.v1" as const,intentHash:intent.intentHash,recoveryBinding:recovery.recoveryBinding,envelopeHash:envelope.envelopeHash,rawTransaction,transactionHash:keccak256(rawTransaction)},material:Cleanup86Material={...mb,materialHash:hashObject(mb)};
  let previousHash:string|null=null,last:unknown;
  for(const [sequence,phase]of (["prepared","signing_started","sealed","unknown"] as const).entries()){const body:Omit<Cleanup86Effect,"effectHash">={version:"apn.circle-cleanup86-effect.v1",intentHash:intent.intentHash,phase,sequence,previousHash,transactionHash:sequence<2?null:material.transactionHash,materialHash:sequence<2?null:material.materialHash};const e:Cleanup86Effect={...body,effectHash:hashObject(body)};await put(`generation-2-history-${sequence}`,e);previousHash=e.effectHash;last=e;}await put("generation-2-effect",last);
  await put("sign",{version:"apn.circle-cleanup86-claim.v1",boundary:"sign",intentHash:intent.intentHash,recoveryBinding:recovery.recoveryBinding,cancellationProofHash:proof.proofHash});
  const fail={version:"apn.circle-cleanup86-first-failure.v1",intentHash:intent.intentHash,code:"APN_OPERATION_BLOCKED"};await put("first-failure",{...fail,failureHash:hashObject(fail)});
  const wrapping=Buffer.alloc(32,7),salt=Buffer.alloc(32,9),nonce=Buffer.alloc(12,3),header={version:"apn.circle-cleanup86-envelope.v1",operationId:f.parent.operationId,intentHash:intent.intentHash,recoveryBinding:recovery.recoveryBinding,envelopeHash:envelope.envelopeHash,materialHash:material.materialHash,transactionHash:material.transactionHash,salt:salt.toString("base64"),nonce:nonce.toString("base64")};
  const key=Buffer.from(hkdfSync("sha256",wrapping,salt,Buffer.from(canonicalJson(header)),32)),cipher=createCipheriv("aes-256-gcm",key,nonce);cipher.setAAD(Buffer.from(canonicalJson(header)));const bytes=Buffer.concat([cipher.update(Buffer.from(canonicalJson(material))),cipher.final()]);await put("material",{...header,ciphertext:bytes.toString("base64"),tag:cipher.getAuthTag().toString("base64")});key.fill(0);bytes.fill(0);
  return {...f,recovery,intent,proof,lineage,material,metadata:{transactionHash:material.transactionHash,materialHash:material.materialHash},now,setClock:(v:number)=>{clock=v;},renew,wrapping,prefix,put,transport,testSigner:account.address};
}
