/** Actual unmodified public API/RPC fixtures; synthetic temporary journals only. Never signs or sends. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeTransaction, type Hex } from "viem";
import { temporaryState } from "./helpers.js";
import { StateStore } from "../../src/state.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { SEI_FUNDING, seiJson, inspectSeiDelivery, type SeiCorrelatedDelivery } from "../../src/lifi/sei-gaszip-contract.js";
import { MEGA_FUNDING, megaJson, inspectMegaDelivery } from "../../src/lifi/mega-gaszip-contract.js";
import { SeiFundingRpc, proveSeiDelivery, type SeiRpcPort } from "../../src/lifi/sei-gaszip-rpc.js";
import { MegaFundingRpc, proveMegaDelivery } from "../../src/lifi/mega-gaszip-rpc.js";
import { SeiFundingService } from "../../src/lifi/sei-gaszip-service.js";
import { MegaFundingService } from "../../src/lifi/mega-gaszip-service.js";
import { SeiFundingJournal, sealSeiFunding, type SeiFundingRecord } from "../../src/lifi/sei-gaszip-journal.js";
import { MegaFundingJournal, sealMegaFunding, type MegaFundingRecord } from "../../src/lifi/mega-gaszip-journal.js";
type Row=Record<string,any>;
const base="https://mainnet.base.org",sei="https://evm-rpc.sei-apis.com",mega="https://mainnet.megaeth.com";
const raw=(name:string)=>readFile(join(process.cwd(),"tests/core/gaszip-fixtures",name),"utf8");
async function fixture(lane:"sei"|"mega"){
 const prepare=JSON.parse(await raw(lane==="sei"?"sei-prepare-02.json":"mega-prepare.json")).data as SeiFundingRecord|MegaFundingRecord;
 const body=await raw(lane==="sei"?"sei-provider-status.json":"mega-provider-public-diagnosis.json");
 const calls:Row[]=[];
 if(lane==="sei")calls.push(...JSON.parse(await raw("sei-independent-actual-destination-proof.json")).calls);
 else {
  const source=JSON.parse(await raw("mega-source-public-diagnosis.json")) as Row[];
  const dest=JSON.parse(await raw("mega-destination-public-diagnosis.json")) as Row[];
  const anchors=JSON.parse(await raw("mega-destination-canonical-anchors.json")) as Row[];
  const balances=JSON.parse(await raw("mega-destination-canonical-balances.json")) as Row[];
  const add=(url:string,method:string,params:unknown[],body:Row)=>calls.push({url,method,params,body});
  for(const [url,rows] of [[base,source],[mega,dest]] as const)for(const b of rows){const m=b.id==="tx"?"eth_getTransactionByHash":b.id==="receipt"?"eth_getTransactionReceipt":"eth_getBlockByNumber";add(url,m,[b.id==="safe"?"safe":b.result.hash??b.result.transactionHash,...(b.id==="safe"?[false]:[])],b);}
  add(base,"eth_chainId",[],{result:"0x2105"});add(mega,"eth_chainId",[],{result:"0x10e6"});
  add(base,"eth_getBlockByNumber",["0x31f1100",false],JSON.parse(await raw("mega-source-inclusion.json")));
  for(const b of anchors)add(mega,"eth_getBlockByNumber",[b.id==="safe"?"safe":b.result.number,false],b);
  const before=anchors.find(b=>b.id==="previous")!.result.hash,after=anchors.find(b=>b.id==="block")!.result.hash;
  for(const b of balances){if(b.id==="recheck")add(mega,"eth_getBlockByNumber",[b.result.number,false],b);else add(mega,b.id==="codeBefore"?"eth_getCode":"eth_getBalance",[prepare.owner.address,{blockHash:b.id==="after"?after:before,requireCanonical:true}],b);}
 }
 const tx=calls.find(c=>c.url===base&&c.method==="eth_getTransactionByHash")!.body.result;
 const sourceHash=tx.hash as Hex;
 const sourceRaw=serializeTransaction({type:"eip1559",chainId:8453,nonce:Number(BigInt(tx.nonce)),gas:BigInt(tx.gas),maxFeePerGas:BigInt(tx.maxFeePerGas),maxPriorityFeePerGas:BigInt(tx.maxPriorityFeePerGas),to:prepare.owner.address===MEGA_FUNDING.owner?MEGA_FUNDING.target:SEI_FUNDING.target,value:BigInt(tx.value),data:tx.input,accessList:tx.accessList},{r:tx.r,s:tx.s,yParity:Number(BigInt(tx.yParity))});
 const parsed=(lane==="sei"?seiJson:megaJson)(body) as Row;
 const inspect=lane==="sei"?inspectSeiDelivery:inspectMegaDelivery;
 const delivery=()=>inspect(parsed,sourceHash,prepare.owner.address,prepare.amountAtomic,String(BigInt(tx.blockNumber))) as SeiCorrelatedDelivery;
 let providerBody=body;const transport={request:async(url:string,method:string,requestBody:string|null)=>{
  if(method==="GET"){assert.equal(url,`https://backend.gas.zip/v2/deposit/${sourceHash}`);return {status:200,body:providerBody};}
  const req=JSON.parse(requestBody!);assert.notEqual(req.method,"eth_sendRawTransaction");assert.notEqual(req.method,"eth_estimateGas");
  const c=calls.findLast(c=>new URL(c.url).toString()===url&&c.method===req.method&&JSON.stringify(c.params)===JSON.stringify(req.params));assert.ok(c,`${url} ${req.method} ${JSON.stringify(req.params)}`);
  // Complete public response preserved, only request-id echo adapted to the production transport sequence.
  return {status:200,body:JSON.stringify({...c.body,jsonrpc:"2.0",id:req.id})};
 }};
 const rpc=()=>lane==="sei"?new SeiFundingRpc(sei,transport):new MegaFundingRpc(mega,transport);
 return {lane,prepare,sourceHash,sourceRaw,parsed,calls,delivery,transport,rpc,changeBody:(s:string)=>{providerBody=s;},net:lane==="sei"?"356122358112727872":"9855725436024"};
}
for(const lane of ["sei","mega"] as const){
 test(`${lane} complete actual native response through production parser and independent safe net payout proof`,async()=>{
  const f=await fixture(lane),d=f.delivery();assert.equal(d.grossNative,true);assert.equal(d.amount,f.parsed.txs[0].value);
  const proof=await (lane==="sei"?proveSeiDelivery:proveMegaDelivery)(f.rpc(),f.prepare.owner.address,d);assert.equal(proof?.amount,f.net);assert.equal(proof?.status,"success");
 });
 for(const raisedFloor of [false,true])test(`${lane} full actual fixture normal observer ${raisedFloor?"ends a proved net below the frozen owner floor as destination_failed":"appends proof, finalizes usage, and cannot double claim"}`,async t=>{
  const f=await fixture(lane),temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root);await state.initialize();
  const ledger=new AssetUsageLedger(temp.root),identity={account:f.prepare.owner.address,chain:"eip155:8453",asset:{kind:"native" as const,identifier:null}};
  const registry=sealAssetPolicyRegistry({schemaVersion:"apn.asset-policy-registry.v1",registryVersion:"synthetic.observer.1",publishedAt:"2026-10-09T00:00:00.000Z",effectiveDate:"2026-10-09",chains:[{chain:identity.chain,family:"evm",name:"Base",assets:[{kind:"native",identifier:null,symbol:"ETH",decimals:18,rails:{direct:false,gasless:false,x402:false,swap:false,bridge:true},caps:{maximumPerTransferAtomic:"10000000000000",dailyLimitAtomic:"10000000000000"},mechanismPins:{bridge:lane==="sei"?SEI_FUNDING.mechanism:MEGA_FUNDING.mechanism}}]}]});
  const now=new Date("2026-10-09T06:00:00.000Z"),reservation=await ledger.reserve({...identity,registry,rail:"bridge",mechanism:lane==="sei"?SEI_FUNDING.mechanism:MEGA_FUNDING.mechanism,amountAtomic:f.prepare.amountAtomic,idempotencyKey:"actual-observer-fixture",now});
  await ledger.transition({...identity,reservationId:reservation.reservationId,policyDigest:reservation.policyDigest,state:"submitted",now});
  const record={...f.prepare,...(raisedFloor?{minimumOutputAtomic:(BigInt(f.net)+1n).toString()}:{}),policyDigest:reservation.policyDigest,usageReservationId:reservation.reservationId,state:"submitted" as const,rawTransaction:f.sourceRaw,transactionHash:f.sourceHash,submissionAttempts:1 as const};
  const wrapping={load:async():Promise<Buffer>=>{throw new Error("observer must never load key");},create:async():Promise<Buffer>=>{throw new Error("observer must never create key");}};
  const journal=lane==="sei"?new SeiFundingJournal(temp.root):new MegaFundingJournal(temp.root);
  if(lane==="sei")await (journal as SeiFundingJournal).saveLocked(sealSeiFunding(record as SeiFundingRecord),true);else await (journal as MegaFundingJournal).saveLocked(sealMegaFunding(record as MegaFundingRecord),true);
  const service=lane==="sei"?new SeiFundingService(state,wrapping,{APN_BASE_RPC_URL:base,APN_SEI_RPC_URL:sei},{https:f.transport,now:()=>now.getTime()}):new MegaFundingService(state,wrapping,{APN_BASE_RPC_URL:base,APN_MEGA_RPC_URL:mega},{https:f.transport,now:()=>now.getTime()});
  if(raisedFloor){const failed=await service.status(record.operationId) as Row;assert.equal(failed.state,"destination_failed");assert.equal(failed.terminal,true);
   assert.equal(failed.destinationProof.amount,f.net);assert.equal(failed.destinationProof.belowOwnerFloor,true);
   assert.equal((await ledger.load(identity,reservation.reservationId))?.state,"finalized");return;}
  const done=await service.status(record.operationId) as Row;assert.equal(done.state,"completed");assert.equal(done.destinationProof.amount,f.net);assert.equal(done.rawTransaction,undefined);
  assert.equal((await ledger.load(identity,reservation.reservationId))?.state,"finalized");await service.status(record.operationId);
  await assert.rejects(journal.claimDestinationLocked(f.delivery().hash,"a".repeat(64)),/destination_already_claimed/);
  const saved=await journal.findOperation(record.operationId);assert.equal(saved?.rawTransaction,f.sourceRaw);assert.equal(saved?.submissionAttempts,1);
 });
 for(const kind of ["refund","cancelled","deposit-cancelled"] as const)test(`${lane} full provider fixture ends ${kind} as a terminal provider failure`,()=>{
  const fixtureValue=fixture(lane);return fixtureValue.then(f=>{const v=structuredClone(f.parsed);
  if(kind==="refund")v.txs[0].refund=true;if(kind==="cancelled")v.txs[0].cancelled=true;if(kind==="deposit-cancelled")v.deposit.status="CANCELLED";
  const outcome=(lane==="sei"?inspectSeiDelivery:inspectMegaDelivery)(v,f.sourceHash,f.prepare.owner.address,f.prepare.amountAtomic) as Row;
  assert.equal(outcome.providerFailure,kind==="refund"?"provider_refund":"provider_cancelled");assert.equal(typeof outcome.providerDigest,"string");});
 });
 for(const kind of ["truncated","wrong-native","token","type","chain","receiver","status","data","minValue","extra","null-flag"] as const)test(`${lane} full provider fixture rejects ${kind}`,async()=>{
  const f=await fixture(lane),v=structuredClone(f.parsed);
  if(kind==="truncated")delete v.deposit.seen;if(kind==="wrong-native")v.txs[0].valueNative="1";if(kind==="token")v.deposit.token=f.prepare.owner.address;if(kind==="type")v.deposit.type="TOKEN";if(kind==="chain")v.txs[0].chain="1";if(kind==="receiver")v.txs[0].to=SEI_FUNDING.target;if(kind==="status")v.txs[0].status="SUCCESS";if(kind==="data")v.txs[0].data="0x01";if(kind==="minValue")v.txs[0].minValue="1";if(kind==="extra")v.txs[0].unknown=true;if(kind==="null-flag")v.txs[0].refund=null;
  assert.throws(()=>(lane==="sei"?inspectSeiDelivery:inspectMegaDelivery)(v,f.sourceHash,f.prepare.owner.address,f.prepare.amountAtomic));
 });
 test(`${lane} pending complete fixture stays unresolved`,async()=>{const f=await fixture(lane);f.parsed.txs[0].status="PENDING";assert.equal(f.delivery(),null);});
 test(`${lane} status refusal names the public operation, observer phase, scalar field and same-operation step`,async t=>{
  const f=await fixture(lane),temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root);await state.initialize();
  f.calls.find(c=>c.url===(lane==="sei"?sei:mega)&&c.method==="eth_getTransactionByHash")!.body.result.s=`0x${"g".repeat(64)}`;
  const record={...f.prepare,usageReservationId:null,state:"submitted" as const,rawTransaction:f.sourceRaw,transactionHash:f.sourceHash,submissionAttempts:1 as const};
  const wrapping={load:async():Promise<Buffer>=>{throw new Error("observer must never load key");},create:async():Promise<Buffer>=>{throw new Error("observer must never create key");}};
  const journal=lane==="sei"?new SeiFundingJournal(temp.root):new MegaFundingJournal(temp.root);
  if(lane==="sei")await (journal as SeiFundingJournal).saveLocked(sealSeiFunding(record as SeiFundingRecord),true);else await (journal as MegaFundingJournal).saveLocked(sealMegaFunding(record as MegaFundingRecord),true);
  const now=Date.parse("2026-10-09T06:00:00.000Z"),service=lane==="sei"?new SeiFundingService(state,wrapping,{APN_BASE_RPC_URL:base,APN_SEI_RPC_URL:sei},{https:f.transport,now:()=>now}):new MegaFundingService(state,wrapping,{APN_BASE_RPC_URL:base,APN_MEGA_RPC_URL:mega},{https:f.transport,now:()=>now});
  const before=await journal.findOperation(record.operationId);
  await assert.rejects(service.status(record.operationId),{code:"APN_OPERATION_BLOCKED",message:`${lane}_gaszip_native_signature_s`,details:{operationId:record.operationId,phase:"destination_proof",
   nextActions:[`apn ${lane} funding status --operation ${record.operationId}`],reason:`${lane}_gaszip_native_signature_s`}});
  assert.deepEqual(await journal.findOperation(record.operationId),before);
 });
 for(const kind of ["gross","gas","price","net","type2","signature","receipt-fee","receipt-gas","receipt-revert","receipt-zero-gas","parent","membership","safe-pending"] as const)test(`${lane} independent public RPC fixture ${kind} cannot settle`,async()=>{
  const f=await fixture(lane),d=f.delivery(),url=lane==="sei"?sei:mega;
  const tx=f.calls.find(c=>c.url===url&&c.method==="eth_getTransactionByHash")!.body.result;
  const receipt=f.calls.find(c=>c.url===url&&c.method==="eth_getTransactionReceipt")!.body.result;
  if(kind==="gross")Object.assign(d,{amount:(BigInt(d.amount)+1n).toString()});if(kind==="gas")tx.gas="0x5208";if(kind==="price")tx.gasPrice="0x1";if(kind==="net")tx.value="0x1";if(kind==="type2")tx.type="0x2";if(kind==="signature")tx.r=`0x${"1".repeat(64)}`;if(kind==="receipt-fee")receipt.effectiveGasPrice="0x1";if(kind==="receipt-gas")receipt.gasUsed="0xfffff";if(kind==="receipt-revert")receipt.status="0x0";
  if(kind==="receipt-zero-gas")receipt.gasUsed="0x0";
  if(kind==="parent" || kind==="membership")for(const c of f.calls.filter(c=>c.url===url&&c.method==="eth_getBlockByNumber"&&c.params[0]===receipt.blockNumber)){if(kind==="parent")c.body.result.parentHash=`0x${"1".repeat(64)}`;else c.body.result.transactions=[];}
  if(kind==="safe-pending"){for(const c of f.calls.filter(c=>c.url===url&&c.method==="eth_getBlockByNumber"&&c.params[0]==="safe"))c.body.result.number="0x1";assert.equal(await (lane==="sei"?proveSeiDelivery:proveMegaDelivery)(f.rpc(),f.prepare.owner.address,d),null);}
  else await assert.rejects((lane==="sei"?proveSeiDelivery:proveMegaDelivery)(f.rpc(),f.prepare.owner.address,d));
 });
}
/** QA GASZIP-LIVE-SCALAR-001: the real Sei payout whose RPC `s` is a 63-digit QUANTITY (no leading zero nibble). */
async function shortScalarPayout(){
 const q=JSON.parse(await raw("sei-short-scalar-payout.json")) as Row,captured=q.calls.find((c:Row)=>c.method==="eth_getTransactionByHash").body.result as Row;
 const delivery=inspectSeiDelivery(seiJson(q.provider.body),q.sourceHash,q.owner,q.amountAtomic,q.sourceBlock) as SeiCorrelatedDelivery;
 const port=(tx:Row):SeiRpcPort=>({call:async(method:string,params:readonly unknown[])=>{
  const header=q.recordedHeaders;if(method==="eth_chainId")return header.chainId;if(method==="eth_getTransactionByHash")return structuredClone(tx);
  if(method==="eth_getBlockByNumber"&&params[0]==="safe")return header.safe;if(method==="eth_getBlockByNumber"&&params[0]===header.previous.number)return header.previous;
  const c=q.calls.find((c:Row)=>c.method===method&&JSON.stringify(c.params)===JSON.stringify(params));assert.ok(c,`${method} ${JSON.stringify(params)}`);return structuredClone(c.body.result);
 }});
 return {q,captured,delivery,prove:(tx:Row)=>proveSeiDelivery(port(tx),q.owner,delivery)};
}
test("sei QA-captured payout with a 63-digit s closes through the production destination proof",async()=>{
 const p=await shortScalarPayout();assert.equal(p.captured.s.length,65);assert.equal(p.captured.r.length,66);assert.equal(p.delivery.grossNative,true);
 const proof=await p.prove(p.captured);assert.equal(proof?.amount,p.q.netAtomic);assert.equal(proof?.status,"success");assert.equal(proof?.hash,p.captured.hash);
 assert.equal(BigInt(p.delivery.amount)-BigInt(p.q.netAtomic),BigInt(p.captured.gas)*BigInt(p.captured.gasPrice));
 // The 32-byte DATA form of the same s proves the same payout; only the digest of the raw RPC object differs.
 const padded=await p.prove({...p.captured,s:`0x${p.captured.s.slice(2).padStart(64,"0")}`});assert.deepEqual({...padded,transactionDigest:null},{...proof,transactionDigest:null});
});
for(const [name,change,reason] of [
 ["one-bit-changed s",(t:Row)=>({s:`0x${(BigInt(t.s)^1n).toString(16).padStart(64,"0")}`}),/sei_gaszip_native_signed_hash/],
 ["one-bit-changed r",(t:Row)=>({r:`0x${(BigInt(t.r)^1n).toString(16)}`}),/sei_gaszip_native_signed_hash/],
 ["zero s",()=>({s:"0x0"}),/sei_gaszip_native_signature_s/],
 ["zero-width s",()=>({s:`0x${"0".repeat(64)}`}),/sei_gaszip_native_signature_s/],
 ["non-hex s",()=>({s:`0x${"g".repeat(63)}`}),/sei_gaszip_native_signature_s/],
 ["empty r",()=>({r:"0x"}),/sei_gaszip_native_signature_r/],
 ["noncanonical leading-zero s",(t:Row)=>({s:`0x0${t.s.slice(3)}`}),/sei_gaszip_native_signature_s/],
 ["over-wide s",(t:Row)=>({s:`0x00${t.s.slice(2)}`}),/sei_gaszip_native_signature_s/],
 ["s at curve order",()=>({s:"0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"}),/sei_gaszip_native_signature_s/],
 ["other payout amount",(t:Row)=>({value:`0x${(BigInt(t.value)+1n).toString(16)}`}),/sei_gaszip_native_signed_hash/],
 ["63-digit transaction hash",(t:Row)=>({hash:`0x${t.hash.slice(3)}`}),/sei_gaszip_hash/],
] as const)test(`sei QA-captured short-scalar payout still refuses ${name}`,async()=>{
 const p=await shortScalarPayout();await assert.rejects(p.prove({...p.captured,...change(p.captured)}),reason);
});
