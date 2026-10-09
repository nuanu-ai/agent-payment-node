/** SYNTHETIC protocol/RPC vectors. These tests never claim live funding or paid acceptance. */
import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseTransaction, keccak256, type Hex } from "viem";
import { temporaryState } from "./helpers.js";
import { StateStore } from "../../src/state.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { TtyAllowlistPolicyApproval } from "../../src/allowlist-policy-activation.js";
import { runCli } from "../../src/cli.js";
import { OperationService } from "../../src/operation-service.js";
import { SEI_FUNDING, inspectSeiFundingQuote, inspectSeiDelivery, seiJson } from "../../src/lifi/sei-gaszip-contract.js";
import { SeiFundingJournal, sealSeiFunding, validateSeiFunding, type SeiFundingRecord } from "../../src/lifi/sei-gaszip-journal.js";
import { SeiFundingService } from "../../src/lifi/sei-gaszip-service.js";
import { assertSeiFundingFresh, proveSeiSafeTransaction, type SeiRpcPort } from "../../src/lifi/sei-gaszip-rpc.js";
const SOURCE_BLOCK=`0x${"1".repeat(64)}` as Hex,DEST_BLOCK=`0x${"2".repeat(64)}` as Hex,PREV_BLOCK=`0x${"3".repeat(64)}` as Hex,DEST_HASH=`0x${"4".repeat(64)}` as Hex;
const SIGNER="0x2222222222222222222222222222222222222222",OUTPUT="358965737575087424";
const h=(v:bigint):Hex=>`0x${v.toString(16)}`;
function quote(now:number){return `{"calldata":"0x0100f6","expires":${Math.floor(now/1000)+60},"quotes":[{"chain":1329,"decimals":18,"expected":${OUTPUT},"expectedNative":${OUTPUT},"gas":1155000000000000,"speed":10.0,"usd":0.0241}]}`;}
test("lossless numeric lexemes retain native outputs and quote expiry; unsafe already-rounded values refuse",()=>{
 const now=Date.now(),q=inspectSeiFundingQuote(seiJson(quote(now)),now);assert.equal(q.expectedAtomic,OUTPUT);
 assert.throws(()=>inspectSeiFundingQuote(JSON.parse(quote(now)),now));
 for(const changed of [quote(now).replace("0x0100f6","0x010039"),quote(now).replace('"chain":1329','"chain":1'),quote(now).replace(OUTPUT,"249999999999999999"),quote(now).replace(String(Math.floor(now/1000)+60),String(Math.floor(now/1000)-1))])assert.throws(()=>inspectSeiFundingQuote(seiJson(changed),now));
});
function provider(owner:string,hash:Hex,changes:Record<string,unknown>={}){return {deposit:{block:"100",chain:"8453",hash,log:"0",sender:owner,shorts:["246"],status:"CONFIRMED",time:"1",to:owner,usd:0.02,value:"10000000000000"},txs:[{chain:"1329",hash:DEST_HASH,nonce:"7",refund:false,cancelled:false,signer:SIGNER,status:"CONFIRMED",time:"2",to:owner,usd:0.02,value:OUTPUT,...changes}]};}
test("provider mapping refuses alternate source, destination, refunds, missing or ambiguous delivery",()=>{
 const owner=SIGNER,source=`0x${"9".repeat(64)}` as Hex;assert.equal(inspectSeiDelivery(provider(owner,source),source,owner,"10000000000000")?.amount,OUTPUT);
 for(const changed of [{refund:true},{cancelled:true},{to:SEI_FUNDING.target},{value:"1"}])assert.throws(()=>inspectSeiDelivery(provider(owner,source,changed),source,owner,"10000000000000"));
 const ambiguous=provider(owner,source);ambiguous.txs.push(ambiguous.txs[0]!);assert.throws(()=>inspectSeiDelivery(ambiguous,source,owner,"10000000000000"));
 assert.throws(()=>inspectSeiDelivery(provider(owner,source),DEST_HASH,owner,"10000000000000"));
 assert.equal(inspectSeiDelivery(provider(owner,source,{status:"PENDING"}),source,owner,"10000000000000"),null);
});
class SyntheticSource implements SeiRpcPort {
 raw:Hex|null=null;sends=0;hidden=false;wrongData=false;reverted=false;feeOver=false;balance=100_000_000_000_000n;baseFee=5_000_000n;
 async call(m:string,p:readonly unknown[]):Promise<unknown>{
  if(m==="eth_chainId")return h(8453n);if(m==="eth_getBlockByNumber")return {hash:SOURCE_BLOCK,number:h(100n),baseFeePerGas:h(this.baseFee)};
  if(m==="eth_getCode")return "0x";if(m==="eth_getBalance")return h(this.balance);if(m==="eth_getTransactionCount")return "0x0";
  if(m==="eth_estimateGas")return h(21256n);if(m==="eth_call")return "0x0";
  if(m==="eth_sendRawTransaction"){this.sends++;this.raw=p[0] as Hex;return keccak256(this.raw);}
  if(m==="eth_getTransactionByHash" || m==="eth_getTransactionReceipt"){
   if(this.raw===null || this.hidden)return null;const tx=parseTransaction(this.raw),hash=keccak256(this.raw);
   const common={hash,transactionHash:hash,from:this.owner,to:SEI_FUNDING.target,blockHash:SOURCE_BLOCK,blockNumber:h(100n)};
   return m==="eth_getTransactionByHash"?{...common,chainId:h(8453n),input:this.wrongData?"0x":SEI_FUNDING.data,value:h(tx.value!),nonce:h(BigInt(tx.nonce!)),gas:h(tx.gas!),maxFeePerGas:h(tx.maxFeePerGas!),maxPriorityFeePerGas:h(tx.maxPriorityFeePerGas!)}:{...common,status:this.reverted?"0x0":"0x1",gasUsed:h(21256n),effectiveGasPrice:h(this.feeOver?1_000_000_000n:6_000_000n),l1Fee:"0x0"};
  }throw new Error(m);
 }
 owner="";
}
class SyntheticDestination implements SeiRpcPort {
 hidden=false;wrongAmount=false;balanceDrift=false;
 constructor(readonly owner:string){}
 async call(m:string,p:readonly unknown[]):Promise<unknown>{
  if(m==="eth_chainId")return h(1329n);
  if(m==="eth_getBlockByNumber")return {hash:p[0]===h(99n)?PREV_BLOCK:DEST_BLOCK,number:h(100n)};
  if(m==="eth_getCode")return "0x";
  if(m==="eth_getBalance")return (p[1] as {blockHash:Hex}).blockHash===PREV_BLOCK?"0x0":h(BigInt(OUTPUT)+(this.balanceDrift?1n:0n));
  if(m==="eth_getTransactionByHash" || m==="eth_getTransactionReceipt"){
   if(this.hidden)return null;const common={hash:DEST_HASH,transactionHash:DEST_HASH,from:SIGNER,to:this.owner,blockHash:DEST_BLOCK,blockNumber:h(100n)};
   return m==="eth_getTransactionByHash"?{...common,chainId:h(1329n),input:"0x",value:h(BigInt(OUTPUT)+(this.wrongAmount?1n:0n)),nonce:h(7n)}:{...common,status:"0x1"};
  }throw new Error(m);
 }
}
async function setup(t:test.TestContext){
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root);let now=Date.now();
 await state.initialize();
 const wrapping={load:async()=>Buffer.alloc(32,1),create:async()=>Buffer.alloc(32,1)};
 const ensured=await runCli(["wallet","ensure","--profile","gaszip-test"],{},{stateRoot:temp.root,wrappingSecret:wrapping});assert.equal(ensured.ok,true,JSON.stringify(ensured.error));
 const owner=(ensured.data as {address:string}).address;
 const file=join(temp.base,"policy.json");await writeFile(file,JSON.stringify({schemaVersion:"apn.allowlist-policy-file.v1",overlayVersion:"synthetic.gaszip.1",accounts:{evm:owner},effectiveAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),admissions:[{chain:"eip155:8453",kind:"native",rail:"bridge",maximumPerTransferAtomic:"10000000000000",dailyLimitAtomic:"20000000000000",mechanism:SEI_FUNDING.mechanism}]}),{mode:0o600});
 const staged=await runCli(["allowlist","policy","stage","--profile","gaszip-test","--file",file],{},{stateRoot:temp.root});assert.equal(staged.ok,true,JSON.stringify(staged.error));
 let screen="";const approval=new TtyAllowlistPolicyApproval({isTerminal:()=>true,openTerminal:async()=>({fd:11,write:async(s:string)=>{screen+=s;},read:async function*(){yield Buffer.from(/Type ([a-f0-9]{6})/u.exec(screen)![1]!+"\n");},close:async()=>{}})});
 const activated=await runCli(["allowlist","policy","activate","--profile","gaszip-test","--revision","1"],{},{stateRoot:temp.root,allowlistPolicyApproval:approval});assert.equal(activated.ok,true,JSON.stringify(activated.error));
 const source=new SyntheticSource();source.owner=owner;const destination=new SyntheticDestination(owner);let providerPending=false,approvals=0;
 const https={request:async(url:string)=>({status:200,body:url.includes("/quotes/")?quote(now):JSON.stringify(provider(owner,keccak256(source.raw!),providerPending?{status:"PENDING"}:{}))})};
 const service=new SeiFundingService(state,wrapping,{}, {https,source:()=>source,destination:()=>destination,approve:async()=>{approvals++;},now:()=>now});
 const input={profile:"gaszip-test",expectedPayer:owner,amountAtomic:"10000000000000",minimumOutputAtomic:"250000000000000000",maximumFeeAtomic:"1000000000000",idempotencyKey:"synthetic-gaszip-first"};
 return {temp,state,source,destination,service,input,owner,advance:()=>{now+=120000;},pending:()=>{providerPending=true;},approvals:()=>approvals};
}
test("shared preparation conflict, exact foreground-sign-once/send-once and terminal correlated delivery",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;assert.equal(r.state,"prepared");assert.equal(f.source.sends,0);
 await assert.rejects(new OperationService(f.state).assertEvmAccountAvailable(r.profileHash,8453,f.owner));
 await new OperationService(f.state).assertEvmAccountAvailable(r.profileHash,1,f.owner);
 assert.equal((await f.service.prepare(f.input) as SeiFundingRecord).operationId,r.operationId);
 await assert.rejects(f.service.prepare({...f.input,amountAtomic:"9999999999999"}));
 await f.service.approve(r.operationId);assert.equal(f.source.sends,1);assert.equal(f.approvals(),1);
 await f.service.approve(r.operationId);assert.equal(f.source.sends,1);assert.equal(f.approvals(),1);
 const done=await f.service.status(r.operationId) as SeiFundingRecord;assert.equal(done.state,"completed");assert.equal(done.terminal,true);assert.ok(done.destinationProof);assert.equal(f.source.sends,1);
 await f.service.status(r.operationId);await new OperationService(f.state).assertEvmAccountAvailable(r.profileHash,8453,f.owner);
 const repo=new SeiFundingJournal(f.state.root);await assert.rejects(repo.withLocks(["sei-gaszip:destination-claims"],()=>repo.claimDestinationLocked(DEST_HASH,"a".repeat(64))));
});
test("expired unsigned operation retires without signature, send or hold",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;f.advance();const ended=await f.service.status(r.operationId) as SeiFundingRecord;
 assert.equal(ended.state,"failed_before_effect");assert.ok(ended.usageReservationId);assert.equal(f.source.sends,0);assert.equal(f.approvals(),0);
});
test("unknown source and missing correlated delivery remain held and never resend",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;await f.service.approve(r.operationId);f.source.hidden=true;
 assert.equal((await f.service.status(r.operationId) as SeiFundingRecord).terminal,false);await f.service.approve(r.operationId);assert.equal(f.source.sends,1);
 f.source.hidden=false;f.pending();assert.equal((await f.service.status(r.operationId) as SeiFundingRecord).terminal,false);assert.equal(f.source.sends,1);
});
test("source calldata/actual-fee drift and destination amount/delta drift cannot finalize",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;await f.service.approve(r.operationId);
 f.source.wrongData=true;await assert.rejects(f.service.status(r.operationId));f.source.wrongData=false;
 f.source.feeOver=true;await assert.rejects(f.service.status(r.operationId));f.source.feeOver=false;
 f.destination.wrongAmount=true;await assert.rejects(f.service.status(r.operationId));f.destination.wrongAmount=false;
 f.destination.balanceDrift=true;await assert.rejects(f.service.status(r.operationId));assert.equal((await new SeiFundingJournal(f.state.root).findOperation(r.operationId))?.terminal,false);assert.equal(f.source.sends,1);
});
test("safe confirmed source revert releases only principal after independent receipt proof",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;await f.service.approve(r.operationId);f.source.reverted=true;
 assert.equal((await f.service.status(r.operationId) as SeiFundingRecord).state,"failed_confirmed_revert");assert.equal(f.source.sends,1);
});
test("tampered immutable envelope and excessive post-approval fees refuse",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;
 assert.throws(()=>validateSeiFunding({...r,amountAtomic:"1"}));assert.throws(()=>sealSeiFunding({...r,amountAtomic:"10000000000001"}));
 assert.throws(()=>assertSeiFundingFresh(r.plan,{...r.plan,nonce:"1"}));assert.throws(()=>assertSeiFundingFresh(r.plan,{...r.plan,feeUpper:"1000000000001"}));
});

test("fresh lower fees cannot weaken the frozen signed envelope affordability check",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;
 f.source.baseFee=1_000_000n;f.source.balance=BigInt(r.amountAtomic)+BigInt(r.plan.feeUpper)-1n;
 await assert.rejects(f.service.approve(r.operationId),/source_balance_or_fee_cap/u);
 assert.equal(f.source.sends,0);assert.equal(f.source.raw,null);
 assert.equal((await f.service.status(r.operationId) as SeiFundingRecord).state,"prepared");
});
