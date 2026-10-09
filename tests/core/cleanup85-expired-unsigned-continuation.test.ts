import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { activeAssetPolicyFromState } from "../../src/allowlist-active-policy.js";
import { seal as sealUsage,withoutDigest } from "../../src/asset-usage-ledger-record.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir,readFile,writeFile,unlink } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson,domainHash,hashObject } from "../../src/canonical.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { circleRoute,CIRCLE_SOURCE_TOKEN } from "../../src/circle-v2-evm/catalog.js";
import { circleMechanism } from "../../src/circle-v2-evm/usage.js";
import { Cleanup85NativeCancellation,verifyCleanup85CancellationAccounting } from "../../src/circle-cleanup85-native-cancellation.js";
import { Cleanup85NativePublicRecords } from "../../src/circle-cleanup85-native-records.js";
import { cleanup85NativeLineage } from "../../src/circle-cleanup85-native-lineage.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { CLEANUP85_OWNER } from "../../src/circle-cleanup85-native-codec.js";
import { cleanup85PublicState,cleanup85PublicTransport } from "./cleanup85-native-public-fixture.js";
import { activateDirectPolicy,directAdmission } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { StateStore } from "../../src/state.js";
import { verifiedCleanup85NativeReservation, type VerifiedCleanup85NativeReservation, withCleanup85NativeReservationAuthorization } from "../../src/circle-cleanup85-native-ledger-authority.js";
const environment={APN_ARBITRUM_RPC_URL:"https://arbitrum-one-public.nodies.app",APN_SEI_RPC_URL:"https://evm-rpc.sei-apis.com"};
for(const variant of ["current","token","progression","sign","signed","send","material","slot","hold","gas","finalized_nonce","deadline","broker_deadline","window"] as const)test(`production expired unsigned sole successor continuation ${variant}`,{timeout:30000},async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const f=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport(),initialClock=Date.parse("2026-10-09T20:00:00.000Z"),route=circleRoute(1329,"evm-live-seller");
 const frame=JSON.parse(await readFile(new URL("../fixtures/cleanup85-unsigned-retirement/original-a-recovery-intent.json",import.meta.url),"utf8"));
 const records=JSON.parse(await readFile(new URL("../fixtures/cleanup85-unsigned-retirement/native-public-records.json",import.meta.url),"utf8")) as Record<string,unknown>;
 await writeFile(join(temp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-intent.json`),canonicalJson(frame)+"\n");
 for(const [path,body] of Object.entries(records)){if(body===null)continue;await mkdir(join(temp.root,path.split("/").slice(0,-1).join("/")),{recursive:true,mode:0o700});await writeFile(join(temp.root,path),canonicalJson(body)+"\n",{mode:0o600});}
 for(const profile of [f.parent.profile,f.parent.destinationProfile])await activateDirectPolicy(temp.root,profile,{accounts:{evm:profile===f.parent.profile?f.parent.sourceCustody.walletAddress:route.gasPayer},now:new Date(initialClock),expiresAt:"2026-10-09T20:46:57.000Z",admissions:[directAdmission("eip155:42161",null,{maximumPerTransferAtomic:"2000000000000",dailyLimitAtomic:"500000000000000"}),{chain:"eip155:42161",kind:"token",identifier:CIRCLE_SOURCE_TOKEN,rail:"bridge",maximumPerTransferAtomic:"40100",dailyLimitAtomic:"40100",mechanism:circleMechanism(1329)},{chain:"eip155:42161",kind:"native",rail:"bridge",maximumPerTransferAtomic:"75000000000000",dailyLimitAtomic:"500000000000000",mechanism:circleMechanism(1329)},{chain:"eip155:1329",kind:"native",rail:"bridge",maximumPerTransferAtomic:route.destinationNativeCap,dailyLimitAtomic:route.destinationNativeCap,mechanism:circleMechanism(1329)}]});
 let clock=initialClock;
 let captured:VerifiedCleanup85NativeReservation|undefined;const realLedger=new AssetUsageLedger(temp.root);
 let prompts=0,keys=0,fail=true;let successorId="";let continuation=false;
 const https:typeof rpc.https={request:async(...args)=>{
  const q=JSON.parse(args[2]!);
  if(fail&&successorId!==""&&rpc.rows.length>0&&await f.state.findOperation(successorId)!==null){return {status:429,body:"pre_reserve_fixture_stop"};}
  const response=await rpc.https.request(...args);
  if(continuation&&variant==="gas"&&q.method==="eth_estimateGas")return {...response,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:"0xffff"})};
  if(continuation&&variant==="finalized_nonce"&&q.method==="eth_getTransactionCount"&&typeof q.params[1]==="object")return {...response,body:JSON.stringify({jsonrpc:"2.0",id:q.id,result:"0x56"})};
  return response;
 }};
 const wrapping={load:async()=>{keys++;if(variant==="progression"){assert.ok(captured);const current=(await f.state.findOperation(successorId))!;assert.equal(current.state,"started");await readFile(join(temp.root,"direct-public-effects",current.profileHash,`${current.operationId}.signing.json`));assert.equal((await realLedger.load({account:CLEANUP85_OWNER,chain:"eip155:42161",asset:{kind:"native",identifier:null}},current.evm!.cleanup85Cancellation!.nativeReservationId))!.state,"reserved");const body=verifiedCleanup85NativeReservation(captured,temp.root);assert.equal(body.operation.operationId,current.operationId);assert.equal(body.operation.fingerprint,current.fingerprint);assert.equal(body.operation.expiresAt,current.expiresAt);assert.ok(Date.parse(body.authorizationExpiresAt)>clock);await assert.rejects(withCleanup85NativeReservationAuthorization(captured,f.state,async()=>{throw Error("should_not_enter");}),/private_current_native_authorization_required/);throw Error("private_FORBIDDEN_after_real_progression");}if(variant==="broker_deadline"){clock+=60000;return Buffer.alloc(32,19);}throw Error("private_FORBIDDEN");},create:async()=>{throw Error("private_FORBIDDEN");}};
 const cancellation=new Cleanup85NativeCancellation(f.state,wrapping,environment,{https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>clock,ledger:{reserveCleanup85Native:async(token,at)=>{captured=token;return realLedger.reserveCleanup85Native(token,at);},settleCleanup85Native:realLedger.settleCleanup85Native.bind(realLedger)},approve:async()=>{prompts++;
 if(continuation&&variant==="token"){assert.ok(captured);const body=verifiedCleanup85NativeReservation(captured,temp.root);assert.equal(body.operation.expiresAt,new Date(clock-1).toISOString());assert.equal(Date.parse(body.authorizationExpiresAt),clock+60000);for(const [token,state]of [[{...captured},f.state],[captured,new StateStore(temp.root)],[captured,f.state]] as const)await assert.rejects(withCleanup85NativeReservationAuthorization(token,state,async()=>{throw Error("should_not_enter");}),/private_current_native_authorization_required/);}if(continuation&&["deadline","broker_deadline","progression"].includes(variant)){if(variant==="deadline")clock+=60000;return;}throw Error("normal_current_prompt_stop");}});
 const service=new CircleEvmService(f.state,wrapping,environment,()=>clock,{},https,{cancellation,verifyCancellationAccounting:verifyCleanup85CancellationAccounting});
 fail=false;const request=await service.prepareCleanup85Recovery(f.parent.operationId),lineage=await cleanup85NativeLineage(f.state,request);successorId=lineage.operationId;fail=variant!=="hold";
 if(variant==="hold")await assert.rejects(service.cancelCleanup85(f.parent.operationId),/normal_current_prompt_stop/);else await assert.rejects(service.cancelCleanup85(f.parent.operationId),/unsuccessful HTTP response/);
 let op=await f.state.findOperation(successorId);
 // Controller's outer read can fail before B; finish creation with a stop only once the saved operation exists.
 if(op===null){fail=false;const execute=cancellation.execute.bind(cancellation);t.mock.method(cancellation,"execute",async(r:Parameters<Cleanup85NativeCancellation["execute"]>[0])=>{fail=true;return execute(r);});await assert.rejects(service.cancelCleanup85(f.parent.operationId),/unsuccessful HTTP response/);op=await f.state.findOperation(successorId);}
 assert.ok(op);assert.equal(op.state,"awaiting_approval");
 const paths=[join(temp.root,"operations",op.profileHash,`${op.operationId}.json`),join(temp.root,"direct-public-effects",op.profileHash,`${op.operationId}.prepared.json`),join(temp.root,"circle-cleanup85-native",`${f.parent.operationId}-successor-slot.json`),join(temp.root,"circle-cleanup85-recovery",`${lineage.originalOperationId}-unsigned-retirement.json`)];
 const before=await Promise.all(paths.map(p=>readFile(p)));clock=Date.parse(op.expiresAt)+1;continuation=true;fail=false;const beforePrompts=prompts;
 if(variant==="sign"||variant==="signed")await writeFile(join(temp.root,"direct-public-effects",op.profileHash,`${op.operationId}.${variant==="sign"?"signing":"signed"}.json`),"{}\n");
 if(variant==="send"){const dir=join(temp.root,"direct-submissions",op.profileHash);await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,`${op.operationId}.json`),"{}\n");}
 if(variant==="material")await new Cleanup85NativePublicRecords(temp.root).publish(op.operationId,"material",{operationId:op.operationId,fingerprint:op.fingerprint,transactionHash:`0x${"f".repeat(64)}`,materialHash:"e".repeat(64)});
 if(variant==="slot")await unlink(paths[2]!);
 if(variant==="window")clock=Date.parse("2026-10-09T20:46:57.000Z");
 if(["broker_deadline","progression"].includes(variant)){assert.equal((await service.cancelCleanup85(f.parent.operationId)).phase,"unknown");assert.equal(keys,1);assert.equal((await service.cancelCleanup85(f.parent.operationId)).phase,"unknown");assert.equal(keys,1);}
 else if(["current","token"].includes(variant))await assert.rejects(service.cancelCleanup85(f.parent.operationId),/normal_current_prompt_stop/);
 else await assert.rejects(service.cancelCleanup85(f.parent.operationId));
 assert.equal(prompts-beforePrompts,["current","token","deadline","broker_deadline","progression"].includes(variant)?1:0);assert.equal(keys,["broker_deadline","progression"].includes(variant)?1:0);
 if(!["broker_deadline","progression"].includes(variant))assert.deepEqual(await readFile(paths[0]!),before[0]);assert.deepEqual(await readFile(paths[1]!),before[1]);if(variant!=="slot")assert.deepEqual(await readFile(paths[2]!),before[2]);assert.deepEqual(await readFile(paths[3]!),before[3]);
 assert.ok(rpc.rows.every(row=>row.method!=="eth_sendRawTransaction"));
 if(variant==="token"){assert.ok(captured);await assert.rejects(withCleanup85NativeReservationAuthorization(captured,f.state,async()=>{throw Error("should_not_enter");}),/private_current_native_authorization_required/);}
 if(variant==="current")assert.equal((await f.state.findOperation(successorId))!.fingerprint,op.fingerprint);
});
test("fabricated current authorization cannot enter production foreground",async t=>{const tmp=await temporaryState();t.after(tmp.cleanup);const f=await cleanup85PublicState(tmp.root);let entered=false;await assert.rejects(withCleanup85NativeReservationAuthorization({kind:"verified-cleanup85-native-reservation"},f.state,async()=>{entered=true;}),/private_current_native_authorization_required/);assert.equal(entered,false);});
