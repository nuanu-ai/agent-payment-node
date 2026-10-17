import assert from "node:assert/strict";import test from "node:test";import {rm,mkdir,writeFile}from"node:fs/promises";import{join}from"node:path";
import { runCli,parseArgv } from "../../src/cli.js";import { hashObject,canonicalJson } from "../../src/canonical.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";import { circleEnvelope } from "../../src/circle-v2-evm/operation-model.js";
import { CircleExternalRpcBudget,CircleExternalRpc } from "../../src/circle-v2-evm/external-rpc.js";
import { encodeCircleMint } from "../../src/circle-v2-evm/protocol.js";import { CIRCLE_RECIPIENT } from "../../src/circle-v2-evm/catalog.js";
const command=(op:string,tx:string)=>["circle","evm","adopt-external-mint","--operation",op,"--transaction-hash",tx];
test("adoption RPC hard gates: method, exact block logs, total count, deadline",async()=>{let clock=1,calls=0;const transport={request:async(_u:unknown,_m:unknown,b:string|null)=>{calls++;const x=JSON.parse(b!);return{status:200,body:JSON.stringify({jsonrpc:"2.0",id:x.id,result:"0x1"})};}};
 const budget=new CircleExternalRpcBudget(()=>clock,100,transport as never),rpc=new CircleExternalRpc("https://rpc.example",143,budget);for(const method of ["eth_estimateGas","eth_sendRawTransaction","eth_maxPriorityFeePerGas"])await assert.rejects(rpc.call(method,[]),/budget_or_method/);assert.equal(calls,0);
 await assert.rejects(rpc.call("eth_getLogs",[{fromBlock:"0x1",toBlock:"latest"}]),/exact_block/);clock=100;await assert.rejects(rpc.call("eth_chainId",[]),/deadline/);assert.equal(calls,0);
 const b=new CircleExternalRpcBudget(()=>1,100,transport as never),a=new CircleExternalRpc("https://rpc1.example",143,b),c=new CircleExternalRpc("https://rpc2.example",42161,b);for(let i=0;i<160;i++)await(i%2?a:c).call("eth_chainId",[]);await assert.rejects(a.call("eth_chainId",[]),/budget_or_method/);assert.equal(calls,160);
});
test("finite command binds exact operation and transaction only",()=>{assert.equal(parseArgv(command("1".repeat(64),`0x${"2".repeat(64)}`)).request.command,"circle.evm.adopt-external-mint");for(const tail of [["--force"],["--profile","default"],["--transaction-hash","bad"]])assert.throws(()=>parseArgv([...command("1".repeat(64),`0x${"2".repeat(64)}`),...tail]));});
test("external proof physical concurrency and per-origin ceilings are finite",async()=>{
 let active=0,max=0,physical=0;const transport={request:async(_url:unknown,_method:unknown,body:string|null)=>{active++;max=Math.max(max,active);physical++;await new Promise<void>(r=>setImmediate(r));active--;const x=JSON.parse(body!);return{status:200,body:JSON.stringify({jsonrpc:"2.0",id:x.id,result:"0x1"})};}};
 const b=new CircleExternalRpcBudget(()=>1,100,transport as never),rpc=new CircleExternalRpc("https://rpc.example",143,b);await Promise.all(Array.from({length:16},()=>rpc.call("eth_chainId",[])));assert.equal(max,4);
 for(let i=16;i<128;i++)await rpc.call("eth_chainId",[]);await assert.rejects(rpc.call("eth_chainId",[]),/origin_budget/);assert.equal(physical,128);
});

import { fundingExternalFixture, actor } from "./circle-funding-external-fixtures.js";
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
test("v2 adoption ignores a later unrelated nonzero allowance and never reads it", async t => {
  const f = await fundingExternalFixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  type Port = { request(url: string, method: string, body: string | null, ...rest: unknown[]): Promise<{ status: number; body: string }> };
  let allowanceReads = 0; const port = f.publicNetwork as unknown as Port, original = port.request.bind(port);
  t.mock.method(port, "request", async (url: string, method: string, body: string | null, ...rest: unknown[]) => {
    const response = await original(url, method, body, ...rest), q = JSON.parse(body!), x = JSON.parse(response.body), args = [url];
    if (String(args[0]).includes("arbitrum") && q.method === "eth_call" && q.params[0].data.startsWith("0xdd62ed3e")) { allowanceReads++; x.result = `0x${"0".repeat(63)}1`; }
    return { ...response, body: JSON.stringify(x) };
  });
  const result = await invokeFundingExternal(f);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(allowanceReads, 0);
});
