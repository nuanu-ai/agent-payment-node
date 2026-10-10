import test from "node:test";
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup85PublicState, cleanup85PublicTransport, fixtureNow } from "./cleanup85-native-public-fixture.js";
import { temporaryState } from "./helpers.js";
import { Cleanup85NativeCancellation } from "../../src/circle-cleanup85-native-cancellation.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { CLEANUP85_OWNER,CLEANUP85_RECIPIENT,CLEANUP85_RECIPIENT_DELEGATE } from "../../src/circle-cleanup85-native-codec.js";
import { revokeDirectPolicy } from "./direct-allowlist-helpers.js";
const environment={APN_ARBITRUM_RPC_URL:"https://arbitrum-one-public.nodies.app",APN_SEI_RPC_URL:"https://evm-rpc.sei-apis.com"};
test("whole normal production prepare uses authentic parent and opaque preSIGN authority for real full2T ledger hold",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const fixture=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport();let keyLoads=0,prompts=0;
 const before=await readFile(join(temp.root,"circle-v2-evm",`${fixture.parent.operationId}.json`));
 const service=new Cleanup85NativeCancellation(fixture.state,{load:async()=>{keyLoads++;throw Error("private_forbidden");},create:async()=>{throw Error("private_forbidden");}},environment,{https:rpc.https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>fixtureNow,approve:async()=>{prompts++;throw Error("fixture_stop_at_prompt");}});
 await assert.rejects(service.execute(fixture.request),/fixture_stop_at_prompt/);
 const op=(await fixture.state.listOperations(fixture.parent.profileHash))[0]!;assert.equal(op.state,"awaiting_approval");assert.equal(keyLoads,0);assert.equal(prompts,1);
 const row=await new AssetUsageLedger(temp.root).load({account:CLEANUP85_OWNER,chain:"eip155:42161",asset:{kind:"native",identifier:null}},op.evm!.cleanup85Cancellation!.nativeReservationId);assert.equal(row?.state,"reserved");assert.equal(row?.amountAtomic,"2000000000000");assert.equal(row?.cleanup85NativeReservation?.fingerprint,op.fingerprint);assert.equal(row?.cleanup85NativeReservation?.activationDigest,op.evm!.cleanup85Cancellation!.activationDigest);
 assert.deepEqual(await readFile(join(temp.root,"circle-v2-evm",`${fixture.parent.operationId}.json`)),before);assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));
 const firstPhysical=rpc.rows.length;await assert.rejects(service.execute(fixture.request),/fixture_stop_at_prompt/);assert.equal(prompts,2);assert.equal(keyLoads,0);assert.equal((await fixture.state.findOperation(op.operationId))!.integrityHash,op.integrityHash);
 t.diagnostic(`production preSIGN prepare/reserve physical=${firstPhysical}; operation=${op.operationId}; signedMaximum=${row?.cleanup85NativeReservation?.signedMaximumDebitAtomic}`);
});
test("real production irreversible SIGN fence survives broker failure and concurrent execute never loads a key twice",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const fixture=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport();let keyLoads=0,prompts=0;
 let atStarted=0;const writeOperation=fixture.state.writeOperation.bind(fixture.state);fixture.state.writeOperation=async op=>{await writeOperation(op);if(op.state==="started")atStarted=rpc.rows.length;};
 const service=new Cleanup85NativeCancellation(fixture.state,{load:async()=>{keyLoads++;throw Error("fixture_broker_refusal_NO_KEY");},create:async()=>{throw Error("private_forbidden");}},environment,{https:rpc.https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>fixtureNow,approve:async()=>{prompts++;rpc.setPhase("foreground");}});
 const outcomes=await Promise.all([service.execute(fixture.request),service.execute(fixture.request)]);assert.ok(outcomes.every(x=>x.phase==="unknown"));assert.equal(keyLoads,1);assert.equal(prompts,1);
 const op=(await fixture.state.listOperations(fixture.parent.profileHash))[0]!;assert.equal(op.state,"started");assert.equal(op.transactionHash,undefined);assert.equal(op.rawTransactionHash,undefined);
 const signingPath=join(temp.root,"direct-public-effects",op.profileHash,`${op.operationId}.signing.json`),signing=await readFile(signingPath);assert.equal(JSON.parse(signing.toString()).schemaVersion,"apn.direct-public-signing.v2");
 const again=await service.execute(fixture.request);assert.equal(again.phase,"unknown");assert.equal(keyLoads,1);assert.equal(prompts,1);assert.deepEqual(await readFile(signingPath),signing);
 const row=await new AssetUsageLedger(temp.root).load({account:CLEANUP85_OWNER,chain:"eip155:42161",asset:{kind:"native",identifier:null}},op.evm!.cleanup85Cancellation!.nativeReservationId);assert.equal(row?.state,"unknown_finality");assert.equal(row?.amountAtomic,"2000000000000");assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));
 t.diagnostic(`whole production at durableSTARTED before permanentSIGN physical=${atStarted}; futureworst197; shared448-actual=${448-atStarted}; to refused wrapping-broker physical=${rpc.rows.length}; no actual walletkey/privatecrypto SIGN; permanentclaim1/noSEND`);
});
for(const kind of ["current_nonce","native_balance","token_code","sender_code","recipient_delegation","recipient_delegate_hash","zero_finality_head","approval_header"] as const)test(`whole production invalid ${kind} has zero SIGN/private broker/send and retains original parent`,async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const fixture=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport();let keyLoads=0,prompts=0;
 const before=await readFile(join(temp.root,"circle-v2-evm",`${fixture.parent.operationId}.json`));
 const https:typeof rpc.https={request:async(...args)=>{const request=JSON.parse(args[2]!);const response=await rpc.https.request(...args),body=JSON.parse(response.body);
  if(kind==="current_nonce"&&request.method==="eth_getTransactionCount")body.result="0x56";
  if(kind==="native_balance"&&request.method==="eth_getBalance")body.result="0x1";
  if(kind==="token_code"&&request.method==="eth_getCode")body.result="0x00";
  if(kind==="sender_code"&&request.method==="eth_getCode"&&request.params[0]===CLEANUP85_OWNER)body.result="0x00";
  if(kind==="recipient_delegation"&&request.method==="eth_getCode"&&request.params[0]===CLEANUP85_RECIPIENT)body.result="0x";
  if(kind==="recipient_delegate_hash"&&request.method==="eth_getCode"&&request.params[0]===CLEANUP85_RECIPIENT_DELEGATE)body.result="0x00";
  if(kind==="zero_finality_head"&&request.method==="eth_getBlockByNumber"&&request.params[0]==="finalized")body.result={...body.result,hash:`0x${"0".repeat(64)}`};
  if(kind==="approval_header"&&request.method==="eth_getBlockByNumber"&&request.params[0]==="0x1e95e873")body.result={...body.result,hash:`0x${"0".repeat(64)}`};
  return {...response,body:JSON.stringify(body)};
 }};
 const service=new Cleanup85NativeCancellation(fixture.state,{load:async()=>{keyLoads++;throw Error("private_forbidden");},create:async()=>{throw Error("private_forbidden");}},environment,{https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>fixtureNow,approve:async()=>{prompts++;}});
 await assert.rejects(service.execute(fixture.request));assert.equal(keyLoads,0);assert.equal(prompts,0);assert.equal((await fixture.state.listOperations(fixture.parent.profileHash)).length,0);assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));assert.deepEqual(await readFile(join(temp.root,"circle-v2-evm",`${fixture.parent.operationId}.json`)),before);
});
test("known insufficient remaining foreground time refuses BEFORE permanent SIGN and retries fresh consent with identical unsigned intent",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const fixture=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport();let offset=0,keyLoads=0,prompts=0;
 const service=new Cleanup85NativeCancellation(fixture.state,{load:async()=>{keyLoads++;throw Error("fixture_broker_refusal");},create:async()=>{throw Error("private_forbidden");}},environment,{https:rpc.https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>fixtureNow+offset,approve:async()=>{if(++prompts===1)offset+=40001;}});
 await assert.rejects(service.execute(fixture.request),/foreground_remaining_time/);let op=(await fixture.state.listOperations(fixture.parent.profileHash))[0]!;const hash=op.integrityHash;assert.equal(op.state,"awaiting_approval");assert.equal(keyLoads,0);await assert.rejects(readFile(join(temp.root,"direct-public-effects",op.profileHash,`${op.operationId}.signing.json`)),{code:"ENOENT"});
 const result=await service.execute(fixture.request);assert.equal(result.phase,"unknown");op=(await fixture.state.findOperation(op.operationId))!;assert.equal(keyLoads,1);assert.equal(prompts,2);assert.equal(op.fingerprint,JSON.parse((await readFile(join(temp.root,"direct-public-effects",op.profileHash,`${op.operationId}.prepared.json`))).toString()).binding.fingerprint);assert.notEqual(op.integrityHash,hash);assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));
});
test("expiry during fake wrapping broker prevents private decryption, retains independent SIGN and full unknown hold",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const fixture=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport();let offset=0,keyLoads=0;
 const service=new Cleanup85NativeCancellation(fixture.state,{load:async()=>{keyLoads++;offset+=60000;return Buffer.alloc(32,19);},create:async()=>{throw Error("private_forbidden");}},environment,{https:rpc.https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>fixtureNow+offset,approve:async()=>{}});
 const result=await service.execute(fixture.request);assert.equal(result.phase,"unknown");assert.equal(keyLoads,1);const op=(await fixture.state.listOperations(fixture.parent.profileHash))[0]!;assert.equal(op.transactionHash,undefined);assert.equal(op.state,"started");assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));const again=await service.execute(fixture.request);assert.equal(again.phase,"unknown");assert.equal(keyLoads,1);
});
test("true allowlist policy revocation cannot interleave foreground custody or permanent SIGN",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const fixture=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport();let revoked=false,keyLoads=0;let revocation:Promise<void>|undefined;
 const service=new Cleanup85NativeCancellation(fixture.state,{load:async()=>{keyLoads++;assert.equal(revoked,false);throw Object.assign(Error("never retain this private diagnostic"),{code:"APN_SECRET_BODY"});},create:async()=>{throw Error("private_forbidden");}},environment,{https:rpc.https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>fixtureNow,approve:async()=>{
  revocation=revokeDirectPolicy(temp.root,fixture.parent.profile,new Date(fixtureNow)).then(()=>{revoked=true;});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(revoked,false);
 }});
 const result=await service.execute(fixture.request);assert.equal(result.phase,"unknown");assert.equal(keyLoads,1);await revocation;assert.equal(revoked,true);
 const op=(await fixture.state.listOperations(fixture.parent.profileHash))[0]!,failure=await readFile(join(temp.root,"circle-cleanup85-native",`${op.operationId}-failure.json`),"utf8");assert.equal(JSON.parse(failure).errorCode,"APN_OPERATION_BLOCKED");assert.ok(!failure.includes("SECRET")&&!failure.includes("private diagnostic"));assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));
});
test("restoring normal unsigned native journal cannot erase its independent permanent SIGN claim",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const fixture=await cleanup85PublicState(temp.root),rpc=await cleanup85PublicTransport();let keyLoads=0,prompts=0;let prepared:import("../../src/model.js").OperationRecord|undefined;
 const service=new Cleanup85NativeCancellation(fixture.state,{load:async()=>{keyLoads++;throw Error("fixture_broker_refusal");},create:async()=>{throw Error("private_forbidden");}},environment,{https:rpc.https,nativeRpcUrl:"https://arb1.arbitrum.io/rpc",now:()=>fixtureNow,approve:async op=>{prompts++;prepared=op;}});
 assert.equal((await service.execute(fixture.request)).phase,"unknown");assert.equal(keyLoads,1);const signingPath=join(temp.root,"direct-public-effects",prepared!.profileHash,`${prepared!.operationId}.signing.json`),claim=await readFile(signingPath);
 await assert.rejects(fixture.state.writeOperation(prepared!),/cannot replace or rewind/);
 // Simulate a restored backup in this temporary root; normal writers already refuse rewinding it.
 await writeFile(join(temp.root,"operations",prepared!.profileHash,`${prepared!.operationId}.json`),JSON.stringify(prepared)+"\n");await assert.rejects(service.execute(fixture.request));assert.equal(keyLoads,1);assert.equal(prompts,1);assert.deepEqual(await readFile(signingPath),claim);assert.ok(rpc.rows.every(x=>x.method!=="eth_sendRawTransaction"));
});
