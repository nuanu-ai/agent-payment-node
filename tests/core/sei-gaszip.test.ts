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
import { LocalWalletNative } from "../../src/local-wallet-native.js";
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
 queueHook:()=>Promise<void>=async()=>{};tlsHook:()=>Promise<void>=async()=>{};guard:(()=>void)|undefined;l1=0n;estimate=21256n;nonce=0n;raw:Hex|null=null;sends=0;hidden=false;wrongData=false;operatorNonzero=false;reverted=false;feeOver=false;balance=100_000_000_000_000n;baseFee=5_000_000n;
 async call(m:string,p:readonly unknown[],guard?:()=>void):Promise<unknown>{
  if(m==="eth_chainId")return h(8453n);if(m==="eth_getBlockByNumber")return {hash:SOURCE_BLOCK,number:h(100n),baseFeePerGas:h(this.baseFee)};
  if(m==="eth_getCode")return "0x";if(m==="eth_getBalance")return h(this.balance);if(m==="eth_getTransactionCount")return h(this.nonce);
  if(m==="eth_estimateGas"){assert.equal((p[0] as {data:string}).data,SEI_FUNDING.data);assert.equal((p[0] as {to:string}).to,SEI_FUNDING.target);return h(this.estimate);}if(m==="eth_call")return `0x${(((p[0] as {data:string}).data.startsWith("0xf1c7a58b"))?this.l1:0n).toString(16).padStart(64,"0")}`;
  if(m==="eth_sendRawTransaction"){this.guard=guard;await this.queueHook();guard!();await this.tlsHook();guard!();this.sends++;this.raw=p[0] as Hex;return keccak256(this.raw);}
  if(m==="eth_getTransactionByHash" || m==="eth_getTransactionReceipt"){
   if(this.raw===null || this.hidden)return null;const tx=parseTransaction(this.raw),hash=keccak256(this.raw);
   const common={hash,transactionHash:hash,from:this.owner,to:SEI_FUNDING.target,blockHash:SOURCE_BLOCK,blockNumber:h(100n)};
   return m==="eth_getTransactionByHash"?{...common,chainId:h(8453n),input:this.wrongData?"0x":SEI_FUNDING.data,value:h(tx.value!),nonce:h(BigInt(tx.nonce!)),gas:h(tx.gas!),maxFeePerGas:h(tx.maxFeePerGas!),maxPriorityFeePerGas:h(tx.maxPriorityFeePerGas!)}:{...common,status:this.reverted?"0x0":"0x1",gasUsed:h(21256n),effectiveGasPrice:h(this.feeOver?1_000_000_000n:6_000_000n),l1Fee:"0x0",...(this.operatorNonzero?{operatorFeeScalar:"0x1",operatorFeeConstant:"0x0"}:{})};
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
 let screen="";const approval=new TtyAllowlistPolicyApproval({isTerminal:()=>true,openTerminal:async()=>({fd:11,write:async(s:string)=>{screen+=s;},read:async function*(){yield Buffer.from([...screen.matchAll(/Type ([a-f0-9]{6})/gu)].at(-1)![1]!+"\n");},close:async()=>{}})});
 const activated=await runCli(["allowlist","policy","activate","--profile","gaszip-test","--revision","1"],{},{stateRoot:temp.root,allowlistPolicyApproval:approval});assert.equal(activated.ok,true,JSON.stringify(activated.error));
 const source=new SyntheticSource();source.owner=owner;const destination=new SyntheticDestination(owner);let providerPending=false,approvals=0;
 const https={request:async(url:string)=>({status:200,body:url.includes("/quotes/")?quote(now):JSON.stringify(provider(owner,keccak256(source.raw!),providerPending?{status:"PENDING"}:{}))})};
 const service=new SeiFundingService(state,wrapping,{}, {https,source:()=>source,destination:()=>destination,approve:async()=>{approvals++;},now:()=>now});
 const input={profile:"gaszip-test",expectedPayer:owner,amountAtomic:"10000000000000",minimumOutputAtomic:"250000000000000000",maximumFeeAtomic:"1000000000000",idempotencyKey:"synthetic-gaszip-first"};
 return {temp,state,source,destination,service,input,owner,file,approval,wrapping,policyExpiry:now+3600000,setNow:(n:number)=>{now=n;},advance:()=>{now+=120000;},pending:()=>{providerPending=true;},approvals:()=>approvals};
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
 f.source.operatorNonzero=true;await assert.rejects(f.service.status(r.operationId),/base_operator_fee_unreviewed/);f.source.operatorNonzero=false;
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
 assert.throws(()=>assertSeiFundingFresh(r.plan,{...r.plan,nonce:"1"},r.maximumFeeAtomic));assert.throws(()=>assertSeiFundingFresh(r.plan,{...r.plan,l1FeeUpper:"1000000000001"},r.maximumFeeAtomic));
});

test("fresh lower fees cannot weaken the frozen signed envelope affordability check",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;
 f.source.baseFee=1_000_000n;f.source.balance=BigInt(r.amountAtomic)+BigInt(r.plan.feeUpper)-1n;
 await assert.rejects(f.service.approve(r.operationId),/source_balance_or_fee_cap/u);
 assert.equal(f.source.sends,0);assert.equal(f.source.raw,null);
 assert.equal((await f.service.status(r.operationId) as SeiFundingRecord).state,"prepared");
});

 test("policy expiry during awaited wallet read prevents the signing fence",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;
 const original=EncryptedWalletStore.prototype.describe;
 t.mock.method(EncryptedWalletStore.prototype,"describe",async function(this:EncryptedWalletStore,p:string){const loaded=await original.call(this,p);f.setNow(f.policyExpiry+1);return loaded;});
 await assert.rejects(f.service.approve(r.operationId));
 const saved=await new SeiFundingJournal(f.state.root).findOperation(r.operationId);assert.equal(saved?.state,"prepared");assert.equal(saved?.rawTransaction,null);assert.equal(f.source.sends,0);
 });
 for(const point of ["queueHook","tlsHook"] as const)test(`expiry at ${point} retains unknown fence and never sends again`,async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;f.source[point]=async()=>{f.advance();};
 await f.service.approve(r.operationId);const saved=await new SeiFundingJournal(f.state.root).findOperation(r.operationId);
 assert.equal(saved?.state,"unknown_finality");assert.equal(saved?.submissionAttempts,1);assert.equal(f.source.sends,0);
 assert.throws(()=>f.source.guard!());await f.service.approve(r.operationId);await f.service.status(r.operationId);assert.equal(f.source.sends,0);
 });
 test("legacy prepared activation absence preserves its hash and refuses foreground effects",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;const full=(await new SeiFundingJournal(f.state.root).findOperation(r.operationId))!;const {activationDigest:_,...legacy}=full;const sealed=sealSeiFunding(legacy);
 assert.equal(validateSeiFunding(sealed).integrityHash,sealed.integrityHash);
 const journal=new SeiFundingJournal(f.state.root);await journal.withLocks([`operation:${r.operationId}`],()=>journal.saveLocked(sealed));
 await assert.rejects(f.service.approve(r.operationId),/legacy_activation_missing/);assert.equal(f.source.sends,0);assert.equal(f.approvals(),0);
 });

 test("true allowlist revocation waits through the physical send and response",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;let revoked=false;let revocation:Promise<unknown>|undefined;
 f.source.queueHook=async()=>{revocation=runCli(["allowlist","policy","revoke","--profile","gaszip-test","--revision","1"],{},{stateRoot:f.temp.root,allowlistPolicyApproval:f.approval}).then(result=>{assert.equal(result.ok,true,JSON.stringify(result.error));revoked=true;});await new Promise(resolve=>setTimeout(resolve,40));assert.equal(revoked,false);};
 f.source.tlsHook=async()=>{assert.equal(revoked,false);};await f.service.approve(r.operationId);await revocation;assert.equal(revoked,true);assert.equal(f.source.sends,1);
 });
 test("revoke and reactivate same revision invalidates the frozen activation",async(t)=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;
 for(const action of ["revoke","activate"])assert.equal((await runCli(["allowlist","policy",action,"--profile","gaszip-test","--revision","1"],{},{stateRoot:f.temp.root,allowlistPolicyApproval:f.approval})).ok,true);
 await assert.rejects(f.service.approve(r.operationId),/policy_drift/);assert.equal(f.source.sends,0);assert.equal(f.approvals(),0);
 });

for(const change of ["decrease","increase"] as const)test(`unsigned dynamic L1 fee ${change} under caller cap preserves the signed envelope`,async t=>{
 const f=await setup(t);f.source.l1=5196823140n;const r=await f.service.prepare(f.input) as SeiFundingRecord;
 f.source.l1=change==="decrease"?5078223958n:205196823140n;f.source.baseFee=8_000_000n;f.source.estimate=22000n;
 await f.service.approve(r.operationId);assert.equal(f.source.sends,1);const tx=parseTransaction(f.source.raw!);
 assert.equal(tx.gas,BigInt(r.plan.gas));assert.equal(tx.maxFeePerGas,BigInt(r.plan.maxFee));assert.equal(tx.maxPriorityFeePerGas,BigInt(r.plan.tip));assert.equal(tx.nonce,Number(r.plan.nonce));assert.equal(tx.data,SEI_FUNDING.data);assert.equal(tx.value,BigInt(r.amountAtomic));
});
for(const drift of ["nonce","gas","minimum-price","L1-over-cap","full-reserve"] as const)test(`fresh ${drift} refuses before any signing or send claim`,async t=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;
 if(drift==="nonce")f.source.nonce=1n;if(drift==="gas")f.source.estimate=BigInt(r.plan.gas)+1n;if(drift==="minimum-price")f.source.baseFee=BigInt(r.plan.maxFee);if(drift==="L1-over-cap")f.source.l1=BigInt(r.maximumFeeAtomic);if(drift==="full-reserve")f.source.balance=BigInt(r.amountAtomic)+BigInt(r.maximumFeeAtomic)-1n;
 await assert.rejects(f.service.approve(r.operationId));assert.equal(f.source.sends,0);const repo=new SeiFundingJournal(f.state.root);const saved=(await repo.findOperation(r.operationId))!;assert.equal(saved.state,"prepared");assert.equal(saved.rawTransaction,null);await repo.assertNoEffectClaimsLocked(saved);
});

test("normal direct Base prepare cannot interleave the held caller fee reserve",async t=>{
 const f=await setup(t),r=await f.service.prepare(f.input) as SeiFundingRecord;
 const other=await runCli(["pay","transfer","prepare","--profile","gaszip-test","--idempotency-key","other-normal-base-money","--to",f.owner,"--amount-usdc","0.01","--rpc-url","https://mainnet.base.org"],{},{stateRoot:f.temp.root,wrappingSecret:f.wrapping});
 assert.equal(other.ok,false);assert.equal(other.error?.code,"APN_OPERATION_BLOCKED");assert.equal(other.error?.details?.blockingOperationId,r.operationId);assert.equal(f.source.sends,0);
 f.source.queueHook=async()=>{const state=new StateStore(f.temp.root);Object.assign(state,{lockWaitMs:0});const native=new LocalWalletNative(state,f.wrapping);await assert.rejects(native.request({version:"apn.native.v1",requestId:"synthetic-gaszip-custody",operation:"wallet.describe",payload:{profile:"gaszip-test"}}),{code:"APN_STATE_BUSY"});};
 await f.service.approve(r.operationId);assert.equal(f.source.sends,1);
});
