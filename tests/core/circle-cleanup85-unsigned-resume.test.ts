import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { temporaryState } from "./helpers.js";
import { cleanup85PublicState, cleanup85PublicTransport, fixtureNow } from "./cleanup85-native-public-fixture.js";
import { activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { circleMechanism } from "../../src/circle-v2-evm/usage.js";
import { circleRoute, CIRCLE_SOURCE_TOKEN } from "../../src/circle-v2-evm/catalog.js";
import { Cleanup85NativeCancellation } from "../../src/circle-cleanup85-native-cancellation.js";
import { hashObject } from "../../src/canonical.js";
import { sealOperation } from "../../src/state-integrity.js";
import { evmDirectFingerprint } from "../../src/evm-direct.js";
const env = { APN_ARBITRUM_RPC_URL: "https://arbitrum-one-public.nodies.app", APN_SEI_RPC_URL: "https://evm-rpc.sei-apis.com" };
for (const variant of ["resume", "expired", "sign", "signed", "send", "prepared", "slot", "custody", "foreign"] as const) test(`entire normal cleanup85 controller unsigned publication ${variant}`, async t => {
 const tmp = await temporaryState(); t.after(tmp.cleanup);
 const f = await cleanup85PublicState(tmp.root), rpc = await cleanup85PublicTransport(), route = circleRoute(1329,"evm-live-seller");
 // Fixture creation only: replace the pre-generated mock A frame by real normal preparation.
 await rm(join(tmp.root,"circle-cleanup85-recovery",`${f.parent.operationId}-intent.json`));
 for (const profile of [f.parent.profile,f.parent.destinationProfile]) await activateDirectPolicy(tmp.root,profile,{accounts:{evm:profile===f.parent.profile?f.parent.sourceCustody.walletAddress:route.gasPayer},now:new Date(fixtureNow),expiresAt:"2026-10-09T16:20:00.000Z",admissions:[
  directAdmission("eip155:42161",null,{maximumPerTransferAtomic:"2000000000000",dailyLimitAtomic:"500000000000000"}),
  {chain:"eip155:42161",kind:"token",identifier:CIRCLE_SOURCE_TOKEN,rail:"bridge",maximumPerTransferAtomic:"40100",dailyLimitAtomic:"40100",mechanism:circleMechanism(1329)},
  {chain:"eip155:42161",kind:"native",rail:"bridge",maximumPerTransferAtomic:"75000000000000",dailyLimitAtomic:"500000000000000",mechanism:circleMechanism(1329)},
  {chain:"eip155:1329",kind:"native",rail:"bridge",maximumPerTransferAtomic:route.destinationNativeCap,dailyLimitAtomic:route.destinationNativeCap,mechanism:circleMechanism(1329)}]});
 let prompts=0,keys=0,offset=0,fail=true;const broker={load:async()=>{keys++;throw Error("private forbidden");},create:async()=>{throw Error("private forbidden");}};
 const https:typeof rpc.https={request:async(...args)=>{const q=JSON.parse(args[2]!);if(fail&&q.method==="eth_call"&&(await f.state.listOperations(f.parent.profileHash)).length>0){return {status:429,body:"bounded_fixture_rate_limit"};}return rpc.https.request(...args);}};
 const cancellation=new Cleanup85NativeCancellation(f.state,broker,env,{https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>fixtureNow+offset,approve:async()=>{prompts++;throw Error("stop_at_normal_prompt");}});
 const controller=new CircleEvmService(f.state,broker,env,()=>fixtureNow+offset,{},https,{cancellation,verifyCancellationAccounting:async()=>{throw Error("not needed preTTY");}});
 const parentPath=join(tmp.root,"circle-v2-evm",`${f.parent.operationId}.json`), parent=await readFile(parentPath);
 await assert.rejects(controller.cancelCleanup85(f.parent.operationId),/unsuccessful HTTP response/); fail=false;
 const o=(await f.state.listOperations(f.parent.profileHash))[0]!;assert.equal(o.state,"awaiting_approval");assert.equal(o.allowlistLease,undefined);assert.deepEqual([prompts,keys],[0,0]);
 const operationPath=join(tmp.root,"operations",o.profileHash,`${o.operationId}.json`),before=await readFile(operationPath),effects=join(tmp.root,"direct-public-effects",o.profileHash),preparedPath=join(effects,`${o.operationId}.prepared.json`),prepared=await readFile(preparedPath),slotPath=join(tmp.root,"circle-cleanup85-native",`${f.parent.operationId}-slot.json`),slot=await readFile(slotPath);
 if(variant==="expired")offset=600001;
 if(variant==="sign"||variant==="signed")await writeFile(join(effects,`${o.operationId}.${variant==="sign"?"signing":"signed"}.json`),"{}\n");
 if(variant==="send"){const dir=join(tmp.root,"direct-submissions",o.profileHash);await mkdir(dir,{recursive:true});await writeFile(join(dir,`${o.operationId}.json`),"{}\n");}
 if(variant==="prepared")await rm(preparedPath);
 if(variant==="slot")await writeFile(slotPath,"{}\n");
 if(variant==="custody"){const value=JSON.parse(prepared.toString());value.binding.custody.bindingHash="f".repeat(64);value.integrityHash=hashObject({schemaVersion:value.schemaVersion,binding:value.binding});await writeFile(preparedPath,JSON.stringify(value));}
 if(variant==="foreign"){
  const foreignId=f.state.operationId(o.profile,"foreign-native-operation"),body={...o,operationId:foreignId,idempotencyHash:f.state.idempotencyHash("foreign-native-operation"),requestHash:hashObject("foreign"),evm:{...o.evm!,cleanup85Cancellation:undefined},transitions:o.transitions};
  // Real distinct generic-native operation collides on the same sender; no cancellation slot alias.
  const {integrityHash:_old,...withoutIntegrity}=body; const {cleanup85Cancellation:_,...evm}=o.evm!,frozen={...withoutIntegrity,evm};await f.state.writeOperation(sealOperation({...frozen,fingerprint:evmDirectFingerprint(frozen)}));
 }
 if(variant==="resume")await assert.rejects(controller.cancelCleanup85(f.parent.operationId),/stop_at_normal_prompt/);
 else await assert.rejects(controller.cancelCleanup85(f.parent.operationId));
 assert.deepEqual([prompts,keys],[variant==="resume"?1:0,0]);assert.deepEqual(await readFile(parentPath),parent);
 assert.deepEqual(await readFile(operationPath),before);if(!["prepared","custody"].includes(variant))assert.deepEqual(await readFile(preparedPath),prepared);if(variant!=="slot")assert.deepEqual(await readFile(slotPath),slot);
 assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));
});
