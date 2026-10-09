import assert from "node:assert/strict";
import test from "node:test";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { merchantReceipt } from "../../src/x402-merchant/rpc.js";
import { merchantMove, sealMerchant, validateMerchant } from "../../src/x402-merchant/model.js";
import { merchantFixture, TX_HASH } from "./merchant-x402-fixtures.js";
import { temporaryState } from "./helpers.js";
async function setup(t:test.TestContext) { const tmp=await temporaryState();t.after(tmp.cleanup);return merchantFixture(tmp.root); }
for (const mutate of [
 (m:string,v:any)=>{if(m==="eth_getTransactionReceipt")v.transactionIndex="0x1";},
 (m:string,v:any)=>{if(m==="eth_getBlockByNumber"&&v.transactions)v.transactions=[];},
 (m:string,v:any)=>{if(m==="eth_getBlockByNumber"&&v.transactions)v.transactions[0].hash=`0x${"c".repeat(64)}`;},
 (m:string,v:any)=>{if(m==="eth_getTransactionReceipt")v.logs[0].transactionIndex="0x1";},
 (m:string,v:any)=>{if(m==="eth_getTransactionReceipt")v.logs[0].blockNumber="0x11";},
 (m:string,v:any)=>{if(m==="eth_getTransactionReceipt")v.logs[0].topics.push(TX_HASH);},
 (m:string,v:any)=>{if(m==="eth_getTransactionReceipt")v.gasUsed="0xffffff";},
 (m:string,v:any)=>{if(m==="eth_getTransactionReceipt")v.l1Fee="0x1";},
 (m:string,v:any)=>{if(m==="eth_getTransactionByHash")v.accessList=[{}];},
] as const) test("canonical receipt rejects index/membership/log/fee/envelope drift without disclosure",async t=>{
 const f=await setup(t),o=await f.prepare(),read=f.rpc.value.bind(f.rpc);f.rpc.value=async(m,p)=>{const v=await read(m,p);mutate(m,v);return v;};
 const held=await f.service.approve(o.operationId);assert.equal(held.receipt,null);assert.equal(f.headers.length,0);assert.equal(f.signs(),1);assert.equal(f.rpc.sends,1);
});
test("finalized and numbered header drift during proof acquisition rejects evidence",async t=>{
 const f=await setup(t),o=await f.prepare();f.rpc.lost=true;const held=await f.service.approve(o.operationId),read=f.rpc.value.bind(f.rpc);let finalizedReads=0;
 f.rpc.value=async(m,p)=>{const v:any=await read(m,p);if(m==="eth_getBlockByNumber"&&p[0]==="finalized"&&++finalizedReads>1)v.parentHash=`0x${"c".repeat(64)}`;return v;};
 await assert.rejects(merchantReceipt(f.rpc,held));assert.equal(f.headers.length,0);
});
test("saved paid receipt after canonical reorg cannot disclose or sign again",async t=>{
 const f=await setup(t),o=await f.prepare();f.rpc.lost=true;await f.service.approve(o.operationId);const paid=await f.service.observe(o.operationId);f.rpc.reorg=true;
 const held=await f.service.observe(o.operationId,true);assert.equal(held.state,"payment_finalized");assert.deepEqual(held.receipt,paid.receipt);assert.equal(held.canonicalObservations?.at(-1)?.result,"mismatch");assert.equal(f.headers.length,0);assert.equal(f.signs(),1);assert.equal(f.rpc.sends,1);
});
test("delivery retry remains original-proof only after independent reobservation",async t=>{
 const f=await setup(t),o=await f.prepare();f.failDelivery();const unknown=await f.service.approve(o.operationId);assert.equal(unknown.state,"delivery_unknown");f.repairDelivery();const done=await f.service.observe(o.operationId,true);assert.equal(done.state,"delivered");assert.equal(f.headers[0],f.headers[1]);assert.equal(f.signs(),1);assert.equal(f.rpc.sends,1);
});
test("later mismatch records current truth without changing historical HTTP200 or receipt",async t=>{
 const f=await setup(t),o=await f.prepare(),done=await f.service.approve(o.operationId);const receipt=done.receipt,delivery=done.deliveryAttempts,events=done.events;f.rpc.reorg=true;
 const changed=await f.service.observe(o.operationId,true);assert.equal(changed.state,"delivered");assert.deepEqual(changed.receipt,receipt);assert.deepEqual(changed.deliveryAttempts,delivery);assert.deepEqual(changed.events,events);assert.equal(changed.canonicalObservations?.at(-1)?.result,"mismatch");assert.equal(f.headers.length,1);
 const repeated=await f.service.observe(o.operationId,true);assert.deepEqual(repeated,changed);
 await assert.rejects(async()=>f.service.records.persist(merchantMove(changed,"delivered",changed.createdAt,{deliveryAttempts:changed.deliveryAttempts.map((a,i)=>i===changed.deliveryAttempts.length-1?{...a,result:{bitcoin:{usd:1}}}:a)})));
});
test("unavailable current RPC does not falsely claim a reorg or deliver",async t=>{
 const f=await setup(t),o=await f.prepare();f.rpc.lost=true;await f.service.approve(o.operationId);await f.service.observe(o.operationId);f.rpc.batch=async()=>{throw new Error("unavailable");};
 const held=await f.service.observe(o.operationId,true);assert.equal(held.canonicalObservations?.at(-1)?.result,"unavailable");assert.equal(f.headers.length,0);
});
test("legacy receipt metadata absence retains original JSON/hash but requires fresh proof",async t=>{
 const f=await setup(t),o=await f.prepare();f.rpc.lost=true;const held=await f.service.approve(o.operationId),fresh=(await merchantReceipt(f.rpc,held))!;
 const {canonical:_,...legacyReceipt}=fresh,legacy=merchantMove(held,"payment_finalized",held.createdAt,{receipt:legacyReceipt});const json=canonicalJson(legacy);
 assert.equal(canonicalJson(validateMerchant(JSON.parse(json))),json);assert.equal(validateMerchant(JSON.parse(json)).integrityHash,legacy.integrityHash);assert.equal("canonicalObservations" in legacy,false);
 await f.service.records.persist(legacy);const verified=await f.service.observe(o.operationId);assert.deepEqual(verified.receipt,legacyReceipt);assert.equal(verified.canonicalObservations?.at(-1)?.result,"verified");
 const audit=verified.canonicalObservations![0]!,{observationHash:__,...a}=audit,{integrityHash:___,...base}=verified;
 assert.throws(()=>sealMerchant({...base,canonicalObservations:[{...a,priorReceiptHash:"0".repeat(64),observationHash:hashObject({...a,priorReceiptHash:"0".repeat(64)})}]}));
});

test("advancing finalized head requires stable old numbered anchor and new header identity",async t=>{
 const f=await setup(t),o=await f.prepare();f.rpc.lost=true;const held=await f.service.approve(o.operationId),read=f.rpc.value.bind(f.rpc);let finalized=0;
 f.rpc.value=async(m,p)=>{const v:any=await read(m,p);if(m==="eth_getBlockByNumber"&&((p[0]==="finalized"&&++finalized>1)||p[0]==="0x11")){v.number="0x11";v.timestamp="0x101";v.parentHash=v.hash;v.hash=`0x${"c".repeat(64)}`;}return v;};
 const receipt=await merchantReceipt(f.rpc,held);assert.equal(receipt?.canonical?.finalizedNumber,"17");assert.equal(f.rpc.sends,1);assert.equal(f.signs(),1);
});
test("forged or duplicated terminal audit references cannot be appended",async t=>{
 const f=await setup(t),o=await f.prepare(),done=await f.service.approve(o.operationId),last=done.canonicalObservations!.at(-1)!,{observationHash:_,...audit}=last,{integrityHash:__,...body}=done;
 assert.throws(()=>sealMerchant({...body,canonicalObservations:[...done.canonicalObservations!,{...audit,previousHash:last.observationHash,observationHash:hashObject({...audit,previousHash:last.observationHash})}]}));
});
