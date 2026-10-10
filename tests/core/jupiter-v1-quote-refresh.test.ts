import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import type { SolanaRpcPort } from "../../src/solana/rpc.js";
import { refreshJupiterV1QuoteBuild } from "../../src/swap/jupiter-solana/v1-quote-refresh.js";
import { fixture } from "../fixtures/jupiter-v1/material.js";
import { getBase58Decoder } from "@solana/kit";
import { validateJupiterV1Material, jupiterV1MaterialDigest } from "../../src/swap/jupiter-solana/v1-material.js";

function refreshed() {
 const material=fixture(),build=structuredClone(material.rawBuildResponse) as any;
 build.blockhashWithMetadata.blockhash=Array.from(Buffer.alloc(32,39));
 build.blockhashWithMetadata.lastValidBlockHeight+=150;
 build.timeTaken=0.001;build.createAtaTimeTaken=0.002;build.simulationSlot=Number(material.accountSlot)+1;
 return {material,build};
}
function reader(height:string,fee:string|null="6400") {
 const calls:string[]=[];
 const rpc:Pick<SolanaRpcPort,"call">={async call(method){calls.push(method);
  if(method==="getFeeForMessage")return {context:{slot:1},value:fee===null?null:BigInt(fee)};
  if(method==="getBlockHeight")return BigInt(height);
  throw new Error("Quote refresh attempted another RPC method");
 }};return {rpc,calls};
}
test("final unsigned official build changes lifetime and message before quote freeze, preserving every execution input",async()=>{
 const {material,build}=refreshed(),before=canonicalJson(material),r=reader(material.currentBlockHeight);
 const result=await refreshJupiterV1QuoteBuild(r.rpc,material,build);
 assert.notEqual(result.messageHash,material.messageHash);assert.notEqual(result.materialDigest,material.materialDigest);
 assert.deepEqual(result.rawInstructions,material.rawInstructions);assert.deepEqual(result.semanticAccounts,material.semanticAccounts);
 assert.deepEqual(result.programPins,material.programPins);assert.deepEqual(result.addressTables,material.addressTables);
 assert.deepEqual(result.quoteResponse,material.quoteResponse);assert.equal(result.maximumNativeExpenseLamports,"6000000");
 assert.equal(canonicalJson(material),before);assert.ok(Object.isFrozen(result));
 assert.deepEqual(r.calls,["getFeeForMessage","getBlockHeight"]);
});
for(const [name,change] of [
 ["swap bytes",(b:any)=>{const d=Buffer.from(b.swapInstruction.data,"base64");d[17]=d[17]!^1;b.swapInstruction.data=d.toString("base64");}],
 ["recipient account",(b:any)=>{b.swapInstruction.accounts[3].pubkey=b.swapInstruction.accounts[1].pubkey;}],
 ["account privilege",(b:any)=>{b.swapInstruction.accounts[3].isSigner=true;}],
 ["compute budget bytes",(b:any)=>{b.computeBudgetInstructions[0].data="AQ==";}],
 ["setup bytes",(b:any)=>{b.setupInstructions[0].data="AA==";}],
 ["lookup table",(b:any)=>{b.addressLookupTableAddresses=[];}],
 ["fee metadata",(b:any)=>{b.prioritizationFeeLamports+=1;}],
 ["compute limit",(b:any)=>{b.computeUnitLimit+=1;}],
 ["extra instruction",(b:any)=>{b.otherInstructions=[b.swapInstruction];}],
] as const)test(`unsigned refresh refuses changed ${name} before another RPC`,async()=>{
 const {material,build}=refreshed(),r=reader(material.currentBlockHeight);change(build);
 await assert.rejects(refreshJupiterV1QuoteBuild(r.rpc,material,build));assert.equal(r.calls.length,0);
});
test("unsigned refresh refuses a reduced lifetime before another RPC",async()=>{
 const {material,build}=refreshed(),r=reader(material.currentBlockHeight);build.blockhashWithMetadata.lastValidBlockHeight=Number(material.lifetime.lastValidBlockHeight)-1;
 await assert.rejects(refreshJupiterV1QuoteBuild(r.rpc,material,build));assert.equal(r.calls.length,0);
});
test("unsigned refresh still refuses an unavailable exact-message fee",async()=>{
 const {material,build}=refreshed(),r=reader(material.currentBlockHeight,null);
 await assert.rejects(refreshJupiterV1QuoteBuild(r.rpc,material,build),{code:"APN_REPREPARE_REQUIRED"});
});
test("unsigned refresh still refuses a blockhash expired during its final RPC reads",async()=>{
 const {material,build}=refreshed(),r=reader(String(build.blockhashWithMetadata.lastValidBlockHeight+1));
 await assert.rejects(refreshJupiterV1QuoteBuild(r.rpc,material,build),{code:"APN_REPREPARE_REQUIRED"});
});

function rpcLifetimeReader(material:ReturnType<typeof fixture>, remaining=150, changes:Record<string,unknown>={}) {
 const calls:string[]=[], slot=material.semanticAccounts.reduce((n,a)=>Math.max(n,Number(a.slot)),Number(material.accountSlot)), blockhash=getBase58Decoder().decode(Buffer.alloc(32,53));
 const value={blockhash,lastValidBlockHeight:BigInt(material.currentBlockHeight)+BigInt(remaining),...changes};
 const rpc:Pick<SolanaRpcPort,"call"|"originHash">={originHash:"e".repeat(64),async call(method,params){calls.push(method);
  if(method==="getLatestBlockhash"){assert.deepEqual(params,[{commitment:"confirmed",minContextSlot:slot}]);return {context:{slot:slot+1},value};}
  if(method==="getFeeForMessage")return {context:{slot:slot+1},value:6400n};
  if(method==="getBlockHeight")return BigInt(material.currentBlockHeight);
  throw Error("Unexpected pre-freeze RPC method");
 }};return {rpc,calls,blockhash,slot};
}
test("RPC lifetime is fixed before quote freeze while the complete official response and all financial bytes remain untouched",async()=>{
 const material=fixture(),before=canonicalJson(material),reader=rpcLifetimeReader(material);
 const result=await refreshJupiterV1QuoteBuild(reader.rpc,material,material.rawBuildResponse,true);
 assert.notEqual(result.messageHash,material.messageHash);assert.equal(result.lifetime.blockhash,reader.blockhash);
 assert.equal(result.quoteRpcLifetime?.source,"configured_mainnet_rpc_before_quote_freeze");assert.equal(result.quoteRpcLifetime?.rpcOriginHash,reader.rpc.originHash);
 assert.deepEqual(result.rawBuildResponse,material.rawBuildResponse);assert.equal(result.rawBuildResponseHash,material.rawBuildResponseHash);
 assert.deepEqual(result.rawInstructions,material.rawInstructions);assert.deepEqual(result.compiledAccounts,material.compiledAccounts);
 assert.deepEqual(result.semanticAccounts,material.semanticAccounts);assert.deepEqual(result.programPins,material.programPins);assert.deepEqual(result.quoteResponse,material.quoteResponse);
 assert.equal(result.maximumNativeExpenseLamports,material.maximumNativeExpenseLamports);assert.equal(canonicalJson(material),before);
 assert.equal(validateJupiterV1Material(result),result);assert.deepEqual(reader.calls,["getLatestBlockhash","getFeeForMessage","getBlockHeight"]);
 const rehashed=(changed:any)=>{const {materialDigest,...body}=changed;return {...body,materialDigest:jupiterV1MaterialDigest(body)};};
 assert.throws(()=>validateJupiterV1Material(rehashed({...result,lifetime:material.lifetime})),{code:"APN_STATE_CORRUPT"});
 assert.throws(()=>validateJupiterV1Material(rehashed({...result,quoteRpcLifetime:{...result.quoteRpcLifetime,blockhash:material.lifetime.blockhash}})),{code:"APN_STATE_CORRUPT"});
 assert.throws(()=>validateJupiterV1Material(rehashed({...result,quoteRpcLifetime:{...result.quoteRpcLifetime,source:"provider_supplied"}})),{code:"APN_STATE_CORRUPT"});
});
for(const remaining of [100,151])test(`pre-freeze configured RPC lifetime accepts the bounded ${remaining} block edge`,async()=>{
 const material=fixture(),reader=rpcLifetimeReader(material,remaining);const result=await refreshJupiterV1QuoteBuild(reader.rpc,material,material.rawBuildResponse,true);
 assert.equal(BigInt(result.lifetime.lastValidBlockHeight)-BigInt(result.currentBlockHeight),BigInt(remaining));
});
for(const remaining of [99,152,-1])test(`pre-freeze configured RPC lifetime refuses ${remaining} remaining blocks`,async()=>{
 const material=fixture(),reader=rpcLifetimeReader(material,remaining);
 await assert.rejects(refreshJupiterV1QuoteBuild(reader.rpc,material,material.rawBuildResponse,true),{code:"APN_REPREPARE_REQUIRED"});
});
test("a pre-freeze RPC blockhash from a bank older than the completed public reads refuses before fee or private entry",async()=>{
 const material=fixture(),reader=rpcLifetimeReader(material),rpc={...reader.rpc,async call(method:string,params:readonly unknown[]){if(method==="getLatestBlockhash")return {context:{slot:reader.slot-1},value:{blockhash:reader.blockhash,lastValidBlockHeight:BigInt(material.currentBlockHeight)+150n}};return await reader.rpc.call(method as never,params);}};
 await assert.rejects(refreshJupiterV1QuoteBuild(rpc,material,material.rawBuildResponse,true),{code:"APN_STATE_CORRUPT"});assert.equal(reader.calls.length,0);
});
test("configured RPC refresh still rejects changed official recipient bytes before any new lifetime read",async()=>{
 const material=fixture(),reader=rpcLifetimeReader(material),build=structuredClone(material.rawBuildResponse) as any;build.swapInstruction.accounts[3].pubkey=material.payer;
 await assert.rejects(refreshJupiterV1QuoteBuild(reader.rpc,material,build,true),{code:"APN_REPREPARE_REQUIRED"});assert.equal(reader.calls.length,0);
});
test("configured RPC lifetime rejects an unknown value field before fee reads",async()=>{
 const material=fixture(),reader=rpcLifetimeReader(material,150,{untrustedExtension:1});
 await assert.rejects(refreshJupiterV1QuoteBuild(reader.rpc,material,material.rawBuildResponse,true),{code:"APN_RPC_PROTOCOL"});assert.deepEqual(reader.calls,["getLatestBlockhash"]);
});
