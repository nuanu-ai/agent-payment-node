import assert from "node:assert/strict";
import { mock } from "node:test";
import { circleHex } from "../../src/circle-v2-evm/protocol.js";
/** Standalone real PTY normal service driver. Restoration is an explicit TEST port, NOT
 * a production Buyer cryptographic positive. Full wire crypto and custody refusal are separate. */
let proofModule:typeof import("../../src/circle-v2-evm/cleanup85-public-proof.js");
mock.module("../../src/circle-v2-evm/cleanup85-public-proof.js",{namedExports:{
  verifyCleanup85PublicWire:(...a:Parameters<typeof proofModule.verifyCleanup85PublicWire>)=>proofModule.verifyCleanup85PublicWire(...a),cleanup85Reanchor:(...a:Parameters<typeof proofModule.cleanup85Reanchor>)=>proofModule.cleanup85Reanchor(...a),assertCancellationProofShape:(...a:Parameters<typeof proofModule.assertCancellationProofShape>)=>proofModule.assertCancellationProofShape(...a),
  verifyCancellationPublic:async(source:import("../../src/circle-v2-evm/rpc.js").CircleRpc,proof:import("../../src/circle-cleanup85-cancellation-contract.js").Cleanup85CancellationProof)=> {
    await proofModule.cleanup85Reanchor(source,proof.observation);const fresh=await source.observation(circleHex(proof.transactionHash,32),"finalized");assert.ok(fresh);await proofModule.cleanup85Reanchor(source,fresh);return fresh;
  }
}});
proofModule=await import(new URL("../../src/circle-v2-evm/cleanup85-public-proof.js?source19-driver-original",import.meta.url).href);
const {temporaryState}=await import("./helpers.js"),{firstDispatchFixture}=await import("./cleanup86-first-dispatch-fixture.js"),{CircleEvmService}=await import("../../src/circle-v2-evm/runtime.js"),{Cleanup86Custody}=await import("../../src/circle-v2-evm/cleanup86-custody.js");
const temp=await temporaryState();try {
  const f=await firstDispatchFixture(temp.root);f.setClock(Date.now());await f.renew();let restores=0,sends=0;const timings:Record<string,string>={start:new Date().toISOString()};const rows:{endpoint:string;method:string;phase:string;at:string}[]=[];
  mock.method(Cleanup86Custody.prototype,"restoreFirstDispatch",async()=>{restores++;timings.restoreEntered=new Date().toISOString();return f.material;});
  const https:typeof f.transport.https={request:async(url,method,body,...rest)=>{
    const r=JSON.parse(body!);rows.push({endpoint:url,method:r.method,phase:restores===0?"before_restore":"after_restore",at:new Date().toISOString()});let value:unknown;
    if(r.method==="eth_getBlockByNumber"&&r.params[0]==="finalized"&&!url.includes("sei"))value=f.transport.snapshot.archiveAnchor;
    else if(r.method==="eth_getTransactionCount")value="0x56";
    else if(r.method==="eth_getBalance")value="0xffffffffffff";
    else if(r.method==="eth_call"&&String(r.params[0].data).startsWith("0x095ea7b3"))value="0x"+"0".repeat(63)+"1";
    else if(["eth_getTransactionByHash","eth_getTransactionReceipt"].includes(r.method)&&r.params[0]===f.proof.transactionHash)value=r.method==="eth_getTransactionByHash"?f.proof.observation.transaction:f.proof.observation.receipt;
    else if(r.method==="eth_sendRawTransaction"){timings.networkDispatch=new Date().toISOString();sends++;assert.equal(r.params[0],f.material.rawTransaction);value=f.material.transactionHash;}
    if(value!==undefined)return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:r.id,result:value})};return f.transport.https.request(url,method,body,...rest);
  }};
  const service=new CircleEvmService(f.state,{load:async()=>{throw Error("TEST no key access");},create:async()=>{throw Error("TEST no key creation");}},{APN_ARBITRUM_RPC_URL:"https://arbitrum-one-public.nodies.app",APN_SEI_RPC_URL:"https://evm-rpc.sei-apis.com",APN_ARBITRUM_ARCHIVE_MIN_INTERVAL_MS:"500"},()=>Date.now(),{},https,{cancellation:{inspect:async()=>({operationId:f.proof.operationId,phase:"finalized",transactionHash:f.proof.transactionHash,proof:f.proof}),execute:async()=>{throw Error("forbidden");}},verifyCancellationAccounting:async()=>{}});
  assert.ok(Date.now()>Date.parse(f.intent.currentPurpose!.windowEndsAt!));
  await service.approveCleanup86(f.parent.operationId);assert.deepEqual([restores,sends],[1,1]);
  const {readFile}=await import("node:fs/promises"),anchor=JSON.parse(await readFile(`${f.prefix}first-dispatch-anchor.json`,"utf8"));
  assert.ok(anchor.purpose.policies.every((p:{profile:string;activationDigest:string})=>p.activationDigest!==f.intent.currentPurpose!.policies.find(old=>old.profile===p.profile)!.activationDigest));
  assert.ok(Date.parse(anchor.purpose.windowEndsAt)-Date.parse(anchor.purpose.capturedAt)<=60_000);
  timings.finished=new Date().toISOString();timings.windowStart=anchor.purpose.capturedAt;timings.windowEnd=anchor.purpose.windowEndsAt;
  const {lstat}=await import("node:fs/promises");timings.globalSendFileMtime=new Date((await lstat(`${f.prefix}send.json`)).mtimeMs).toISOString();
  const counts=rows.reduce<Record<string,number>>((a,r)=>(a[r.endpoint]=(a[r.endpoint]??0)+1,a),{});assert.ok((counts["https://arbitrum-one-public.nodies.app/"]??0)<=256);assert.ok((counts["https://evm-rpc.sei-apis.com/"]??0)<=104);assert.ok((counts["https://arb1.arbitrum.io/rpc"]??0)<=7);
  await assert.rejects(service.approveCleanup86(f.parent.operationId));assert.deepEqual([restores,sends],[1,1]);
  console.log(JSON.stringify({TEST_ONLY:true,qualification:"normal service genuine PTY, full bounded ten-read F85 oracle, restoration TEST port; no production Buyer crypto positive",counts,timings,mintTime:"not separately recorded; after genuine consent and before restoreEntered by source order",phases:rows.reduce<Record<string,number>>((a,r)=>(a[r.endpoint+":"+r.phase]=(a[r.endpoint+":"+r.phase]??0)+1,a),{}),requestStarts:rows,restores,sends,sign:0}));
}finally{await temp.cleanup();}
