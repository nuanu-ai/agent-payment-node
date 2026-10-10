import assert from "node:assert/strict";
import test from "node:test";
import { SolanaRpc } from "../../src/solana/rpc.js";
import { guardJupiterV1WhirlpoolMaterial, jupiterV1ProofRoles } from "../../src/swap/jupiter-solana/v1-guard.js";
import { proveJupiterV1Simulation } from "../../src/swap/jupiter-solana/v1-proof.js";
import { liveSimulationCapture } from "../fixtures/jupiter-v1-live-simulation-83/capture.js";
const capture=liveSimulationCapture(),g=await guardJupiterV1WhirlpoolMaterial(capture.material),keys=g.material.compiledAccounts.map(a=>a.address),roles=jupiterV1ProofRoles(g);
const run=(response:any)=>proveJupiterV1Simulation({async call(method,params){assert.equal(method,"simulateTransaction");assert.equal(params[0],g.material.transactionBase64);return response;}},g);
test("unmodified unsigned mainnet simulation proves coherent deltas despite earlier changing pool balances",async()=>{
 assert.equal(g.material.accountSlot,"454306430");assert.equal(capture.simulation.context.slot,454306483n);
 const proof=await run(capture.simulation);assert.equal(proof.recipientOutputAtomic,"116253");assert.equal(proof.nativeSpendLamports,"1006400");
 assert.equal(proof.success,true);
});
test("actual RPC JSON parser preserves captured integers and all three instruction encodings without live HTTP",async()=>{
 const rpc=new SolanaRpc("https://rpc.example",async(_url,init)=>{
  const q=JSON.parse(init!.body as string);assert.equal(q.method,"simulateTransaction");
  const result=JSON.stringify(capture.simulation,(_,v)=>typeof v==="bigint"?{$integer:v.toString()}:v).replace(/\{"\$integer":"([0-9]+)"\}/gu,"$1");
  return new Response(`{"jsonrpc":"2.0","id":"${q.id}","result":${result}}`,{headers:{"content-type":"application/json"}});
 });
 assert.equal((await proveJupiterV1Simulation(rpc,g)).resultHash,(await run(capture.simulation)).resultHash);
});
const cases:Record<string,(v:any)=>void>={};
for(const field of ["preBalances","postBalances","preTokenBalances","postTokenBalances"])cases[`missing ${field}`]=v=>{delete v.value[field];};
cases["absent coherent evidence cannot prove stale snapshot deltas"]=v=>{for(const field of ["preBalances","postBalances","preTokenBalances","postTokenBalances"])delete v.value[field];};
for(const field of ["preTokenBalances","postTokenBalances"]){
 cases[`${field} duplicate`]=v=>{v.value[field].push(v.value[field][0]);};
 cases[`${field} unknown account`]=v=>{v.value[field][0].accountIndex=1000n;};
 for(const key of [g.destinationTokenAccount,roles.vaultA,roles.vaultB]){
  const row=(v:any)=>v.value[field].find((r:any)=>r.accountIndex===BigInt(keys.indexOf(key)));
  cases[`${field} missing ${key}`]=v=>{v.value[field]=v.value[field].filter((r:any)=>r.accountIndex!==BigInt(keys.indexOf(key)));};
  cases[`${field} amount ${key}`]=v=>{row(v).uiTokenAmount.amount=(BigInt(row(v).uiTokenAmount.amount)+1n).toString();};
  cases[`${field} mint ${key}`]=v=>{row(v).mint=g.payer;};
  cases[`${field} owner ${key}`]=v=>{row(v).owner=g.sourceTokenAccount;};
  cases[`${field} decimals ${key}`]=v=>{row(v).uiTokenAmount.decimals=18n;};
  cases[`${field} token program ${key}`]=v=>{row(v).programId=g.pool;};
  cases[`${field} unknown field ${key}`]=v=>{row(v).ownerProven=true;};
 }
}
for(const [i,key] of keys.entries())cases[`post lamports disagree ${key}`]=v=>{v.value.postBalances[i]+=1n;};
for(const key of [g.payer,g.pool,roles.vaultA,roles.vaultB,g.sourceTokenAccount])cases[`pre lamports altered ${key}`]=v=>{v.value.preBalances[keys.indexOf(key)]+=1n;};
cases["WSOL pre-token existence changed"]=v=>{v.value.preTokenBalances.push({...v.value.preTokenBalances[1],accountIndex:BigInt(keys.indexOf(g.sourceTokenAccount)),owner:g.payer});};
cases["WSOL post-token not closed"]=v=>{v.value.postTokenBalances.push({...v.value.postTokenBalances[1],accountIndex:BigInt(keys.indexOf(g.sourceTokenAccount)),owner:g.payer});};
for(const offset of [0,35,44,45,46,81])cases[`read-only USDC mint identity byte ${offset}`]=v=>{
 const i=keys.indexOf("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),account=v.value.accounts[i],data=Buffer.from(account.data[0],"base64");
 data[offset]=data[offset]!^1;account.data[0]=data.toString("base64");
};
const instructions=(v:any)=>v.value.innerInstructions.flatMap((group:any)=>group.instructions);
for(let i=0;i<8;i++){
 cases[`CPI ${i} unknown key`]=v=>{instructions(v)[i].proofTrusted=true;};
 cases[`CPI ${i} mixed encoding`]=v=>{instructions(v)[i].programIdIndex=0n;};
 cases[`CPI ${i} missing program`]=v=>{delete instructions(v)[i].programId;};
 cases[`CPI ${i} stack changed`]=v=>{instructions(v)[i].stackHeight=8n;};
}
cases["parsed account data extensions changed"]=v=>{instructions(v)[0].parsed.info.extensionTypes=["transferFeeConfig"];};
cases["parsed system rent changed"]=v=>{instructions(v)[1].parsed.info.lamports+=1n;};
cases["parsed system allocation changed"]=v=>{instructions(v)[1].parsed.info.space=166n;};
cases["parsed system owner changed"]=v=>{instructions(v)[1].parsed.info.owner=g.payer;};
cases["parsed immutable owner account changed"]=v=>{instructions(v)[2].parsed.info.account=g.destinationTokenAccount;};
cases["parsed initialize authority changed"]=v=>{instructions(v)[3].parsed.info.owner=g.pool;};
cases["partially decoded native roles changed"]=v=>{instructions(v)[4].accounts.reverse();};
cases["partially decoded unknown account"]=v=>{instructions(v)[4].accounts[0]="11111111111111111111111111111112";};
for(const i of [5,6]){
 for(const amount of ["-1","01","18446744073709551616",1000000n])cases[`parsed transfer ${i} invalid amount ${String(amount)}`]=v=>{instructions(v)[i].parsed.info.amount=amount;};
 cases[`parsed transfer ${i} wrong authority`]=v=>{instructions(v)[i].parsed.info.authority=g.sourceTokenAccount;};
 cases[`parsed transfer ${i} wrong destination`]=v=>{instructions(v)[i].parsed.info.destination=g.pool;};
 cases[`parsed transfer ${i} unknown info`]=v=>{instructions(v)[i].parsed.info.ownerApproved=true;};
 cases[`parsed transfer ${i} wrong program label`]=v=>{instructions(v)[i].program="spl-token-2022";};
 cases[`parsed transfer ${i} wrong type`]=v=>{instructions(v)[i].parsed.type="approve";};
}
cases["self event wrong account"]=v=>{instructions(v)[7].accounts=[g.payer];};
for(const [name,change] of Object.entries(cases))test(`captured unsigned simulation refuses ${name}`,async()=>{
 const response=structuredClone(capture.simulation);change(response);let afterProof=0;
 await assert.rejects(async()=>{await run(response);afterProof++;});assert.equal(afterProof,0);
});
