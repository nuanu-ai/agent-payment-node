import { StateStore } from "../../src/state.js";
import { verifiedCleanup85RecoveryAdmission } from "../../src/circle-v2-evm/cleanup85-recovery-admission.js";
import { Cleanup86Store, validateCleanup86Intent } from "../../src/circle-v2-evm/cleanup86-store.js";
import { verifyCleanup86RecoveryContext, verifiedCleanup86RecoveryContext } from "../../src/circle-v2-evm/cleanup85-effective-context.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryState } from "./helpers.js";
import { cleanup85PublicState, cleanup85PublicTransport } from "./cleanup85-native-public-fixture.js";
import { activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { circleMechanism } from "../../src/circle-v2-evm/usage.js";
import { circleRoute, CIRCLE_SOURCE_TOKEN } from "../../src/circle-v2-evm/catalog.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { Cleanup85UnsignedRetirementStore, CLEANUP85_UNSIGNED_ORIGINAL } from "../../src/circle-cleanup85-unsigned-retirement-store.js";
import { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage, verifyCleanup85SuccessorFinancialAdmission, verifiedCleanup85SuccessorFinancialAdmission, type VerifiedCleanup85SuccessorFinancialAdmission } from "../../src/circle-cleanup85-unsigned-retirement.js";
import { withCleanup85FinancialScope, assertHeldCleanup85Scope } from "../../src/circle-cleanup85-financial-scope.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import type { HeldCleanup85Scope } from "../../src/circle-cleanup85-financial-scope.js";
const env={APN_ARBITRUM_RPC_URL:"https://arbitrum-one-public.nodies.app",APN_SEI_RPC_URL:"https://evm-rpc.sei-apis.com"};
for(const variant of ["retire","crash","sign","signed","send","prepared","bad_slot","wrong_policy","nonce_drift","copied_token"] as const)test(`actual captured expired4b5 finite retirement ${variant}`,async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const f=await cleanup85PublicState(tmp.root),rpc=await cleanup85PublicTransport(),route=circleRoute(1329,"evm-live-seller"),clock=Date.parse("2026-10-09T20:00:00.000Z");
 const frame=JSON.parse(await readFile(new URL("../fixtures/cleanup85-unsigned-retirement/original-a-recovery-intent.json",import.meta.url),"utf8"));
 const records=JSON.parse(await readFile(new URL("../fixtures/cleanup85-unsigned-retirement/native-public-records.json",import.meta.url),"utf8")) as Record<string,unknown>;
 await writeFile(join(tmp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-intent.json`),canonicalJson(frame)+"\n");
 for(const[path,value]of Object.entries(records)){if(value===null)continue;await mkdir(join(tmp.root,path.split("/").slice(0,-1).join("/")),{recursive:true,mode:0o700});await writeFile(join(tmp.root,path),canonicalJson(value)+"\n",{mode:0o600});}
 const original=await f.state.findOperation(CLEANUP85_UNSIGNED_ORIGINAL);assert.ok(original);assert.equal(original.evm!.cleanup85Cancellation!.request.recoveryBinding,frame.recoveryBinding);
 for(const profile of [f.parent.profile,f.parent.destinationProfile])await activateDirectPolicy(tmp.root,profile,{accounts:{evm:profile===f.parent.profile?f.parent.sourceCustody.walletAddress:route.gasPayer},now:new Date(clock),expiresAt:"2026-10-09T20:46:57.000Z",admissions:[directAdmission("eip155:42161",null,{maximumPerTransferAtomic:"2000000000000",dailyLimitAtomic:"500000000000000"}),
 {chain:"eip155:42161",kind:"token",identifier:CIRCLE_SOURCE_TOKEN,rail:"bridge",maximumPerTransferAtomic:variant==="wrong_policy"?"1":"40100",dailyLimitAtomic:"40100",mechanism:circleMechanism(1329)},
 {chain:"eip155:42161",kind:"native",rail:"bridge",maximumPerTransferAtomic:"75000000000000",dailyLimitAtomic:"500000000000000",mechanism:circleMechanism(1329)},
 {chain:"eip155:1329",kind:"native",rail:"bridge",maximumPerTransferAtomic:route.destinationNativeCap,dailyLimitAtomic:route.destinationNativeCap,mechanism:circleMechanism(1329)}]});
 const sign=Object.keys(records).find(x=>x.endsWith(".signing.json"))!,signed=Object.keys(records).find(x=>x.endsWith(".signed.json"))!,send=Object.keys(records).find(x=>x.startsWith("direct-submissions"))!,prepared=Object.keys(records).find(x=>x.endsWith(".prepared.json"))!,slot=Object.keys(records).find(x=>x.endsWith("-slot.json"))!;
 if(["sign","signed","send","prepared","bad_slot"].includes(variant)){const path=variant==="sign"?sign:variant==="signed"?signed:variant==="send"?send:variant==="prepared"?prepared:slot;await mkdir(join(tmp.root,path.split("/").slice(0,-1).join("/")),{recursive:true,mode:0o700});await writeFile(join(tmp.root,path),"{}\n",{mode:0o600});}
 const https:typeof rpc.https={request:async(...args)=>{const q=JSON.parse(args[2]!);if(variant==="nonce_drift"&&q.method==="eth_getTransactionCount")return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:"0x56"})};return rpc.https.request(...args);}};
 let keys=0;const service=new CircleEvmService(f.state,{load:async()=>{keys++;throw Error("private forbidden");}} as never,env,()=>clock,{},https);
 const statePath=join(tmp.root,"operations",original.profileHash,`${original.operationId}.json`),before=await readFile(statePath),parentPath=join(tmp.root,"circle-v2-evm",`${f.parent.operationId}.json`),parentBefore=await readFile(parentPath);
 const write=f.state.writeOperation.bind(f.state);let interrupted=false;if(variant==="crash")f.state.writeOperation=async op=>{if(op.state==="failed_before_effect"&&!interrupted){interrupted=true;throw Error("after_create_only_proof");}await write(op);};
 if(["retire","crash","copied_token"].includes(variant)){
  if(variant==="crash"){await assert.rejects(service.prepareCleanup85Recovery(f.parent.operationId),/after_create_only_proof/);assert.deepEqual(await readFile(statePath),before);assert.ok(await new Cleanup85UnsignedRetirementStore(tmp.root).load());}
  const request=await service.prepareCleanup85Recovery(f.parent.operationId),terminal=(await f.state.findOperation(original.operationId))!;assert.equal(terminal.state,"failed_before_effect");assert.equal(terminal.terminal,true);assert.equal(terminal.fingerprint,original.fingerprint);assert.deepEqual(terminal.transitions.slice(0,original.transitions.length),original.transitions);
  const token=await resolveCleanup85NativeLineage(f.state,request),lineage=verifiedCleanup85NativeLineage(token,f.state,request);assert.notEqual(lineage.operationId,original.operationId);assert.ok(Object.isFrozen(lineage.readmission!.policies));assert.throws(()=>verifiedCleanup85NativeLineage({...token},f.state,request));
  const frozen=await readFile(statePath);await service.prepareCleanup85Recovery(f.parent.operationId);assert.deepEqual(await readFile(statePath),frozen);
  const effective=verifiedCleanup86RecoveryContext(await verifyCleanup86RecoveryContext(f.state,f.parent,frame),f.state,f.parent,frame);
  const oldEnvelope=f.parent.effects[2]!.envelope,{envelopeHash:_,...wire}=oldEnvelope,envelopeBody={...wire,nonceAtomic:"86"};
  const intent86=await new Cleanup86Store(tmp.root).start(f.parent,frame,{cancellationProofHash:"f".repeat(64),envelope:{...envelopeBody,envelopeHash:hashObject(envelopeBody)},policies:effective.readmission.policies,capturedAt:new Date(clock).toISOString(),windowEndsAt:effective.readmission.windowEndsAt});
  assert.equal(intent86.version,"apn.circle-cleanup86-intent.v2");assert.equal(intent86.retirementProofHash,lineage.retirementProofHash);assert.equal(intent86.freshReadmissionHash,effective.readmissionHash);assert.equal(intent86.recoveryBinding,frame.recoveryBinding);
  assert.throws(()=>validateCleanup86Intent(intent86,frame));assert.ok(await new Cleanup86Store(tmp.root).intent(f.parent,frame));
  let held:HeldCleanup85Scope|undefined,financial:VerifiedCleanup85SuccessorFinancialAdmission|undefined;await withCleanup85FinancialScope(f.state,request,lineage.operationId,async scope=>{
   held=scope;assertHeldCleanup85Scope(scope,f.state,request,lineage.operationId);const start=rpc.rows.length;
   financial=await verifyCleanup85SuccessorFinancialAdmission(f.state,new CircleRpc(env.APN_ARBITRUM_RPC_URL,42161,https),new CircleRpc(env.APN_SEI_RPC_URL,1329,https),request,()=>clock,scope);
   const body=verifiedCleanup85SuccessorFinancialAdmission(financial,f.state,request),original=verifiedCleanup85RecoveryAdmission(body.originalAdmission,request);
   assert.equal(original.parent.integrityHash,f.parent.integrityHash);assert.equal(original.intent.recoveryBinding,frame.recoveryBinding);assert.equal(body.readmission.recoveryBinding,lineage.readmission!.recoveryBinding);
   assert.equal(verifiedCleanup85SuccessorFinancialAdmission(financial,f.state,request).originalAdmission,body.originalAdmission);
   assert.throws(()=>verifiedCleanup85RecoveryAdmission(structuredClone(body.originalAdmission),request),/private_cleanup85_admission/);
   assert.throws(()=>verifiedCleanup85SuccessorFinancialAdmission({...financial!},f.state,request),/private_admission/);
   assert.throws(()=>verifiedCleanup85SuccessorFinancialAdmission(financial!,new StateStore(tmp.root),request),/private_admission/);
   assert.throws(()=>verifiedCleanup85SuccessorFinancialAdmission(financial!,f.state,{...request,recoveryBinding:"f".repeat(64)}),/private_admission/);
   assert.ok(Object.isFrozen(body));assert.ok(Object.isFrozen(body.readmission.policies));
   const rows=rpc.rows.slice(start);assert.equal(rows.filter(x=>x.method==="eth_getTransactionByHash"&&x.params[0]===f.parent.effects[0]!.transactionHash).length,1);
   t.diagnostic(`combined admission physical=${rows.length}; genuine original cap usable; cloned cap rejected`);
  });assert.throws(()=>assertHeldCleanup85Scope(held!,f.state,request,lineage.operationId));assert.throws(()=>verifiedCleanup85SuccessorFinancialAdmission(financial!,f.state,request),/held_financial_scope/);
 }else{await assert.rejects(service.prepareCleanup85Recovery(f.parent.operationId));assert.deepEqual(await readFile(statePath),before);assert.equal(await new Cleanup85UnsignedRetirementStore(tmp.root).load(),null);}
 assert.deepEqual(await readFile(parentPath),parentBefore);assert.equal(keys,0);assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));
});
