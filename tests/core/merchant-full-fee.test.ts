import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { MerchantRpc, merchantReceipt, merchantCurrent, checkMerchantEnvelope } from "../../src/x402-merchant/rpc.js";
import { merchantActualFee, merchantOracleAt, merchantPayerDebit, MEGA_FEE_ORACLE, checkMerchantFullFee } from "../../src/x402-merchant/mega-fee.js";
import { issueMerchantAuthority, bindMerchantFeeAdmission, assertMerchantAuthority, disposeMerchantAuthority } from "../../src/x402-merchant/authority.js";
import { merchantFingerprint, sealMerchant } from "../../src/x402-merchant/model.js";
import { merchantFixture, TX_HASH, BLOCK_HASH } from "./merchant-x402-fixtures.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
const load=async(name:string)=>JSON.parse(await readFile(`tests/core/merchant-fee-fixtures/${name}`,"utf8"));
async function actual(){
 const canonical=await load("canonical-oracle.json"),impl=await load("oracle-implementation.json"),anchor=await load("anchored-oracle.json"),oracle=await load("oracle-and-second-receipt.json"),parent=(await load("actual-parent.json")).result,balance=await load("payer-debit.json"),receipt=(await load("public-type2-receipt-proof.json"))[0].result;
 const find=(a:any[],id:string)=>a.find(x=>x.id===id).result,block=find(canonical,"1");
 return {canonical,impl,anchor,oracle,parent,balance,receipt,block,find};
}
async function actualRpc(root:string,f:Awaited<ReturnType<typeof actual>>){
 const state=new StateStore(root);await state.initialize();const reads:{method:string;params:readonly unknown[]}[]=[];
 const transport={request:async(_url:string,_method:string,body:string|null)=>{
  const requests=JSON.parse(body!),batch=Array.isArray(requests)?requests:[requests],results=[];
  for(const r of batch){reads.push({method:r.method,params:r.params});let result:unknown;
   if(r.method==="eth_getCode"){assert.equal(r.params[1].requireCanonical,true);result=r.params[0]===MEGA_FEE_ORACLE.address?f.find(f.canonical,"3"):f.find(f.impl,"0");}
   else if(r.method==="eth_getStorageAt"){assert.equal(r.params[2].requireCanonical,true);result=f.find(f.anchor,"7");}
   else if(r.method==="eth_call"){assert.equal(r.params[1].requireCanonical,true);const selector=r.params[0].data.slice(0,10);result=selector==="0x275aedd2"?f.find(f.anchor,"4"):selector==="0xf1c7a58b"?(r.params[1].blockHash===f.block.hash?f.find(f.oracle,"6"):f.find(f.anchor,"2")):selector==="0x54fd4d50"?f.find(f.oracle,"5"):f.find(f.oracle,"2");}
   else if(r.method==="eth_getBlockByNumber")result=r.params[0]===f.parent.number?f.parent:r.params[0]===f.block.number?f.block:f.find(f.anchor,"5");
   else if(r.method==="eth_getTransactionReceipt")result=r.params[0]===f.receipt.transactionHash?f.receipt:f.find(f.oracle,"0");
   else if(r.method==="eth_getBalance"){assert.equal(r.params[1].requireCanonical,true);result=r.params[1].blockHash===f.parent.hash?f.find(f.balance,"0"):f.find(f.balance,"1");}
   else throw new Error(r.method);
   results.push({jsonrpc:"2.0",id:r.id,result});
  }
  return {status:200,body:JSON.stringify(Array.isArray(requests)?results:results[0])};
 }};
 return {rpc:new MerchantRpc(state,transport as never),reads};
}
test("complete actual Mega type2 receipt execution plus L1 is exact841446369381, not execution alone",async()=>{
 const f=await actual(),fee=merchantActualFee(f.receipt);assert.equal(fee.execution,"840903000000");assert.equal(fee.l1,"543369381");assert.equal(fee.total,"841446369381");
});
test("actual pinned oracle raw DATA and actual two-outgoing payer delta pass production RPC parser",async t=>{
 const f=await actual(),tmp=await temporaryState();t.after(tmp.cleanup);const {rpc,reads}=await actualRpc(tmp.root,f);
 assert.equal(await merchantOracleAt(rpc,BigInt(f.block.number).toString(),f.block.hash,2200000n,854n),1949480508n);
 const currentHead=f.find(f.anchor,"5");assert.equal(await merchantOracleAt(rpc,BigInt(currentHead.number).toString(),currentHead.hash,2200000n,854n),1769144288n);
 const proof=await merchantPayerDebit(rpc,f.receipt.from,f.block,f.receipt,"100000000000000");assert.equal(proof.aggregateDebit,"1683186309375");assert.equal(proof.transactionHashes.length,2);assert.ok(proof.transactionHashes.includes(f.receipt.transactionHash));
 assert.ok(reads.every(r=>r.method!=="eth_sendRawTransaction"));
});
for(const kind of ["missing-l1","quantity-data","wrong-type","nonzero-operator","partial-operator","nonzero-blob"] as const)test(`actual full receipt refuses ${kind}`,async()=>{
 const f=await actual(),r=structuredClone(f.receipt);if(kind==="missing-l1")delete r.l1Fee;if(kind==="quantity-data")r.l1Fee="0x00";if(kind==="wrong-type")r.type="0x0";if(kind==="nonzero-operator")r.operatorFee="0x1";if(kind==="partial-operator")r.operatorFeeScalar="0x0";if(kind==="nonzero-blob")r.blobGasUsed="0x1";assert.throws(()=>merchantActualFee(r));
});
for(const kind of ["incoming","extra-outgoing","receipt-block","receipt-fee","debit","budget","parent"] as const)test(`actual complete payer fixture rejects ${kind}`,async t=>{
 const f=await actual(),tmp=await temporaryState();t.after(tmp.cleanup);
 if(kind==="incoming")f.block.transactions[0].to=f.receipt.from;if(kind==="extra-outgoing")f.block.transactions.push(f.block.transactions.find((x:any)=>x.hash===f.receipt.transactionHash));if(kind==="receipt-block")f.find(f.oracle,"0").blockHash=`0x${"f".repeat(64)}`;if(kind==="receipt-fee")f.find(f.oracle,"0").effectiveGasPrice="0x1";if(kind==="debit")f.balance.find((x:any)=>x.id==="1").result="0x0";if(kind==="parent")f.parent.hash=`0x${"e".repeat(64)}`;
 const {rpc}=await actualRpc(tmp.root,f);await assert.rejects(merchantPayerDebit(rpc,f.receipt.from,f.block,f.receipt,kind==="budget"?"1":"100000000000000"));
});
async function setup(t:test.TestContext){const tmp=await temporaryState();t.after(tmp.cleanup);return merchantFixture(tmp.root);}
for(const kind of ["oracle-proxy","oracle-storage","oracle-implementation","oracle-version","oracle-flag","operator","anchor","l1-budget","balance"] as const)test(`normal fresh full-fee preflight refuses ${kind} before sign/send`,async t=>{
 const f=await setup(t),read=f.rpc.value.bind(f.rpc);f.rpc.value=async(m,p)=>{const v=await read(m,p);if(m==="eth_getCode"&&p[0]===MEGA_FEE_ORACLE.address&&kind==="oracle-proxy")return "0x00";if(m==="eth_getStorageAt"&&p[0]===MEGA_FEE_ORACLE.address&&kind==="oracle-storage")return `0x${"0".repeat(64)}`;if(m==="eth_getCode"&&p[0]===MEGA_FEE_ORACLE.implementation&&kind==="oracle-implementation")return "0x00";if(m==="eth_call"&&(p[0] as {to:string}).to===MEGA_FEE_ORACLE.address){const selector=(p[0] as {data:string}).data.slice(0,10);if(kind==="oracle-version"&&selector==="0x54fd4d50")return "0x";if(kind==="oracle-flag"&&!['0x54fd4d50','0xf1c7a58b','0x275aedd2'].includes(selector))return `0x${"0".repeat(64)}`;if(kind==="operator"&&selector==="0x275aedd2")return `0x${"0".repeat(63)}1`;if(kind==="l1-budget"&&selector==="0xf1c7a58b")return `0x${(1000000000001n).toString(16).padStart(64,"0")}`;}if(m==="eth_getBlockByNumber"&&p[0]==="0x10"&&kind==="anchor")return {...v as object,hash:`0x${"f".repeat(64)}`};if(m==="eth_getBalance"&&kind==="balance")return "0x57e43";return v;};
 await assert.rejects(f.prepare());assert.equal(f.signs(),0);assert.equal(f.rpc.sends,0);
});
test("new native reserve includes L1 estimate and actual full fee; total accounting is separate from delivery",async t=>{
 const f=await setup(t),o=await f.prepare();assert.equal(o.effectBinding!.nativeAmountAtomic,(BigInt(o.envelope.gas)*BigInt(o.envelope.maxFeePerGas)+f.rpc.l1Upper).toString());
 const done=await f.service.approve(o.operationId);assert.equal(done.state,"delivered");assert.equal(done.receipt?.networkFeeWei,"200100");assert.equal(done.receipt?.fullFee?.executionWei,"200000");assert.equal(done.receipt?.fullFee?.l1Wei,"100");assert.equal(f.signs(),1);assert.equal(f.rpc.sends,1);
});
test("fresh increased L1 above original hold refuses before signing; safe decrease is accepted",async t=>{
 const f=await setup(t),o=await f.prepare();f.rpc.l1Upper=101n;await assert.rejects(f.service.approve(o.operationId));assert.equal(f.signs(),0);assert.equal(f.rpc.sends,0);f.rpc.l1Upper=99n;const done=await f.service.approve(o.operationId);assert.equal(done.state,"delivered");
});
test("current canonical fee check is for frozen unsigned bytes, not resealed fresh envelope",async t=>{
 const f=await setup(t),o=await f.prepare(),current=await merchantCurrent(f.rpc,o.envelope);assert.equal(current.feeContext.unsignedHash,o.feeContext!.unsignedHash);checkMerchantEnvelope(current,o.envelope,o.feeContext);
 assert.throws(()=>checkMerchantFullFee({...current.feeContext,admissionEstimatedUpper:(BigInt(o.effectBinding!.nativeAmountAtomic)+1n).toString(),l1EstimatedUpper:"101"},o.feeContext!,o.envelope,current.native));
});
test(`absolute fee witness expires at queue, zero POST and no resend`,async t=>{
 const f=await setup(t),o=await f.prepare();f.rpc.queued=async()=>f.advance(10001);const held=await f.service.approve(o.operationId);assert.equal(held.state,"unknown_finality");assert.equal(f.rpc.sends,0);assert.equal(f.signs(),1);await assert.rejects(f.service.approve(o.operationId));
});
test("fee witness is private, controller/frame bound, disposed, and never renewed by delayed bind",async t=>{
 const f=await setup(t),o=await f.prepare(),controller={},grant=issueMerchantAuthority(controller,o,"token","native",new Date(f.now().getTime()+60000).toISOString());assert.throws(()=>assertMerchantAuthority(grant,controller,o,f.now()));bindMerchantFeeAdmission(grant,controller,o,o.feeContext!,f.now(),f.now());assertMerchantAuthority(grant,controller,o,f.now());assert.throws(()=>assertMerchantAuthority(grant,{},o,f.now()));f.advance(10000);assert.throws(()=>assertMerchantAuthority(grant,controller,o,f.now()));assert.throws(()=>bindMerchantFeeAdmission(grant,controller,o,o.feeContext!,new Date(f.now().getTime()-10000),f.now()));disposeMerchantAuthority(grant);assert.throws(()=>bindMerchantFeeAdmission(grant,controller,o,o.feeContext!,f.now(),f.now()));
});
test("legacy absent full-fee field preserves exact fingerprint/hash and cannot financially continue",async t=>{
 const f=await setup(t),o=await f.prepare(),{feeContext:_,integrityHash:__,...body}=o,oldBody={...body,effectBinding:{...o.effectBinding!,nativeAmountAtomic:(BigInt(o.envelope.gas)*BigInt(o.envelope.maxFeePerGas)).toString()}},old=sealMerchant({...oldBody,fingerprint:merchantFingerprint(oldBody)});const json=canonicalJson(old);await writeFile(`${f.state.root}/merchant-x402/${o.operationId}.json`,json+'\n',{mode:0o600});assert.equal(canonicalJson(await f.service.status(o.operationId)),json);await assert.rejects(f.service.approve(o.operationId));assert.equal(f.signs(),0);assert.equal(f.rpc.sends,0);
});
for(const kind of ["missing-l1","actual-over-hold","operator","payer-delta"] as const)test(`normal observer ${kind} keeps payment held and never discloses`,async t=>{
 const f=await setup(t),o=await f.prepare();if(kind==="missing-l1")f.rpc.receiptOverride=r=>{delete r.l1Fee;};if(kind==="actual-over-hold"){f.rpc.l1Actual=BigInt(o.effectBinding!.nativeAmountAtomic);}if(kind==="operator")f.rpc.receiptOverride=r=>{r.operatorFee="0x1";};if(kind==="payer-delta"){const read=f.rpc.value.bind(f.rpc);f.rpc.value=async(m,p)=>m==="eth_getBalance"&&typeof p[1]==="object"&&(p[1] as {blockHash:string}).blockHash===BLOCK_HASH?"0x0":read(m,p);}
 const held=await f.service.approve(o.operationId);assert.equal(held.receipt,null);assert.equal(f.headers.length,0);assert.equal(f.signs(),1);assert.equal(f.rpc.sends,1);
});

test("actual delayed TLS dispatch enforces private full-fee witness before request.end",async t=>{
 const f=await setup(t),o=await f.prepare(),{execFile}=await import("node:child_process"),{promisify}=await import("node:util");
 const script=`import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import assert from 'node:assert/strict';const o=${JSON.stringify(o)};let elapsed=0,posts=0,gates=0;https.request=()=>{const r=new EventEmitter();r.destroy=()=>{};r.end=()=>{posts++;};setImmediate(()=>{const s=new EventEmitter();s.remoteAddress='1.1.1.1';r.emit('socket',s);s.emit('connect');elapsed=10001;s.emit('secureConnect');});return r;};syncBuiltinESMExports();const {BridgeHttps}=await import(${JSON.stringify(new URL('../../src/lifi/https.js',import.meta.url).href)}),{issueMerchantAuthority,bindMerchantFeeAdmission,assertMerchantAuthority}=await import(${JSON.stringify(new URL('../../src/x402-merchant/authority.js',import.meta.url).href)});const controller={},at=new Date(o.createdAt),grant=issueMerchantAuthority(controller,o,'token','native',new Date(at.getTime()+60000).toISOString());bindMerchantFeeAdmission(grant,controller,o,o.feeContext,at,at);await assert.rejects(new BridgeHttps(async()=>[{address:'1.1.1.1',family:4}]).request('https://mainnet.megaeth.com/rpc','POST','{}',1024,'APN_RPC_CONFIG',()=>{gates++;assertMerchantAuthority(grant,controller,o,new Date(at.getTime()+elapsed));}),e=>e.details?.reason==='merchant_fee_witness_expired');assert.equal(posts,0);assert.equal(gates,2);console.log('Private fee witness: delayed TLS0 physical bodies');`;
 const result=await promisify(execFile)(process.execPath,["--input-type=module","-e",script]);assert.match(result.stdout,/TLS0 physical bodies/u);
});
test("production custody fresh fee guard after wallet read blocks private key access and signature",async t=>{
 const f=await setup(t),prepared=await f.prepare(),{merchantMove}=await import("../../src/x402-merchant/model.js"),{MerchantClaims}=await import("../../src/x402-merchant/claims.js"),{MerchantCustody}=await import("../../src/x402-merchant/custody.js"),{EncryptedWalletStore}=await import("../../src/encrypted-wallet-store.js");
 const o=merchantMove(prepared,"signing_started",prepared.createdAt,{signingAttempts:1}),controller={},grant=issueMerchantAuthority(controller,o,"token","native",new Date(f.now().getTime()+60000).toISOString());bindMerchantFeeAdmission(grant,controller,o,o.feeContext!,f.now(),f.now());await new MerchantClaims(f.state.root).claim(o,"sign");let reads=0,keyReads=0;
 t.mock.method(EncryptedWalletStore.prototype,"describe",async()=>{reads++;f.rpc.l1Upper=101n;return {identity:{profile:o.profile,address:o.custody.walletAddress,chainId:8453,createdAt:o.custody.walletCreatedAt,bindingHash:o.custody.walletBindingHash},secret:{get privateKey(){keyReads++;throw new Error("private key access forbidden");}}} as never;});t.mock.method(EncryptedWalletStore.prototype,"clear",()=>{});
 const custody=new MerchantCustody(f.state,{load:async()=>null,create:async()=>{throw new Error("unexpected create");}},f.now);
 await assert.rejects(custody.sign(o,grant,controller,async()=>{const current=await merchantCurrent(f.rpc,o.envelope);checkMerchantEnvelope(current,o.envelope,o.feeContext);}),/Pinned USDm merchant operation refused/);assert.equal(reads,1);assert.equal(keyReads,0);assert.equal(f.rpc.sends,0);
});
