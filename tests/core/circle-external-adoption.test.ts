import assert from "node:assert/strict";import test from "node:test";import {rm,mkdir,writeFile,mkdtemp,realpath}from"node:fs/promises";import{join}from"node:path";
import { runCli,parseArgv } from "../../src/cli.js";import { hashObject,canonicalJson } from "../../src/canonical.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";import { advanceCircle,circleEnvelope,validateCircle } from "../../src/circle-v2-evm/operation-model.js";
import { CircleExternalStore } from "../../src/circle-v2-evm/external-store.js";import { CircleExternalRpcBudget,CircleExternalRpc } from "../../src/circle-v2-evm/external-rpc.js";
import { circleExternalHeader,decodeCircleExternalDestination } from "../../src/circle-v2-evm/external-proof.js";
import { decodeCircleDestination,encodeCircleMint } from "../../src/circle-v2-evm/protocol.js";import { CIRCLE_RECIPIENT } from "../../src/circle-v2-evm/catalog.js";
import { externalFixture,actor } from "./circle-external-fixtures.js";
const command=(op:string,tx:string)=>["circle","evm","adopt-external-mint","--operation",op,"--transaction-hash",tx];
async function invoke(f:Awaited<ReturnType<typeof externalFixture>>){return runCli(command(f.op.operationId,f.txHash),{}, {stateRoot:f.root,circleEvm:f.service,wrappingSecret:f.secret});}
test("normal CLI external adoption: actual isolated journal+ledger, expired R17/currentR18 and R35/currentR36",async t=>{
 const f=await externalFixture(true);t.after(()=>rm(f.root,{recursive:true,force:true}));const old=canonicalJson(f.op),result=await invoke(f);assert.equal(result.ok,true,JSON.stringify(result));
 const done=(await f.repo.load(f.op.operationId))!;validateCircle(done);assert.equal(done.state,"external_fulfilled");assert.equal(done.terminal,true);assert.equal(done.destination,null);assert.equal(done.effects.some(e=>e.role==="mint"),false);assert.deepEqual(done.policies.map(p=>p.revision),[35,17]);
 assert.deepEqual(done.usage.map(r=>r.state),["finalized","finalized","finalized","released_unsubmitted","released_unsubmitted"]);assert.equal(done.externalFulfillment!.netAtomic,"40095");assert.equal(done.externalFulfillment!.controlledDestinationNativeAtomic,"0");assert.equal(done.externalFulfillment!.caller,actor.address);
 const ledger=new AssetUsageLedger(f.root),sourceNative=await ledger.usageReadOnly(done.usage[1]!,new Date(Date.parse(done.preparedAt)+3000)),destNative=await ledger.usageReadOnly(done.usage[4]!,new Date(Date.parse(done.preparedAt)+3000));assert.equal(sourceNative.amountAtomic,"60000000000000");assert.equal(destNative.amountAtomic,"0");
 assert.equal(result.proof_class,"circle_external_mint_fulfillment");assert.equal(canonicalJson(f.op),old);assert.deepEqual(done.transitions.slice(0,f.op.transitions.length),f.op.transitions);assert.deepEqual(done.policies,f.op.policies);assert.deepEqual(done.effects,f.op.effects);
 assert.ok(f.calls.length<=160);assert.ok(!f.calls.some(m=>/estimate|send|maxPriority/u.test(m)));const calls=f.calls.length;const again=await invoke(f);assert.equal(again.ok,true,JSON.stringify(again));assert.equal(f.calls.length,calls);assert.equal((await f.repo.load(f.op.operationId))!.integrityHash,done.integrityHash);
 assert.throws(()=>decodeCircleDestination(f.op.source!,f.op.attestation!,f.dest,"1",f.op.destinationProfile),/transaction_finality_binding/);
});
for(const crash of ["claim",0,1,2,3,4] as const)test(`normal adoption crash after ${crash}: no money, idempotent exact five-row recovery`,async t=>{
 const f=await externalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let armed=true,count=0;
 if(crash==="claim"){const original=CircleExternalStore.prototype.claim;t.mock.method(CircleExternalStore.prototype,"claim",async function(this:CircleExternalStore,...args:Parameters<typeof original>){await original.apply(this,args);if(armed){armed=false;throw Error("CRASH");}});}
 else {const original=AssetUsageLedger.prototype.transition;t.mock.method(AssetUsageLedger.prototype,"transition",async function(this:AssetUsageLedger,...args:Parameters<typeof original>){const result=await original.apply(this,args);if(armed&&count++===crash){armed=false;throw Error("CRASH");}return result;});}
 const first=await invoke(f);assert.equal(first.ok,false);const second=await invoke(f);assert.equal(second.ok,true,JSON.stringify(second));assert.equal((await f.repo.load(f.op.operationId))!.state,"external_fulfilled");
});
for(const variant of ["nonce","body","token","fee","delta","finality","receipt","header","pin","own_sign","material","controlled","block_logs","reorg"] as const)test(`normal adoption refuses ${variant} before any release`,async t=>{
 const f=await externalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));const receipt=f.dest.receipt as any,tx=f.dest.transaction as any;
 if(variant==="nonce")receipt.logs[3].topics[2]=`0x${"aa".repeat(32)}`;
 if(variant==="body")receipt.logs[3].data=receipt.logs[3].data.slice(0,-2)+"01";
 if(variant==="token")receipt.logs[0].address=CIRCLE_RECIPIENT;
 if(variant==="fee")receipt.logs[2].data=`0x${(40095n).toString(16).padStart(64,"0")}${(6n).toString(16).padStart(64,"0")}`;

 if(variant==="receipt")receipt.status="0x0";
 if(variant==="header")(f.dest.canonicalBlock as any).stateRoot=`0x${"ff".repeat(32)}`;
 if(variant==="own_sign"){const envelope=circleEnvelope({chainId:143,from:f.op.destinationCustody.walletAddress,to:"0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",data:encodeCircleMint(f.op.attestation!),valueAtomic:"0",nonceAtomic:"3",gasLimitAtomic:"500000",maxFeePerGasAtomic:"20000000",maxPriorityFeePerGasAtomic:"0"});const changed=advanceCircle(f.op,{effects:[...f.op.effects,{role:"mint",phase:"signing_started",envelope,transactionHash:null,materialHash:null,proof:null}]},"mint_signing_fence",Date.parse(f.op.preparedAt));await f.repo.save(changed);}
 if(variant==="material"){await mkdir(join(f.root,"circle-v2-evm-effects"),{recursive:true,mode:0o700});await writeFile(join(f.root,"circle-v2-evm-effects",`${f.op.operationId}-mint.json`),"{}",{mode:0o600});}
 if(variant==="controlled"){const {sealWallet}=await import("../../src/state.js"),{projectLegacyLocalProfile}=await import("../../src/provider-profile.js");const profile="external-caller-controlled";const wallet=sealWallet({schemaVersion:"apn.state.v1",profile,profileHash:f.state.profileHash(profile),address:actor.address,createdAt:f.op.preparedAt,bindingHash:"a".repeat(64)});await f.state.writeWallet(wallet);await f.state.writeProviderProfile(projectLegacyLocalProfile(wallet));}
 if(variant==="pin"||variant==="delta"||variant==="finality"||variant==="block_logs"||variant==="reorg"){const original=f.publicNetwork.request.bind(f.publicNetwork);t.mock.method(f.publicNetwork,"request",async(...args:Parameters<typeof original>)=>{const response=await original(...args),r=JSON.parse(args[2]!),x=JSON.parse(response.body);if(variant==="block_logs"&&r.method==="eth_getLogs")x.result=[];if(variant==="reorg"&&r.method==="eth_getBlockByNumber"&&r.params[0]==="0xa")x.result={...x.result,stateRoot:`0x${"ff".repeat(32)}`};if(variant==="finality"&&r.method==="eth_getBlockByNumber"&&r.params[0]==="safe")x.result={...x.result,number:"0x0"};if(variant==="pin"&&r.method==="eth_getCode")x.result="0x01";if(variant==="delta"&&r.method==="eth_call"&&r.params[0].data.startsWith("0x70a08231"))x.result=`0x${(40094n).toString(16).padStart(64,"0")}`;return {...response,body:JSON.stringify(x)};});}
 const result=await invoke(f);assert.equal(result.ok,false,JSON.stringify(result));for(const row of f.op.usage)assert.equal((await new AssetUsageLedger(f.root).load(row,row.reservationId))!.state,"unknown_finality");
});
test("adoption RPC hard gates: method, exact block logs, total count, deadline",async()=>{let clock=1,calls=0;const transport={request:async(_u:unknown,_m:unknown,b:string|null)=>{calls++;const x=JSON.parse(b!);return{status:200,body:JSON.stringify({jsonrpc:"2.0",id:x.id,result:"0x1"})};}};
 const budget=new CircleExternalRpcBudget(()=>clock,100,transport as never),rpc=new CircleExternalRpc("https://rpc.example",143,budget);for(const method of ["eth_estimateGas","eth_sendRawTransaction","eth_maxPriorityFeePerGas"])await assert.rejects(rpc.call(method,[]),/budget_or_method/);assert.equal(calls,0);
 await assert.rejects(rpc.call("eth_getLogs",[{fromBlock:"0x1",toBlock:"latest"}]),/exact_block/);clock=100;await assert.rejects(rpc.call("eth_chainId",[]),/deadline/);assert.equal(calls,0);
 const b=new CircleExternalRpcBudget(()=>1,100,transport as never),a=new CircleExternalRpc("https://rpc1.example",143,b),c=new CircleExternalRpc("https://rpc2.example",42161,b);for(let i=0;i<160;i++)await(i%2?a:c).call("eth_chainId",[]);await assert.rejects(a.call("eth_chainId",[]),/budget_or_method/);assert.equal(calls,160);
});
test("finite command binds exact operation and transaction only",()=>{assert.equal(parseArgv(command("1".repeat(64),`0x${"2".repeat(64)}`)).request.command,"circle.evm.adopt-external-mint");for(const tail of [["--force"],["--profile","default"],["--transaction-hash","bad"]])assert.throws(()=>parseArgv([...command("1".repeat(64),`0x${"2".repeat(64)}`),...tail]));});
test("create-only nonce/source claim refuses another operation and repairs interrupted primary creation",async t=>{
 const f=await externalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));assert.equal((await invoke(f)).ok,true);
 const done=(await f.repo.load(f.op.operationId))!,store=new CircleExternalStore(f.root),proof=done.externalFulfillment!;
 await assert.rejects(store.readClaim({...done,operationId:"2".repeat(64)}),/claim_conflict/);
 const primary=join(f.root,"circle-external-claims",`${proof.claimDigest}.json`);await rm(primary);assert.equal((await store.readClaim(done))!.proofHash,proof.proofHash);
 await store.claim(done,proof,await store.evidence(proof));assert.equal((await store.readClaim(done))!.proofHash,proof.proofHash);
 await assert.rejects(store.claim(done,{...proof,evidenceHash:"0".repeat(64)},{}),/proof_binding/);
});
test("external proof physical concurrency and per-origin ceilings are finite",async()=>{
 let active=0,max=0,physical=0;const transport={request:async(_url:unknown,_method:unknown,body:string|null)=>{active++;max=Math.max(max,active);physical++;await new Promise<void>(r=>setImmediate(r));active--;const x=JSON.parse(body!);return{status:200,body:JSON.stringify({jsonrpc:"2.0",id:x.id,result:"0x1"})};}};
 const b=new CircleExternalRpcBudget(()=>1,100,transport as never),rpc=new CircleExternalRpc("https://rpc.example",143,b);await Promise.all(Array.from({length:16},()=>rpc.call("eth_chainId",[])));assert.equal(max,4);
 for(let i=16;i<128;i++)await rpc.call("eth_chainId",[]);await assert.rejects(rpc.call("eth_chainId",[]),/origin_budget/);assert.equal(physical,128);
});

test("normal external V2 zero-issuer adoption uses exact one net Transfer and never reads fee recipient",async t=>{const f=await externalFixture(true,0n);t.after(()=>rm(f.root,{recursive:true,force:true}));const result=await invoke(f);assert.equal(result.ok,true,JSON.stringify(result));const done=(await f.repo.load(f.op.operationId))!;assert.equal(done.externalFulfillment!.netAtomic,"40100");assert.equal(done.externalFulfillment!.issuerFeeAtomic,"0");assert.equal(done.externalFulfillment!.controlledDestinationNativeAtomic,"0");});

for(const chain of [1329,59144] as const)test(`adoption is no longer Monad-only: a ${chain} operation reaches the source-proof gate before any network/private access`,async t=>{
 const {tmpdir}=await import("node:os"),{StateStore}=await import("../../src/state.js"),{CircleRepository}=await import("../../src/circle-v2-evm/repository.js"),{CircleEvmService}=await import("../../src/circle-v2-evm/runtime.js"),{initial,at}=await import("./circle-v2-evm-nonce-runtime-fixtures.js");
 const root=await realpath(await mkdtemp(join(tmpdir(),"circle-external-scope-")));t.after(()=>rm(root,{recursive:true,force:true}));const state=new StateStore(root);await state.initialize();const op=initial(root,chain);await new CircleRepository(root).save(op);const deny=async()=>{throw Error("PRIVATE_OR_NETWORK_ENTRY");},secret={load:deny,create:deny},service=new CircleEvmService(state,secret,{},()=>at,{input:deny} as never,{request:deny} as never);
 const result=await runCli(command(op.operationId,`0x${"22".repeat(32)}`),{},{stateRoot:root,circleEvm:service,wrappingSecret:secret});assert.equal(result.ok,false);assert.match(JSON.stringify(result),/external_verified_source_required/);assert.doesNotMatch(JSON.stringify(result),/monad/);assert.equal((await new CircleRepository(root).load(op.operationId))!.integrityHash,op.integrityHash);
});
for(const variant of ["valid","conflicting","malformed"] as const)test(`owned normal mint refuses ${variant} durable external tombstone after original-journal restoration`,async t=>{
 const f=await externalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));assert.equal((await invoke(f)).ok,true);const restored=canonicalJson(f.op);await writeFile(join(f.root,"circle-v2-evm",`${f.op.operationId}.json`),restored+"\n",{mode:0o600});
 const claimPath=join(f.root,"circle-external-claims",`operation-${f.op.operationId}.json`);
 if(variant!=="valid"){const {readFile}=await import("node:fs/promises");const claim=JSON.parse(await readFile(claimPath,"utf8"));if(variant==="conflicting"){claim.fingerprint="9".repeat(64);const{claimHash,...body}=claim;claim.claimHash=hashObject(body);}await writeFile(claimPath,canonicalJson(variant==="malformed"?{}:claim)+"\n",{mode:0o600});}
 let tty=0,secret=0,seal=0,material=0,network=0;const {CircleEvmService}=await import("../../src/circle-v2-evm/runtime.js"),{LocalCircleCustody}=await import("../../src/circle-v2-evm/custody.js");
 const wrapping={load:async()=>{secret++;throw Error("PRIVATE");},create:async()=>{secret++;throw Error("PRIVATE");}};t.mock.method(LocalCircleCustody.prototype,"seal",async()=>{seal++;throw Error("SIGN");});t.mock.method(LocalCircleCustody.prototype,"load",async()=>{material++;throw Error("MATERIAL");});
 const service=new CircleEvmService(f.state,wrapping,{APN_ARBITRUM_RPC_URL:"https://arbitrum.example",APN_MONAD_RPC_URL:"https://monad.example"},()=>Date.parse(f.op.preparedAt)+3000,{openTerminal:async()=>{tty++;throw Error("TTY");}}, {request:async()=>{network++;return{status:200,body:JSON.stringify({jsonrpc:"2.0",id:1,result:"0x0"})};}} as never);
 const result=await runCli(["circle","evm","approve-mint","--operation",f.op.operationId],{},{stateRoot:f.root,circleEvm:service,wrappingSecret:wrapping});assert.equal(result.ok,false);assert.match(JSON.stringify(result),variant==="valid"?/external_mint_claimed_owned_entry_forbidden/:variant==="conflicting"?/external_claim_conflict/:/external_claim_shape/);assert.deepEqual({tty,secret,seal,material,network},{tty:0,secret:0,seal:0,material:0,network:0});assert.equal(canonicalJson((await f.repo.load(f.op.operationId))!),restored);
});
test("crash after operation tombstone before nonce/source indexes blocks owned mint and recovers exact public settlement",async t=>{
 const f=await externalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let armed=true;
 const proto=CircleExternalStore.prototype as unknown as {writeJson:(path:string,value:unknown,createOnly?:boolean)=>Promise<void>},original=proto.writeJson;
 t.mock.method(proto,"writeJson",async function(this:typeof proto,...args:Parameters<typeof original>){await original.apply(this,args);if(armed&&args[0].includes("/operation-")){armed=false;throw Error("CRASH_AFTER_OPERATION_TOMBSTONE");}});
 assert.equal((await invoke(f)).ok,false);assert.equal((await f.repo.load(f.op.operationId))!.integrityHash,f.op.integrityHash);const calls=f.calls.length;
 const owned=await runCli(["circle","evm","approve-mint","--operation",f.op.operationId],{},{stateRoot:f.root,circleEvm:f.service,wrappingSecret:f.secret});assert.equal(owned.ok,false);assert.match(JSON.stringify(owned),/external_mint_claimed_owned_entry_forbidden/);assert.equal(f.calls.length,calls);
 assert.equal((await invoke(f)).ok,true);assert.equal((await f.repo.load(f.op.operationId))!.state,"external_fulfilled");
});

import { fundingExternalFixture } from "./circle-funding-external-fixtures.js";
import { CircleFundingExternalStore } from "../../src/circle-v2-evm/funding-external-store.js";
import { validateCircleFundingOperation, advanceCircleFundingOperation } from "../../src/circle-v2-evm/funding-operation.js";
async function invokeFundingExternal(f:Awaited<ReturnType<typeof fundingExternalFixture>>) { return runCli(command(f.op.operationId,f.txHash),{}, {stateRoot:f.root,circleFundingEvm:f.service,wrappingSecret:f.secret}); }
test("finite funding V2 explicit external mint uses exact510000 fee71 net509929 and zero controlled destination gas",async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));const frozen=canonicalJson(f.op),result=await invokeFundingExternal(f);assert.equal(result.ok,true,JSON.stringify(result));
 const done=(await f.repo.loadAny(f.op.operationId))!;assert.equal(done.schemaVersion,"apn.circle-v2-evm-operation.v2");if(done.schemaVersion!=="apn.circle-v2-evm-operation.v2")throw Error("schema");validateCircleFundingOperation(done);
 assert.equal(done.state,"external_fulfilled");assert.equal(done.destination,null);assert.equal(done.effects.some(e=>e.role==="mint"),false);assert.deepEqual(done.effects,f.op.effects);assert.equal(done.fingerprint,f.op.fingerprint);assert.deepEqual(done.policies,f.op.policies);
 assert.equal(done.externalFulfillment!.netAtomic,"509929");assert.equal(done.externalFulfillment!.grossAtomic,"510000");assert.equal(done.externalFulfillment!.issuerFeeAtomic,"71");assert.equal(done.externalFulfillment!.controlledDestinationNativeAtomic,"0");assert.equal(done.externalFulfillment!.caller,actor.address);
 assert.deepEqual(done.usage.map(r=>r.state),["finalized","finalized","finalized","released_unsubmitted","released_unsubmitted"]);const ledger=new AssetUsageLedger(f.root);assert.equal((await ledger.usageReadOnly(done.usage[1]!,new Date(Date.parse(done.preparedAt)+3000))).amountAtomic,"60000000000000");assert.equal((await ledger.usageReadOnly(done.usage[4]!,new Date(Date.parse(done.preparedAt)+3000))).amountAtomic,"0");
 assert.equal(canonicalJson(f.op),frozen);assert.ok(!f.calls.some(m=>/estimate|send|maxPriority/u.test(m)));const count=f.calls.length;assert.equal((await invokeFundingExternal(f)).ok,true);assert.equal(f.calls.length,count);
});
for(const variant of ["nonce","body","token","fee","receipt","header","pin","net","recipient","reorg","source_finality","destination_finality","material","sign","send","controlled"] as const)test(`funding V2 external refuses ${variant}, preserves all full holds`,async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));const receipt=f.dest.receipt as any;
 if(variant==="nonce")receipt.logs[3].topics[2]=`0x${"aa".repeat(32)}`;if(variant==="body")receipt.logs[3].data=receipt.logs[3].data.slice(0,-2)+"01";if(variant==="token")receipt.logs[0].address=CIRCLE_RECIPIENT;if(variant==="fee")receipt.logs[2].data=`0x${(509929n).toString(16).padStart(64,"0")}${(72n).toString(16).padStart(64,"0")}`;if(variant==="receipt")receipt.status="0x0";if(variant==="header")(f.dest.canonicalBlock as any).stateRoot=`0x${"ff".repeat(32)}`;
 if(variant==="net")receipt.logs[0].data=`0x${(509928n).toString(16).padStart(64,"0")}`;if(variant==="recipient")receipt.logs[0].topics[2]=`0x${"0".repeat(24)}${"88".repeat(20)}`;
 if(["material","sign","send"].includes(variant)){await mkdir(join(f.root,"circle-v2-evm-funding-effects"),{recursive:true,mode:0o700});await writeFile(join(f.root,"circle-v2-evm-funding-effects",`${f.op.operationId}-mint${variant==="material"?"":`-${variant}`}.json`),"{}",{mode:0o600});}
 if(variant==="controlled"){const {sealWallet}=await import("../../src/state.js"),{projectLegacyLocalProfile}=await import("../../src/provider-profile.js");const profile="funding-external-controlled";const wallet=sealWallet({schemaVersion:"apn.state.v1",profile,profileHash:f.state.profileHash(profile),address:actor.address,createdAt:f.op.preparedAt,bindingHash:"a".repeat(64)});await f.state.writeWallet(wallet);await f.state.writeProviderProfile(projectLegacyLocalProfile(wallet));}
 if(["pin","reorg","source_finality","destination_finality"].includes(variant)){const original=f.publicNetwork.request.bind(f.publicNetwork);t.mock.method(f.publicNetwork,"request",async(...args:Parameters<typeof original>)=>{const response=await original(...args),q=JSON.parse(args[2]!),x=JSON.parse(response.body);if(variant==="reorg"&&q.method==="eth_getBlockByNumber"&&q.params[0]==="0xa")x.result={...x.result,stateRoot:`0x${"ff".repeat(32)}`};if((variant==="destination_finality"&&q.params[0]==="safe"||variant==="source_finality"&&q.params[0]==="finalized")&&q.method==="eth_getBlockByNumber")x.result={...x.result,number:"0x0"};if(variant==="pin"&&q.method==="eth_getCode")x.result="0x01";return {...response,body:JSON.stringify(x)};});}
 const result=await invokeFundingExternal(f);assert.equal(result.ok,false,JSON.stringify(result));for(const row of f.op.usage)assert.equal((await new AssetUsageLedger(f.root).load(row,row.reservationId))!.state,"unknown_finality");assert.ok(!f.calls.includes("eth_sendRawTransaction"));
});
for(const crash of ["claim",0,1,2,3,4] as const)test(`funding V2 explicit proof crash ${crash} resumes without new effects`,async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let armed=true,count=0;
 if(crash==="claim"){const original=CircleFundingExternalStore.prototype.claim;t.mock.method(CircleFundingExternalStore.prototype,"claim",async function(this:CircleFundingExternalStore,...args:Parameters<typeof original>){await original.apply(this,args);if(armed){armed=false;throw Error("CRASH");}});}
 else{const original=AssetUsageLedger.prototype.transition;t.mock.method(AssetUsageLedger.prototype,"transition",async function(this:AssetUsageLedger,...args:Parameters<typeof original>){const value=await original.apply(this,args);if(armed&&count++===crash){armed=false;throw Error("CRASH");}return value;});}
 assert.equal((await invokeFundingExternal(f)).ok,false);assert.equal((await invokeFundingExternal(f)).ok,true);const done=(await f.repo.loadAny(f.op.operationId))!;assert.equal(done.state,"external_fulfilled");
});
test("funding V2 durable external nonce claim blocks restored owned mint before network/consent/key",async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));assert.equal((await invokeFundingExternal(f)).ok,true);await writeFile(join(f.root,"circle-v2-evm",`${f.op.operationId}.json`),canonicalJson(f.op)+"\n",{mode:0o600});const calls=f.calls.length;const result=await runCli(["circle","evm","approve-mint","--operation",f.op.operationId],{}, {stateRoot:f.root,circleFundingEvm:f.service,wrappingSecret:f.secret});assert.equal(result.ok,false);assert.equal(f.calls.length,calls);assert.equal((await f.repo.loadAny(f.op.operationId))!.integrityHash,f.op.integrityHash);
});

for(const role of ["mint","cleanup"] as const)for(const suffix of ["","-sign","-send"] as const)test(`funding V2 secure absence refuses ${role}${suffix} before public RPC or key`,async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));await mkdir(join(f.root,"circle-v2-evm-funding-effects"),{recursive:true,mode:0o700});await writeFile(join(f.root,"circle-v2-evm-funding-effects",`${f.op.operationId}-${role}${suffix}.json`),"{}",{mode:0o600});assert.equal((await invokeFundingExternal(f)).ok,false);assert.equal(f.calls.length,0);for(const row of f.op.usage)assert.equal((await new AssetUsageLedger(f.root).load(row,row.reservationId))!.state,"unknown_finality");
});
test("funding V2 prior mint signing fence cannot be adopted even without material or hash",async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));const e=circleEnvelope({chainId:143,from:f.op.destinationCustody.walletAddress,to:"0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",data:encodeCircleMint(f.op.attestation!),valueAtomic:"0",nonceAtomic:"3",gasLimitAtomic:"500000",maxFeePerGasAtomic:"20000000",maxPriorityFeePerGasAtomic:"0"});const changed=advanceCircleFundingOperation(f.op,{effects:[...f.op.effects,{role:"mint",phase:"signing_started",envelope:e,transactionHash:null,materialHash:null,proof:null}]},"mint_signing_fence",Date.parse(f.op.preparedAt));await f.repo.saveFunding(changed);assert.equal((await invokeFundingExternal(f)).ok,false);assert.equal(f.calls.length,0);
});

test("funding V2 adopts an external mint after the owned mint was proven never to land, keeping its abandoned record",async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));const e=circleEnvelope({chainId:143,from:f.op.destinationCustody.walletAddress,to:"0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",data:encodeCircleMint(f.op.attestation!),valueAtomic:"0",nonceAtomic:"3",gasLimitAtomic:"500000",maxFeePerGasAtomic:"20000000",maxPriorityFeePerGasAtomic:"0"});
 const lost=`0x${"5".repeat(64)}` as const,steps=[["prepared","mint_envelope_frozen"],["signing_started","mint_signing_fence"],["sealed","mint_material_sealed"],["submission_started","mint_submission_fence"],["unknown","mint_fenced_unknown_observe_only"],["abandoned_unsent","mint_sent_bytes_never_land"]] as const;
 let op=f.op;for(const [phase,reason] of steps){const signed=!["prepared","signing_started"].includes(phase);op=advanceCircleFundingOperation(op,{state:phase==="abandoned_unsent"?"awaiting_mint":phase==="prepared"?"awaiting_mint":"mint_unknown",effects:[...op.effects.filter(x=>x.role!=="mint"),{role:"mint",phase,envelope:e,transactionHash:signed?lost:null,materialHash:signed?"6".repeat(64):null,proof:null}]},reason,Date.parse(f.op.preparedAt));await f.repo.saveFunding(op);}
 // The permanent claims of the abandoned attempt stay; its signed bytes were discarded.
 await mkdir(join(f.root,"circle-v2-evm-funding-effects"),{recursive:true,mode:0o700});for(const kind of ["sign","send"])await writeFile(join(f.root,"circle-v2-evm-funding-effects",`${f.op.operationId}-mint-${kind}.json`),"{}",{mode:0o600});
 const result=await invokeFundingExternal(f);assert.equal(result.ok,true,JSON.stringify(result));const done=(await f.repo.loadAny(f.op.operationId))!;if(done.schemaVersion!=="apn.circle-v2-evm-operation.v2")throw Error("schema");validateCircleFundingOperation(done);
 assert.equal(done.state,"external_fulfilled");const mint=done.effects.find(x=>x.role==="mint")!;assert.equal(mint.phase,"abandoned_unsent");assert.equal(mint.transactionHash,lost);
 assert.deepEqual(done.usage.map(r=>r.state),["finalized","finalized","finalized","released_unsubmitted","released_unsubmitted"]);assert.ok(!f.calls.includes("eth_sendRawTransaction"));
 // The signed bytes of an abandoned attempt must be gone before an external mint is adopted.
 const g=await fundingExternalFixture();t.after(()=>rm(g.root,{recursive:true,force:true}));let other=g.op;for(const [phase,reason] of steps){const signed=!["prepared","signing_started"].includes(phase);other=advanceCircleFundingOperation(other,{state:phase==="prepared"||phase==="abandoned_unsent"?"awaiting_mint":"mint_unknown",effects:[...other.effects.filter(x=>x.role!=="mint"),{role:"mint",phase,envelope:e,transactionHash:signed?lost:null,materialHash:signed?"6".repeat(64):null,proof:null}]},reason,Date.parse(g.op.preparedAt));await g.repo.saveFunding(other);}
 await mkdir(join(g.root,"circle-v2-evm-funding-effects"),{recursive:true,mode:0o700});await writeFile(join(g.root,"circle-v2-evm-funding-effects",`${g.op.operationId}-mint.json`),"{}",{mode:0o600});assert.equal((await invokeFundingExternal(g)).ok,false);assert.equal(g.calls.length,0);
});
test("funding V2 canonical SAFE external credit remains adoptable after recipient spends funds",async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let balanceReads=0;const original=f.publicNetwork.request.bind(f.publicNetwork);
 t.mock.method(f.publicNetwork,"request",async(...args:Parameters<typeof original>)=>{const q=JSON.parse(args[2]!);if(q.method==="eth_call"&&q.params[0].data.startsWith("0x70a08231")){balanceReads++;throw new Error("historical or current balance state unavailable after legitimate spend");}return original(...args);});
 const result=await invokeFundingExternal(f);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(balanceReads,0);const done=await f.repo.loadAny(f.op.operationId);assert.equal(done!.schemaVersion,"apn.circle-v2-evm-operation.v2");assert.equal((done as import("../../src/circle-v2-evm/funding-operation.js").CircleFundingOperationV2).externalFulfillment!.recipientCredit.amountAtomic,"509929");
});

for(const window of ["evidence","operation","message","nonce"] as const)test(`funding V2 resumes publication stopped immediately after ${window}`,async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let armed=true;
 const proto=CircleFundingExternalStore.prototype as unknown as {writeJson(path:string,value:unknown,createOnly?:boolean):Promise<void>},original=proto.writeJson;
 t.mock.method(proto,"writeJson",async function(this:typeof proto,...args:Parameters<typeof original>){await original.apply(this,args);const path=args[0];const matches=window==="evidence"?path.startsWith("circle-external-evidence/"):window==="operation"?path.startsWith("circle-external-claims/operation-"):window==="message"?path.startsWith("circle-external-claims/message-"):path.startsWith("circle-external-claims/")&&!path.includes("/operation-")&&!path.includes("/message-");if(armed&&matches){armed=false;throw Error("PUBLICATION_CRASH");}});
 assert.equal((await invokeFundingExternal(f)).ok,false);for(const row of f.op.usage)assert.equal((await new AssetUsageLedger(f.root).load(row,row.reservationId))!.state,"unknown_finality");
 assert.equal((await invokeFundingExternal(f)).ok,true);const done=await f.repo.loadAny(f.op.operationId);assert.equal(done!.state,"external_fulfilled");assert.ok(!f.calls.some(x=>/send|estimate/u.test(x)));const calls=f.calls.length;assert.equal((await invokeFundingExternal(f)).ok,true);assert.equal(f.calls.length,calls);
});
for(const tamper of ["conflicting","malformed"] as const)test(`funding V2 evidence-only ${tamper} occupancy refuses without ledger closure`,async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let evidencePath="",armed=true;
 const proto=CircleFundingExternalStore.prototype as unknown as {writeJson(path:string,value:unknown,createOnly?:boolean):Promise<void>},original=proto.writeJson;
 t.mock.method(proto,"writeJson",async function(this:typeof proto,...args:Parameters<typeof original>){await original.apply(this,args);if(armed&&args[0].startsWith("circle-external-evidence/")){armed=false;evidencePath=join(f.root,args[0]);throw Error("EVIDENCE_ONLY_CRASH");}});
 assert.equal((await invokeFundingExternal(f)).ok,false);assert.notEqual(evidencePath,"");const occupied=tamper==="conflicting"?canonicalJson({chain:143,result:"wrong canonical receipt"})+"\n":"{";await writeFile(evidencePath,occupied,{mode:0o600});
 assert.equal((await invokeFundingExternal(f)).ok,false);assert.equal(await readFile(evidencePath,"utf8"),occupied);for(const row of f.op.usage)assert.equal((await new AssetUsageLedger(f.root).load(row,row.reservationId))!.state,"unknown_finality");assert.equal((await f.repo.loadAny(f.op.operationId))!.integrityHash,f.op.integrityHash);
});

import {readFile} from "node:fs/promises";

import {block as fundingExternalBlock} from "./circle-funding-external-fixtures.js";
test("funding V2 partial claim reproof permits advancing FINALIZED and SAFE witnesses without changing stored proof",async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let armed=true;const claim=CircleFundingExternalStore.prototype.claim;
 t.mock.method(CircleFundingExternalStore.prototype,"claim",async function(this:CircleFundingExternalStore,...args:Parameters<typeof claim>){await claim.apply(this,args);if(armed){armed=false;throw Error("AFTER_ALL_CLAIMS");}});
 assert.equal((await invokeFundingExternal(f)).ok,false);const prior=await new CircleFundingExternalStore(f.root).readClaim(f.op);assert.notEqual(prior,null);
 const request=f.publicNetwork.request.bind(f.publicNetwork);t.mock.method(f.publicNetwork,"request",async(...args:Parameters<typeof request>)=>{const response=await request(...args),q=JSON.parse(args[2]!),x=JSON.parse(response.body);if(q.method==="eth_getBlockByNumber"&&["safe","finalized","0x15"].includes(q.params[0]))x.result=fundingExternalBlock(21);return {...response,body:JSON.stringify(x)};});
 assert.equal((await invokeFundingExternal(f)).ok,true);const done=await f.repo.loadAny(f.op.operationId);assert.equal(canonicalJson((done as import("../../src/circle-v2-evm/funding-operation.js").CircleFundingOperationV2).externalFulfillment),canonicalJson(prior));assert.ok(!f.calls.includes("eth_sendRawTransaction"));
});
test("funding V2 partial claim refuses changed canonical receipt identity before accounting",async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let armed=true;const claim=CircleFundingExternalStore.prototype.claim;
 t.mock.method(CircleFundingExternalStore.prototype,"claim",async function(this:CircleFundingExternalStore,...args:Parameters<typeof claim>){await claim.apply(this,args);if(armed){armed=false;throw Error("AFTER_ALL_CLAIMS");}});
 assert.equal((await invokeFundingExternal(f)).ok,false);const before=await new CircleFundingExternalStore(f.root).readClaim(f.op);(f.dest.receipt as Record<string,unknown>).effectiveGasPrice="0x121eac0";
 assert.equal((await invokeFundingExternal(f)).ok,false);assert.equal(canonicalJson(await new CircleFundingExternalStore(f.root).readClaim(f.op)),canonicalJson(before));for(const row of f.op.usage)assert.equal((await new AssetUsageLedger(f.root).load(row,row.reservationId))!.state,"unknown_finality");
});

test("funding V2 primary nonce crash fences a different operation with the same canonical message",async t=>{
 const f=await fundingExternalFixture();t.after(()=>rm(f.root,{recursive:true,force:true}));let armed=true;
 const proto=CircleFundingExternalStore.prototype as unknown as {writeJson(path:string,value:unknown,createOnly?:boolean):Promise<void>},write=proto.writeJson;
 t.mock.method(proto,"writeJson",async function(this:typeof proto,...args:Parameters<typeof write>){await write.apply(this,args);if(armed&&args[0].startsWith("circle-external-claims/")){armed=false;assert.ok(!args[0].includes("/operation-")&&!args[0].includes("/message-"));throw Error("AFTER_PRIMARY_NONCE");}});
 assert.equal((await invokeFundingExternal(f)).ok,false);const store=new CircleFundingExternalStore(f.root),prior=await store.readClaim(f.op);assert.notEqual(prior,null);
 const other=advanceCircleFundingOperation(f.op,{operationId:hashObject({differentOperation:true})},"synthetic_distinct_operation_same_message",Date.parse(f.op.preparedAt));validateCircleFundingOperation(other);
 const {proofHash:_hash,...body}={...prior!,operationId:other.operationId},different={...body,proofHash:hashObject(body)},evidence=await store.evidence(prior!);
 await assert.rejects(()=>store.claim(other,different,evidence));await assert.rejects(()=>store.assertOwnedMintAvailable(other));await assert.rejects(()=>store.assertOwnedMintAvailable(f.op));assert.equal(canonicalJson(await store.readClaim(f.op)),canonicalJson(prior));
 for(const row of f.op.usage)assert.equal((await new AssetUsageLedger(f.root).load(row,row.reservationId))!.state,"unknown_finality");assert.equal((await f.repo.loadAny(f.op.operationId))!.integrityHash,f.op.integrityHash);
 assert.equal((await invokeFundingExternal(f)).ok,true);const done=await f.repo.loadAny(f.op.operationId);assert.equal(done!.state,"external_fulfilled");assert.ok(!f.calls.some(x=>/send|estimate/u.test(x)));const calls=f.calls.length;assert.equal((await invokeFundingExternal(f)).ok,true);assert.equal(f.calls.length,calls);
});

// OWNR-14 root cause: the allowance at the burn block is proven from the approval and burn receipts. A later, unrelated
// approval of the same owner to TokenMessenger (nonzero `latest` allowance) no longer blocks adoption, and it is not read.
for (const schema of ["v1", "v2"] as const) test(`${schema} adoption ignores a later unrelated nonzero allowance and never reads it`, async t => {
  const f = schema === "v1" ? await externalFixture() : await fundingExternalFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  type Port = { request(url: string, method: string, body: string | null, ...rest: unknown[]): Promise<{ status: number; body: string }> };
  let allowanceReads = 0; const port = f.publicNetwork as unknown as Port, original = port.request.bind(port);
  t.mock.method(port, "request", async (url: string, method: string, body: string | null, ...rest: unknown[]) => {
    const response = await original(url, method, body, ...rest), q = JSON.parse(body!), x = JSON.parse(response.body), args = [url];
    if (String(args[0]).includes("arbitrum") && q.method === "eth_call" && q.params[0].data.startsWith("0xdd62ed3e")) { allowanceReads++; x.result = `0x${"0".repeat(63)}1`; }
    return { ...response, body: JSON.stringify(x) };
  });
  const result = schema === "v1" ? await invoke(f as Awaited<ReturnType<typeof externalFixture>>) : await invokeFundingExternal(f as Awaited<ReturnType<typeof fundingExternalFixture>>);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(allowanceReads, 0);
});
