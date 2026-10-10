import assert from "node:assert/strict";
import test from "node:test";
import type { BridgeHttps } from "../../src/lifi/https.js";
import { mkdtemp,realpath,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
/** Explicit future F85 public-proof oracle, never production-owner signature/restoration proof. */
test("first-dispatch normal runtime fresh guards before consent",async t=> {
  let publicProof:typeof import("../../src/circle-v2-evm/cleanup85-public-proof.js");
  t.mock.module("../../src/circle-v2-evm/cleanup85-public-proof.js",{namedExports:{verifyCleanup85PublicWire:(...args:Parameters<typeof publicProof.verifyCleanup85PublicWire>)=>publicProof.verifyCleanup85PublicWire(...args),cleanup85Reanchor:(...args:Parameters<typeof publicProof.cleanup85Reanchor>)=>publicProof.cleanup85Reanchor(...args),assertCancellationProofShape:(...args:Parameters<typeof publicProof.assertCancellationProofShape>)=>publicProof.assertCancellationProofShape(...args),verifyCancellationPublic:async(_source:unknown,proof:{observation:unknown})=>proof.observation}});
  publicProof=await import(new URL("../../src/circle-v2-evm/cleanup85-public-proof.js?unmocked-source19-shape",import.meta.url).href);
  const {firstDispatchFixture}=await import("./cleanup86-first-dispatch-fixture.js"),{firstDispatchCleanup86}=await import("../../src/circle-v2-evm/cleanup86-first-dispatch-runtime.js"),{CircleRpc}=await import("../../src/circle-v2-evm/rpc.js"),{withCleanup85FinancialScope}=await import("../../src/circle-cleanup85-financial-scope.js"),{Cleanup86Custody}=await import("../../src/circle-v2-evm/cleanup86-custody.js"),{CLEANUP85_HASH}=await import("../../src/circle-v2-evm/cleanup85-recovery-store.js");
  for(const variant of ["fee","pendingNative","approveCall","oldReceipt","nonce","fullHolds"] as const)await t.test(variant,async()=> {
    const root=await realpath(await mkdtemp(join(tmpdir(),"apn-first-dispatch-runtime-")));try {
      const f=await firstDispatchFixture(root);let keys=0,oldReceiptReads=0;const rows:{endpoint:string;method:string}[]=[];
      const https:Pick<BridgeHttps,"request">={request:async(url,method,body,...rest)=> {
        const r=JSON.parse(body!);rows.push({endpoint:url,method:r.method});let value:unknown;
        if(r.method==="eth_getBlockByNumber"&&r.params[0]==="finalized"&&!url.includes("sei"))value=f.transport.snapshot.archiveAnchor;
        else if(r.method==="eth_getTransactionCount")value=variant==="nonce"?"0x57":"0x56";
        else if(r.method==="eth_getBalance")value=variant==="pendingNative"&&r.params[1]==="pending"?"0x0":variant==="fullHolds"?"0x36a992ead000":"0xffffffffffff";
        else if(r.method==="eth_call"&&String(r.params[0].data).startsWith("0x095ea7b3"))value=variant==="approveCall"?"0x":"0x"+"0".repeat(63)+"1";
        else if(r.method==="eth_getTransactionReceipt"&&r.params[0]===CLEANUP85_HASH)value=variant==="oldReceipt"&&++oldReceiptReads>1?{}:null;
        if(value!==undefined)return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:r.id,result:value})};
        const response=await f.transport.https.request(url,method,body,...rest);
        if(variant==="fee"&&url.includes("arb1")&&r.method==="eth_getBlockByNumber"&&r.params[0]==="latest"){const parsed=JSON.parse(response.body);parsed.result={...parsed.result,baseFeePerGas:"0x4c4b400"};return {...response,body:JSON.stringify(parsed)};}
        return response;
      }};
      const source=new CircleRpc("https://arbitrum-one-public.nodies.app",42161,https,256,"500"),destination=new CircleRpc("https://evm-rpc.sei-apis.com",1329,https,104,"500"),custody=new Cleanup86Custody(f.state,{load:async()=>{keys++;return f.wrapping;},create:async()=>{throw Error("forbidden");}});
      await withCleanup85FinancialScope(f.state,f.request,f.lineage.operationId,async scope=> {
        await assert.rejects(firstDispatchCleanup86(f.state,f.parent,f.recovery,f.intent,f.proof,source,destination,scope,f.now,{},https,custody,async()=>{},"500"),(error:unknown)=> {
          t.diagnostic(JSON.stringify({variant,error:String(error),details:(error as {details?:unknown}).details}));
          if(variant==="nonce")assert.match(String(error),/consumed_nonce_principal_or_allowance_changed/);
          if(variant==="fullHolds")assert.match(String(error),/full_native_liabilities/);
          if(["fee","pendingNative","approveCall","oldReceipt"].includes(variant))assert.equal((error as {details?:{failurePredicate:string}}).details?.failurePredicate,variant);
          return true;
        });
      });
      assert.equal(keys,0);assert.equal(rows.filter(r=>r.method==="eth_sendRawTransaction").length,0);
      t.diagnostic(JSON.stringify({variant,physicalByRole:rows.reduce<Record<string,number>>((a,r)=>(a[r.endpoint]=(a[r.endpoint]??0)+1,a),{})}));
    } finally {await rm(root,{recursive:true,force:true});}
  });
});
