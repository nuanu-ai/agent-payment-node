import assert from "node:assert/strict";
import test,{mock} from "node:test";
import {performance} from "node:perf_hooks";
let options:{totalDeadlineMs:number;abortSignal:AbortSignal},calls=0;
const actual=await import("../../src/rpc.js");
mock.module("../../src/rpc.js",{namedExports:{...actual,HttpsBaseRpc:class{
 readonly evm={balance:async()=>{calls++;return await new Promise(()=>{});},nonce:async()=>{calls++;return await new Promise(()=>{});}};
 constructor(_endpoint:string,input:typeof options){options=input;}
}}});
const {readFixedMetaMaskNativeBalances,readFixedMetaMaskNativeNonce}=await import("../../src/metamask-native-transfer-rpc.js");
for(const kind of ["balances","nonce"] as const)for(const clock of ["normal","paused"] as const)test(`static fixed ${kind} ${clock} READ has monotonic absolute aggregate deadline and aborts hung transport`,async()=>{
 const prior=process.env.APN_ETHEREUM_RPC_URL;process.env.APN_ETHEREUM_RPC_URL="https://TEST.example";
 try{const before=performance.now(),wall=Date.now(),deadline=clock==="normal"?new Date(wall+40).toISOString():Object.freeze({utcExpiresAt:new Date(wall+3000).toISOString(),monotonicDeadlineMs:before+40});if(clock==="paused")mock.timers.enable({apis:["Date"],now:wall});
 await assert.rejects(()=>kind==="balances"?readFixedMetaMaskNativeBalances(1,deadline):readFixedMetaMaskNativeNonce(1,deadline),{code:"APN_RPC_AMBIGUOUS"});
 assert.ok(options!.totalDeadlineMs>before&&options!.totalDeadlineMs<=before+45);if(typeof deadline!=="string")assert.equal(options!.totalDeadlineMs,deadline.monotonicDeadlineMs);assert.equal(options!.abortSignal.aborted,true);assert.ok(Date.now()-wall<1000);
 const count=calls;await assert.rejects(()=>readFixedMetaMaskNativeNonce(1,new Date(Date.now()-1).toISOString()));assert.equal(calls,count);
 }finally{mock.timers.reset();if(prior===undefined)delete process.env.APN_ETHEREUM_RPC_URL;else process.env.APN_ETHEREUM_RPC_URL=prior;}
});
