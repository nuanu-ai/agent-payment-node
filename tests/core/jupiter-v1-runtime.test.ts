import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { temporaryState } from "./helpers.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { executeJupiterCommand } from "../../src/swap/jupiter-solana/command-service.js";
import type { RuntimeContext } from "../../src/runtime.js";
import { StateStore } from "../../src/state.js";
import { SolanaRpc, SolanaRpcBudget } from "../../src/solana/rpc.js";
import { JupiterV1BudgetedRpc } from "../../src/swap/jupiter-solana/v1-execution.js";
import { JupiterV1OwnerAdmission, detached } from "../../src/swap/jupiter-solana/v1-admission.js";
import { JupiterV1LocalSigner } from "../../src/swap/jupiter-solana/v1-effects.js";
import { createJupiterV1Runtime } from "../../src/swap/jupiter-solana/v1-runtime-factory.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { JUPITER_V1_WHIRLPOOL_MECHANISM_PIN as PIN } from "../../src/swap/jupiter-solana/v1-pins.js";
import { SOLANA_USDC_MINT } from "../../src/swap/jupiter-solana/catalog.js";
const payer="GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki";
const wrapping={async load(){return Buffer.alloc(32,77);},async create(){return Buffer.alloc(32,77);}};
const now=new Date();
function registry(expired=false){return sealAssetPolicyRegistry({schemaVersion:"apn.asset-policy-registry.v1",registryVersion:"jupiter-test.1",publishedAt:new Date(now.getTime()-2000).toISOString(),effectiveDate:now.toISOString().slice(0,10),effectiveAt:new Date(now.getTime()-1000).toISOString(),expiresAt:new Date(now.getTime()+(expired?-1:86400000)).toISOString(),chains:[{chain:PIN.chain,family:"solana",name:"Solana",assets:[{kind:"native",identifier:null,symbol:"SOL",decimals:9,rails:{direct:false,gasless:false,x402:false,bridge:false,swap:true},caps:{maximumPerTransferAtomic:"1000000",dailyLimitAtomic:"2000000"},mechanismPins:{swap:PIN}},{kind:"token",identifier:SOLANA_USDC_MINT,symbol:"USDC",decimals:6,rails:{direct:false,gasless:false,x402:false,bridge:false,swap:true},caps:{maximumPerTransferAtomic:"1000000",dailyLimitAtomic:"2000000"},mechanismPins:{swap:PIN}}]}]});}
test("Jupiter owner admission checks both active assets and the actual public/envelope owner without decrypting",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const store=new ChainAccountStore(temp.root,wrapping);
 await store.ensureLocal({profile:"jupiter-test",rail:"solana",create:async()=>({address:payer,seed:Buffer.alloc(32,7)})});
 let secretReads=0;const accounts={account:store.account.bind(store),ownerBinding:store.ownerBinding.bind(store)};
 const r=registry(),active={profile:"jupiter-test",registry:r,digest:r.policyDigest,revision:1,accounts:{solana:payer},activationDigest:"a".repeat(64),activatedAt:r.effectiveAt!};
 const admission=new JupiterV1OwnerAdmission(accounts,async()=>active,new AssetUsageLedger(temp.root),()=>now);
 assert.equal((await admission.resolve("jupiter-test","1000000","115550",payer)).account.address,payer);
 await assert.rejects(admission.resolve("jupiter-test","1000001","115550",payer));assert.equal(secretReads,0);
 const native=new JupiterV1LocalSigner(temp.root,{async load(){secretReads++;throw new Error("Keychain must not open");},async create(){throw new Error();}});
 assert.equal((await native.publicOwner("jupiter-test",payer)).address,payer);assert.equal(secretReads,0);
 const account=await store.account("jupiter-test","solana");assert.ok(account);
 const envelopePath=join(temp.root,"chain-wallets","solana",`${account.profileHash}.json`);const raw=JSON.parse(await readFile(envelopePath,"utf8"));raw.account.address="11111111111111111111111111111111";await writeFile(envelopePath,JSON.stringify(raw),{mode:0o600});
 await assert.rejects(native.publicOwner("jupiter-test",payer));assert.equal(secretReads,0);
});
test("Jupiter quote refuses before any network or Native secret without an active owner policy",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);let reads=0,secrets=0;
 const native=new ChainAccountStore(temp.root,wrapping);await native.ensureLocal({profile:"jupiter-test",rail:"solana",create:async()=>({address:payer,seed:Buffer.alloc(32,9)})});
 const rpc=new SolanaRpc("https://example.com",async()=>{reads++;throw new Error("network forbidden");},new SolanaRpcBudget({maxPhysicalRequests:64}));
 const runtime=createJupiterV1Runtime({state:new StateStore(temp.root),clock:{now:()=>new Date()},rpc,wrappingSecret:{async load(){secrets++;throw new Error();},async create(){throw new Error();}},foreground:false,stage:"quote",providerFetch:async()=>{reads++;throw new Error();}});
 await assert.rejects(runtime.quote({command:"swap.jupiter.quote",profile:"jupiter-test",account:payer,recipient:payer,amountAtomic:"1000000",slippageBps:50,ownerSlippageCapBps:50},new Date()),/active owner policy/);
 assert.equal(reads,0);assert.equal(secrets,0);
});
test("Jupiter persisted stage budget consumes failed RPC attempts and refuses the 65th before transport across reopen",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);let network=0;const base=new SolanaRpc("https://example.com",async()=>{network++;throw new Error("failed read");});
 const one=new JupiterV1BudgetedRpc(base,temp.root,"execute","a".repeat(64));
 for(let i=0;i<32;i++)await assert.rejects(one.call("getBlockHeight",[]));
 const two=new JupiterV1BudgetedRpc(base,temp.root,"execute","a".repeat(64));for(let i=0;i<32;i++)await assert.rejects(two.call("getBlockHeight",[]));
 await assert.rejects(two.call("getBlockHeight",[]),/cap was exhausted/);assert.equal(network,64);
});
test("Jupiter command dispatch refuses an arbitrary financial runtime injected through core dependencies",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);let forgedCalls=0;
 const context={state:new StateStore(temp.root),clock:{now:()=>new Date()},jupiterV1Runtime:{async quote(){forgedCalls++;return {paid:true};}}} as unknown as RuntimeContext;
 await assert.rejects(executeJupiterCommand({command:"swap.jupiter.quote",profile:"jupiter-test",account:payer,recipient:payer,amountAtomic:"1000000",slippageBps:50,ownerSlippageCapBps:50},context),/canonical finite V1 runtime/);assert.equal(forgedCalls,0);
});
test("Jupiter detaches and deeply freezes caller approval economics before asynchronous callbacks",()=>{
 const original={operationId:"a".repeat(64),gasOrEnergy:{maximumNativeExpenseLamports:"6000000"}},snapshot=detached(original);
 original.operationId="b".repeat(64);original.gasOrEnergy.maximumNativeExpenseLamports="9999999";
 assert.equal(snapshot.operationId,"a".repeat(64));assert.equal(snapshot.gasOrEnergy.maximumNativeExpenseLamports,"6000000");assert.throws(()=>{snapshot.gasOrEnergy.maximumNativeExpenseLamports="0";});
});

import { fixture, mutate } from "../fixtures/jupiter-v1/material.js";
import { simulation, receipt } from "../fixtures/jupiter-v1/scenarios.js";
import { getAddressEncoder, createKeyPairSignerFromPrivateKeyBytes, getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import { associatedTokenAddress } from "../../src/swap/orca-solana/accounts.js";
import { guardJupiterV1WhirlpoolMaterial } from "../../src/swap/jupiter-solana/v1-guard.js";
import { TOKEN_PROGRAM, WRAPPED_SOL_MINT } from "../../src/swap/jupiter-solana/catalog.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { allowlistDecisionFingerprint } from "../../src/allowlist-policy-activation.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { SolanaRpcPacer } from "../../src/solana/pacing.js";
import { JupiterV1ExecutionBindingStore } from "../../src/swap/jupiter-solana/v1-effects.js";
import { JupiterV1DispatchStore, jupiterV1DispatchResult } from "../../src/swap/jupiter-solana/v1-dispatch.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
async function pipelineFixture(t:test.TestContext){
 const temp=await temporaryState();t.after(temp.cleanup);const seed=Buffer.alloc(32,21),testSigner=await createKeyPairSignerFromPrivateKeyBytes(seed),owner=testSigner.address;
 const old=fixture(),source=await associatedTokenAddress(owner,WRAPPED_SOL_MINT,TOKEN_PROGRAM),destination=await associatedTokenAddress(owner,SOLANA_USDC_MINT,TOKEN_PROGRAM),oldSource=old.rawBuildResponse.swapInstruction.accounts[2]!.pubkey,oldDest=old.rawBuildResponse.swapInstruction.accounts[3]!.pubkey;
 const mapping=new Map([[old.payer,owner],[oldSource,source],[oldDest,destination]]),material=mutate(old,v=>{
  v.payer=owner;v.currentBlockHeight="1000";v.rawBuildResponse.blockhashWithMetadata.blockhash=Array.from(Buffer.alloc(32,37));v.rawBuildResponse.blockhashWithMetadata.lastValidBlockHeight=1100;v.rawBuildResponse.blockhashWithMetadata.fetchedAt={secs_since_epoch:Math.floor(Date.now()/1000),nanos_since_epoch:0};
  v.lifetime.lastValidBlockHeight="1100";
  for(const ix of [...v.rawBuildResponse.computeBudgetInstructions,...v.rawBuildResponse.setupInstructions,v.rawBuildResponse.swapInstruction,v.rawBuildResponse.cleanupInstruction])for(const a of ix.accounts)a.pubkey=mapping.get(a.pubkey)??a.pubkey;
  for(const a of v.semanticAccounts){const oldAddress=a.address;a.address=mapping.get(a.address)??a.address;if(oldAddress===oldDest){const d=Buffer.from(a.dataBase64,"base64");Buffer.from(getAddressEncoder().encode(owner)).copy(d,32);a.dataBase64=d.toString("base64");}}
 });
 // mutate() freezes raw-build lifetime independently; rederive the canonical fake lifetime from its exact bytes.
 const {jupiterV1Lifetime}=await import("../../src/swap/jupiter-solana/v1-codec.js"),{jupiterV1MaterialDigest}=await import("../../src/swap/jupiter-solana/v1-material.js");
 const {materialDigest:_digest,...body}=material,execution={...body,lifetime:jupiterV1Lifetime(body.rawBuildResponse)};const {assembleJupiterV1}=await import("../../src/swap/jupiter-solana/v1-resolver.js"),{sha256}=await import("../../src/canonical.js"),{getBase58Decoder}=await import("@solana/kit");
 const quoteRpcLifetime={source:"configured_mainnet_rpc_before_quote_freeze" as const,rpcOriginHash:sha256("https://example.com"),contextSlot:"454241651",minimumContextSlot:"454241651",blockhash:getBase58Decoder().decode(Buffer.alloc(32,38)),lastValidBlockHeight:"1100"};
 const frozen={...execution,quoteRpcLifetime,lifetime:{blockhash:quoteRpcLifetime.blockhash,lastValidBlockHeight:quoteRpcLifetime.lastValidBlockHeight},...assembleJupiterV1(execution.payer,execution.rawBuildResponse,execution.addressTables,quoteRpcLifetime)};
 const m={...frozen,materialDigest:jupiterV1MaterialDigest(frozen)};
 const guarded=await guardJupiterV1WhirlpoolMaterial(m),sim=simulation(guarded),final=receipt(guarded),store=new ChainAccountStore(temp.root,wrapping);
 await store.ensureLocal({profile:"jupiter-test",rail:"solana",create:async()=>({address:owner,seed:Buffer.from(seed)})});
 const start=new Date(),policy=new AllowlistPolicyStore(temp.root),staged=await policy.stage({profile:"jupiter-test",now:start,policy:{schemaVersion:"apn.allowlist-policy-file.v1",overlayVersion:"jupiter-runtime.1",accounts:{solana:owner},effectiveAt:new Date(start.getTime()-1000).toISOString(),expiresAt:new Date(start.getTime()+86400000).toISOString(),admissions:[{chain:PIN.chain,kind:"native",rail:"swap",maximumPerTransferAtomic:"1000000",dailyLimitAtomic:"2000000",mechanism:PIN},{chain:PIN.chain,kind:"token",identifier:SOLANA_USDC_MINT,rail:"swap",maximumPerTransferAtomic:"1000000",dailyLimitAtomic:"2000000",mechanism:PIN}]}});
 const activation=await policy.appendDecision("jupiter-test",null,{status:"active",revision:staged.revision,stagedRecordDigest:staged.recordDigest,policyDigest:staged.registry.policyDigest,registry:staged.registry,approvalFingerprint:allowlistDecisionFingerprint({action:"activate",profileHash:allowlistProfileHash("jupiter-test"),revision:staged.revision,stagedRecordDigest:staged.recordDigest,policyDigest:staged.registry.policyDigest,headEntryDigest:null}),decidedAt:start.toISOString()});
 let clockMs=Date.now(),sends=0,rawSigned:string|null=null,signature:string|null=null,finalized=false,height=1000,secretReads=0,ambiguous=false,rejected=false,revokeWrapping=false,revokeAfterSign=false,lastWrappingKey:Buffer|null=null;
 async function revokePolicy(){await policy.appendDecision("jupiter-test",activation.entryDigest,{status:"revoked",revision:staged.revision,stagedRecordDigest:staged.recordDigest,policyDigest:staged.registry.policyDigest,approvalFingerprint:allowlistDecisionFingerprint({action:"revoke",profileHash:allowlistProfileHash("jupiter-test"),revision:staged.revision,stagedRecordDigest:staged.recordDigest,policyDigest:staged.registry.policyDigest,headEntryDigest:activation.entryDigest}),decidedAt:new Date().toISOString()});}
 const rpcFetch:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));const handle=async(request:any)=>{const keys=request.params?.[0];let result:unknown;
  switch(request.method){case"getGenesisHash":result=m.genesis;break;case"getMultipleAccounts":result={context:{slot:454241651},value:keys.map((key:string)=>accountWire(key,request.params[1]?.dataSlice))};break;
  case"getAccountInfo":result={context:{slot:454241651},value:accountWire(keys,request.params[1]?.dataSlice)};break;
  case"getLatestBlockhash":result={context:{slot:454241651},value:{blockhash:m.lifetime.blockhash,lastValidBlockHeight:1100}};break;
  case"getFeeForMessage":result={context:{slot:454241651},value:6400};break;case"getBlockHeight":if(revokeAfterSign&&secretReads>0){revokeAfterSign=false;await revokePolicy();}result=height;break;case"getMinimumBalanceForRentExemption":result=1488440;break;
  case"simulateTransaction":assert.equal(keys,m.transactionBase64);result=sim;break;
  case"sendTransaction":sends++;assert.equal(request.params[1].maxRetries,0);rawSigned=keys;signature=getSignatureFromTransaction(getTransactionDecoder().decode(Buffer.from(keys,"base64")));if(ambiguous)throw new Error("transport lost after dispatch");if(rejected)return {jsonrpc:"2.0",id:request.id,error:{code:-32002,message:"SECRET provider echo",data:{err:"BlockhashNotFound",logs:[keys]}}};result=signature;break;
  case"getSignatureStatuses":assert.equal(keys[0],signature);result=finalized?final.status:{context:{slot:454241800},value:[null]};break;
  case"getTransaction":result={...final.response,transaction:[rawSigned,"base64"]};break;
  default:throw new Error(`unexpected ${request.method}`);}
  return {jsonrpc:"2.0",id:request.id,result};};
  const response=Array.isArray(body)?await Promise.all(body.map(handle)):await handle(body);
  return new Response(JSON.stringify(response),{headers:{"content-type":"application/json"}});
 };
 function accountWire(key:string,slice?:{offset:number;length:number}){const a=m.semanticAccounts.find(a=>a.address===key);if(a===undefined||a.existence==="absent")return null;const bytes=Buffer.from(a.dataBase64,"base64");return {owner:a.owner,lamports:Number(a.lamports),executable:a.executable,data:[(slice===undefined?bytes:bytes.subarray(slice.offset,slice.offset+slice.length)).toString("base64"),"base64"],space:bytes.length,rentEpoch:0};}
 const providerFetch:typeof fetch=async url=>new Response(JSON.stringify(String(url).includes("/quote?")?m.quoteResponse:m.rawBuildResponse),{headers:{"content-type":"application/json"}});
 let dateOverride:Date|undefined;
 const state=new StateStore(temp.root),clock={now:()=>dateOverride??new Date()};
 function runtime(stage:"quote"|"prepare"|"execute"|"observe",op?:string,foreground=true){const base=new SolanaRpc("https://example.com",rpcFetch,new SolanaRpcBudget({maxPhysicalRequests:64,minimumIntervalMs:750,now:()=>clockMs,wait:async ms=>{clockMs+=ms;}}),new SolanaRpcPacer(state,()=>clockMs,async ms=>{clockMs+=ms;}));return createJupiterV1Runtime({state,clock,rpc:base,wrappingSecret:{async load(){secretReads++;const key=Buffer.alloc(32,77);lastWrappingKey=key;if(revokeWrapping){revokeWrapping=false;await revokePolicy();}return key;},async create(){return Buffer.alloc(32,77);}},foreground,stage,...(op===undefined?{}:{operationId:op}),providerFetch});}
 return{temp,owner,m,runtime,setNow(v:Date){dateOverride=v;},get sends(){return sends;},get secretReads(){return secretReads;},setFinal(){finalized=true;},setHeight(v:number){height=v;},ambiguousSend(){ambiguous=true;},rejectSend(){rejected=true;},revokeWhileWrapping(){revokeWrapping=true;},revokeAtSenderHeight(){revokeAfterSign=true;},get lastWrappingKey(){return lastWrappingKey;}};
}
test("V1 genuine Native pipeline prepares unsigned, prompts exact TTY, sends once, reopens observation and charges usage once",async t=>{
 if(process.env.APN_JUPITER_V1_TEST_PTY_CHILD!=="1"){await runPtyTest("V1 genuine Native pipeline prepares unsigned, prompts exact TTY, sends once, reopens observation and charges usage once");return;}
 assert.equal(process.stdin.isTTY,true);assert.equal(process.stderr.isTTY,true);
 process.stdout.write("PTY_CASE_ENTERED:V1 genuine Native pipeline prepares unsigned, prompts exact TTY, sends once, reopens observation and charges usage once\n");
 // Initial signing must access its seed only through withSeed, never decrypt via an effect getter.
 const forbiddenGetter=t.mock.method(ChainAccountStore.prototype,"effect",async()=>{throw new Error("Initial Jupiter signing must not decrypt through effect()");});
 const f=await pipelineFixture(t),q=await f.runtime("quote").quote({command:"swap.jupiter.quote",profile:"jupiter-test",account:f.owner,recipient:f.owner,amountAtomic:"1000000",slippageBps:50,ownerSlippageCapBps:50},new Date()) as {quoteHash:string};
 const op=await f.runtime("prepare").prepare({profile:"jupiter-test",quoteHash:q.quoteHash,idempotencyKey:"jupiter-v1-pipeline"},new Date());assert.equal(op.state,"awaiting_approval");assert.equal(f.sends,0);assert.equal(f.secretReads,0);
 await assert.rejects(f.runtime("execute",op.operationId,false).approve(op.operationId,new Date()),/foreground terminal/);assert.equal(f.secretReads,0);
 const result=await f.runtime("execute",op.operationId).approveAndExecute(op.operationId,new Date());assert.ok(["submitted","unknown_finality"].includes(result.state));assert.equal(f.sends,1);assert.equal(forbiddenGetter.mock.callCount(),0);
 assert.equal((await new JupiterV1DispatchStore(f.temp.root).load(result))?.outcome,"acknowledged");
 f.setFinal();const finalized=await f.runtime("observe",op.operationId,false).status(op.operationId,new Date());assert.equal(finalized.state,"finalized");const secrets=f.secretReads;
 const again=await f.runtime("execute",op.operationId).execute(op.operationId,new Date());assert.equal(again.state,"finalized");assert.equal(f.sends,1);assert.equal(f.secretReads,secrets);assert.equal(forbiddenGetter.mock.callCount(),0);
 const usage=await new AssetUsageLedger(f.temp.root).usage({account:f.owner,chain:PIN.chain,asset:{kind:"native",identifier:null}},new Date());assert.equal(usage.amountAtomic,"1000000");
});

async function preparedPipeline(f:Awaited<ReturnType<typeof pipelineFixture>>,key:string){const q=await f.runtime("quote").quote({command:"swap.jupiter.quote",profile:"jupiter-test",account:f.owner,recipient:f.owner,amountAtomic:"1000000",slippageBps:50,ownerSlippageCapBps:50},new Date()) as {quoteHash:string};return await f.runtime("prepare").prepare({profile:"jupiter-test",quoteHash:q.quoteHash,idempotencyKey:key},new Date());}
test("V1 ambiguous dispatch retains the same signature and cannot resend across reopen",async t=>{
 if(process.env.APN_JUPITER_V1_TEST_PTY_CHILD!=="1"){await runPtyTest("V1 ambiguous dispatch retains the same signature and cannot resend across reopen");return;}
 assert.equal(process.stdin.isTTY,true);assert.equal(process.stderr.isTTY,true);
 process.stdout.write("PTY_CASE_ENTERED:V1 ambiguous dispatch retains the same signature and cannot resend across reopen\n");
 const f=await pipelineFixture(t),op=await preparedPipeline(f,"jupiter-v1-ambiguous");f.ambiguousSend();
 const result=await f.runtime("execute",op.operationId).approveAndExecute(op.operationId,new Date());assert.equal(result.state,"unknown_finality");assert.equal(f.sends,1);const secrets=f.secretReads;
 const observation=await new JupiterV1DispatchStore(f.temp.root).load(result);assert.equal(observation?.errorCode,"APN_RPC_AMBIGUOUS");assert.equal(observation?.outcome,"error");assert.equal(observation?.rpcErrorCode,null);
 f.setNow(new Date(Date.parse(op.quote.expiresAt)+1));
 await f.runtime("execute",op.operationId).execute(op.operationId,new Date());assert.equal(f.sends,1);assert.equal(f.secretReads,secrets);
 f.setFinal();assert.equal((await f.runtime("observe",op.operationId,false).status(op.operationId,new Date())).state,"finalized");assert.equal(f.sends,1);
});
test("V1 RPC rejection is durable public diagnosis and never finalizes or retries a marked operation",async t=>{
 const title="V1 RPC rejection is durable public diagnosis and never finalizes or retries a marked operation";
 if(process.env.APN_JUPITER_V1_TEST_PTY_CHILD!=="1"){await runPtyTest(title);return;}
 assert.equal(process.stdin.isTTY,true);assert.equal(process.stderr.isTTY,true);process.stdout.write(`PTY_CASE_ENTERED:${title}\n`);
 const f=await pipelineFixture(t),op=await preparedPipeline(f,"jupiter-v1-rpc-rejection");f.rejectSend();
 const result=await f.runtime("execute",op.operationId).approveAndExecute(op.operationId,new Date());
 assert.equal(result.state,"unknown_finality");assert.equal(result.usageLease?.state,"unknown_finality");assert.equal(f.sends,1);
 const store=new JupiterV1DispatchStore(f.temp.root),observation=await store.load(result);assert.ok(observation);
 assert.equal(observation.errorCode,"APN_RPC_PROTOCOL");assert.equal(observation.rpcErrorCode,-32002);assert.equal(observation.rpcErrorReason,"blockhash_not_found");
 const raw=await readFile(join(f.temp.root,"jupiter-v1-dispatch",result.ownerProfileHash,`${result.operationId}.json`),"utf8");
 assert.doesNotMatch(raw,/SECRET|provider echo|rawPayload|transactionBase64|logs/u);
 const secrets=f.secretReads,context={state:new StateStore(f.temp.root),clock:{now:()=>new Date()},jupiterV1Runtime:f.runtime("observe",op.operationId,false)} as unknown as RuntimeContext;
 const status=await executeJupiterCommand({command:"swap.jupiter.status",operationId:op.operationId},context);
 assert.deepEqual(status.data,{dispatchObservation:observation});assert.equal(status.proofClass,"unknown_finality");
 f.setNow(new Date(Date.parse(op.quote.expiresAt)+1));await f.runtime("execute",op.operationId).execute(op.operationId,new Date());
 assert.equal(f.sends,1);assert.equal(f.secretReads,secrets);assert.deepEqual(await new JupiterV1DispatchStore(f.temp.root).load(result),observation);
 const {recordHash:_hash,...body}=observation,changed={...body,claimHash:"0".repeat(64)};
 await writeFile(join(f.temp.root,"jupiter-v1-dispatch",result.ownerProfileHash,`${result.operationId}.json`),canonicalJson({...changed,recordHash:domainHash(observation.schemaVersion,canonicalJson(changed))}),{mode:0o600});
 await assert.rejects(new JupiterV1DispatchStore(f.temp.root).load(result),{code:"APN_STATE_CORRUPT"});assert.equal(f.sends,1);
});
test("V1 dispatch diagnosis drops untrusted details and bounds every numeric field",()=>{
 const result=jupiterV1DispatchResult("error",new ApnError("APN_RPC_PROTOCOL","SECRET",{rpcErrorCode:Infinity,rpcErrorReason:"SECRET",httpStatus:600,retryAfterMs:86400001,secret:"SECRET"}));
 assert.deepEqual(result,{outcome:"error",errorCode:"APN_RPC_PROTOCOL",rpcErrorCode:null,rpcErrorReason:null,httpStatus:null,retryAfterMs:null});
 assert.equal(jupiterV1DispatchResult("error",new Error("SECRET")).errorCode,"APN_INTERNAL");
});
test("V1 frozen expired blockhash refuses before the effect marker, decryption or send",async t=>{
 if(process.env.APN_JUPITER_V1_TEST_PTY_CHILD!=="1"){await runPtyTest("V1 frozen expired blockhash refuses before the effect marker, decryption or send");return;}
 assert.equal(process.stdin.isTTY,true);assert.equal(process.stderr.isTTY,true);
 process.stdout.write("PTY_CASE_ENTERED:V1 frozen expired blockhash refuses before the effect marker, decryption or send\n");
 const f=await pipelineFixture(t),op=await preparedPipeline(f,"jupiter-v1-expired");f.setHeight(1101);
 await assert.rejects(f.runtime("execute",op.operationId).approveAndExecute(op.operationId,new Date()),/expired/);assert.equal(f.sends,0);assert.equal(f.secretReads,0);
 const saved=await new (await import("../../src/swap/repository.js")).SwapOperationRepository(f.temp.root).loadAny(op.operationId);assert.equal(saved?.submissionMarker,null);
 f.setNow(new Date(Date.parse(op.quote.expiresAt)+1));
 const released=await f.runtime("observe",op.operationId,false).status(op.operationId,new Date());
 assert.equal(released.state,"failed_before_effect");assert.equal(released.usageLease?.state,"failed_before_effect");assert.equal(released.submissionMarker,null);
 assert.equal(f.sends,0);assert.equal(f.secretReads,0);
 assert.equal((await new AssetUsageLedger(f.temp.root).usage({account:f.owner,chain:PIN.chain,asset:{kind:"native",identifier:null}},new Date())).amountAtomic,"0");
});
test("V1 duplicate foreground execution races leave one signature and one send",async t=>{
 if(process.env.APN_JUPITER_V1_TEST_PTY_CHILD!=="1"){await runPtyTest("V1 duplicate foreground execution races leave one signature and one send");return;}
 assert.equal(process.stdin.isTTY,true);assert.equal(process.stderr.isTTY,true);
 process.stdout.write("PTY_CASE_ENTERED:V1 duplicate foreground execution races leave one signature and one send\n");
 const f=await pipelineFixture(t),op=await preparedPipeline(f,"jupiter-v1-concurrent"),outcomes=await Promise.allSettled([f.runtime("execute",op.operationId).approveAndExecute(op.operationId,new Date()),f.runtime("execute",op.operationId).approveAndExecute(op.operationId,new Date())]);
 assert.ok(outcomes.some(x=>x.status==="fulfilled"));assert.equal(f.sends,1);const before=f.secretReads;await f.runtime("observe",op.operationId,false).status(op.operationId,new Date());assert.equal(f.sends,1);assert.equal(f.secretReads,before);
});
test("V1 policy revocation while loading wrapping key zeroizes it before decrypt and keeps the marker observe-only",async t=>{
 const title="V1 policy revocation while loading wrapping key zeroizes it before decrypt and keeps the marker observe-only";
 if(process.env.APN_JUPITER_V1_TEST_PTY_CHILD!=="1"){await runPtyTest(title);return;}
 assert.equal(process.stdin.isTTY,true);assert.equal(process.stderr.isTTY,true);process.stdout.write(`PTY_CASE_ENTERED:${title}\n`);
 const f=await pipelineFixture(t),op=await preparedPipeline(f,"jupiter-v1-wrapping-revoke");f.revokeWhileWrapping();
 const result=await f.runtime("execute",op.operationId).approveAndExecute(op.operationId,new Date());assert.equal(result.state,"unknown_finality");assert.ok(result.submissionMarker);assert.equal(f.sends,0);assert.equal(f.secretReads,1);assert.ok(f.lastWrappingKey);assert.ok(f.lastWrappingKey.every(byte=>byte===0));
 const secrets=f.secretReads;await f.runtime("execute",op.operationId).execute(op.operationId,new Date());assert.equal(f.sends,0);assert.equal(f.secretReads,secrets);
});
test("V1 sealed signature before transport remains observe-only after pre-send policy revocation",async t=>{
 const title="V1 sealed signature before transport remains observe-only after pre-send policy revocation";
 if(process.env.APN_JUPITER_V1_TEST_PTY_CHILD!=="1"){await runPtyTest(title);return;}
 assert.equal(process.stdin.isTTY,true);assert.equal(process.stderr.isTTY,true);process.stdout.write(`PTY_CASE_ENTERED:${title}\n`);
 const f=await pipelineFixture(t),op=await preparedPipeline(f,"jupiter-v1-sealed-before-send");f.revokeAtSenderHeight();
 const result=await f.runtime("execute",op.operationId).approveAndExecute(op.operationId,new Date());assert.equal(result.state,"unknown_finality");assert.equal(f.sends,0);assert.ok(f.secretReads>0);
 const bindings=new JupiterV1ExecutionBindingStore(f.temp.root),material=await new (await import("../../src/swap/jupiter-solana/v1-material.js")).SavedJupiterV1MaterialStore(f.temp.root).load(op.quote.quoteHash);assert.ok(material);const binding=await bindings.load(result,material);assert.ok(binding);assert.ok(await bindings.loadSignature(result,binding));assert.equal(await bindings.loadClaim(result),null);
 const secrets=f.secretReads;await f.runtime("execute",op.operationId).execute(op.operationId,new Date());assert.equal(f.sends,0);assert.equal(f.secretReads,secrets);
});
test("V1 observation cap persists for the same operation across status process reopen",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);let network=0;const base=new SolanaRpc("https://example.com",async()=>{network++;throw new Error("not found");});
 for(let i=0;i<64;i++)await assert.rejects(new JupiterV1BudgetedRpc(base,temp.root,"observe","f".repeat(64)).call("getSignatureStatuses",[]));
 await assert.rejects(new JupiterV1BudgetedRpc(base,temp.root,"observe","f".repeat(64)).call("getSignatureStatuses",[]),/cap was exhausted/);assert.equal(network,64);
});

/** Genuine process PTY, automatically fed only for this fixture's generated TEST seed and temporary state. */
async function runPtyTest(title:string):Promise<void>{
 const python=String.raw`import os,pty,select,subprocess,sys,re,time
master,slave=pty.openpty()
def session():
 os.setsid()
 import fcntl,termios
 fcntl.ioctl(slave,termios.TIOCSCTTY,0)
env=dict(os.environ);env.pop('NODE_TEST_CONTEXT',None);env['APN_JUPITER_V1_TEST_PTY_CHILD']='1'
child=subprocess.Popen([sys.argv[1],'--test','--test-isolation=none','--test-concurrency=1','--test-name-pattern','^'+sys.argv[3]+'$',sys.argv[2]],stdin=slave,stdout=slave,stderr=slave,env=env,preexec_fn=session)
os.close(slave);output=b'';pending=b'';deadline=time.time()+90
while time.time()<deadline:
 ready,_,_=select.select([master],[],[],.1)
 if ready:
  try:chunk=os.read(master,65536)
  except OSError:break
  if not chunk:break
  output+=chunk;pending+=chunk
  while True:
   match=re.search(rb'Type ([^\r\n]+) and press Enter to confirm\.',pending)
   if not match:break
   os.write(master,match.group(1)+b'\n');pending=pending[match.end():]
 if child.poll() is not None and not ready:break
else:
 child.kill()
os.close(master);child.wait();sys.stdout.buffer.write(output);sys.exit(child.returncode)
`;
 await new Promise<void>((resolve,reject)=>{const child=spawn("python3",["-c",python,process.execPath,fileURLToPath(import.meta.url),title],{env:process.env,stdio:["ignore","pipe","pipe"]});let output="";child.stdout.on("data",b=>{output+=String(b);});child.stderr.on("data",b=>{output+=String(b);});child.on("error",reject);child.on("exit",code=>{if(code===0&&output.includes(`PTY_CASE_ENTERED:${title}`)){process.stdout.write(`Verified genuine TEST-key PTY: ${title}\n`);resolve();}else reject(new Error(`Genuine TEST-key PTY case failed (${code}): ${output}`));});});
}
