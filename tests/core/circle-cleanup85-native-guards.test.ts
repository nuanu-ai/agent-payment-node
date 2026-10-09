import { Cleanup85NativePublicRecords } from "../../src/circle-cleanup85-native-records.js";
import { Cleanup85NativeCancellation } from "../../src/circle-cleanup85-native-cancellation.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, type Hex } from "viem";
import { cleanup85Envelope, validateCleanup85Envelope, verifyCleanup85Raw, verifyNativeCancellationRawFields, validateCleanup85Request, CLEANUP85_REQUEST } from "../../src/circle-cleanup85-native-codec.js";
import { assertCleanup85PhysicalGuard, withCleanup85NativeAuthority } from "../../src/circle-cleanup85-native-authority.js";
import { verifiedCleanup85NativeReservation, verifiedCleanup85NativeSettlement } from "../../src/circle-cleanup85-native-ledger-authority.js";
import { Cleanup85NativeRpc } from "../../src/circle-cleanup85-native-rpc.js";
import { cleanup85PublicTransport } from "./cleanup85-native-public-fixture.js";
import { ApnError } from "../../src/errors.js";
const account=privateKeyToAccount(`0x${"11".repeat(32)}`),e=cleanup85Envelope("21470","40024000","0");
const actualExpected={...e,from:account.address};
const transaction={type:"eip1559" as const,chainId:42161,to:e.to,value:1n,data:"0x" as Hex,nonce:85,gas:21470n,maxFeePerGas:45000000n,maxPriorityFeePerGas:1n,accessList:[]};
test("real viem signing roundtrip through pure production cryptographic comparator; fixed owner wrapper still refuses",async()=>{
 const raw=await account.signTransaction(transaction);assert.equal(await verifyNativeCancellationRawFields(actualExpected,raw),keccak256(raw));await assert.rejects(verifyCleanup85Raw(e,raw),/signed_wire_binding/);
});
for(const [name,change]of Object.entries({value:{value:0n},priority:{maxPriorityFeePerGas:0n},gas:{gas:21471n},fee:{maxFeePerGas:45000001n},nonce:{nonce:86},chain:{chainId:1},data:{data:"0x00"},to:{to:account.address},accessList:{accessList:[{address:account.address,storageKeys:[]}]}}))test(`actual signed wire ${name} mismatch refused`,async()=>{
 const raw=await account.signTransaction({...transaction,...change} as typeof transaction);await assert.rejects(verifyNativeCancellationRawFields(actualExpected,raw));
});
for(const [name,change]of Object.entries({nonce:{nonceAtomic:"84"},value:{valueAtomic:"0"},fee:{maxFeePerGasAtomic:"44999999"},priority:{maxPriorityFeePerGasAtomic:"0"},cap:{gasLimitAtomic:"44445"},sender:{from:account.address},data:{data:"0x00"},extra:{authorizationList:[]}}))test(`finite unsigned binding ${name} refused`,()=>{
 assert.throws(()=>validateCleanup85Envelope({...e,...change}));
});
test("caller clone cannot mint preSIGN or canonical settlement authority",()=>{
 assert.throws(()=>verifiedCleanup85NativeReservation({kind:"verified-cleanup85-native-reservation"},"/tmp/not-a-root"));assert.throws(()=>verifiedCleanup85NativeSettlement({kind:"verified-cleanup85-native-settlement"},"/tmp/not-a-root"));
});
test("fixed request rejects caller nonce or changed retained material",()=>{
 const r={...CLEANUP85_REQUEST,recoveryBinding:"1".repeat(64),parentIntentHash:"2".repeat(64)};assert.deepEqual(validateCleanup85Request(r),r);assert.throws(()=>validateCleanup85Request({...r,nonce:85}));assert.throws(()=>validateCleanup85Request({...r,oldCleanupMaterialHash:"3".repeat(64)}));
});
test("foreground absolute sixty-second TTL includes prompt, not a reset at successful consent",async()=>{
 let clock=1000,entered=0;await assert.rejects(withCleanup85NativeAuthority("binding",new Date(100000).toISOString(),()=>clock,async()=>{clock+=60000;},async()=>{entered++;}),/expired/);assert.equal(entered,0);
});
test("physical guard exact bytes, policy expiry, disposal and one-send fence",async()=>{
 let clock=1000,guard:()=>void=()=>{};const raw="0x0200" as Hex;
 await withCleanup85NativeAuthority("binding",new Date(100000).toISOString(),()=>clock,async()=>{},async a=>{
   a.assert("binding",new Date(5000).toISOString());guard=a.beforeSend("binding",raw,keccak256(raw));assertCleanup85PhysicalGuard(guard,raw);assert.throws(()=>assertCleanup85PhysicalGuard(guard,"0x0201"));guard();assert.throws(()=>a.beforeSend("binding",raw,keccak256(raw)));clock=5000;assert.throws(guard);
 });assert.throws(()=>assertCleanup85PhysicalGuard(guard,raw));assert.throws(guard);
});
test("native financial RPC refuses unbranded callback without any physical request",async()=>{
 let posts=0;const rpc=new Cleanup85NativeRpc("https://example.org",{request:async()=>{posts++;throw Error("network forbidden");}});await assert.rejects(rpc.call("eth_sendRawTransaction",["0x0200"],()=>{}));assert.equal(posts,0);
});
test("read-only transport bounded budget counts all rejected physical requests",async()=>{
 let posts=0;const rpc=new Cleanup85NativeRpc("https://example.org",{request:async()=>{posts++;return {status:429,body:""};}},2);await assert.rejects(rpc.call("eth_chainId",[]));await assert.rejects(rpc.call("eth_chainId",[]));await assert.rejects(rpc.call("eth_chainId",[]),/budget/);assert.equal(posts,2);
});
test("production transport CONFIG network deadline permits only one whole snapshot restart",async()=>{
 let posts=0;const rpc=new Cleanup85NativeRpc("https://example.org",{request:async()=>{posts++;throw new ApnError("APN_RPC_CONFIG","sanitized",{transportReason:"request_deadline"});}});
 await assert.rejects(rpc.snapshot());assert.equal(posts,2);assert.equal(rpc.physicalRequestCount,2);
});
test("arbitrary CONFIG protocol error cannot obtain a snapshot retry",async()=>{
 let posts=0;const rpc=new Cleanup85NativeRpc("https://example.org",{request:async()=>{posts++;throw new ApnError("APN_RPC_CONFIG","sanitized",{transportReason:"rpc_schema_changed"});}});
 await assert.rejects(rpc.snapshot());assert.equal(posts,1);
});
for(const [gas,accepted]of [[21805,true],[26165,true],[26166,false]] as const)test(`fresh raw gas${gas} ${accepted?"fits immutable signed gas":"exceeds immutable signed gas"}`,async()=>{
 const fixture=await cleanup85PublicTransport(),frozen=cleanup85Envelope("26165","40024000","0");
 const https:typeof fixture.https={request:async(...args)=>{const response=await fixture.https.request(...args),request=JSON.parse(args[2]!);return request.method==="eth_estimateGas"?{...response,body:JSON.stringify({jsonrpc:"2.0",id:request.id,result:`0x${gas.toString(16)}`})}:response;}};
 const rpc=new Cleanup85NativeRpc("https://arb1.arbitrum.io/rpc",https);
 if(accepted)assert.deepEqual((await rpc.snapshot(frozen)).envelope,frozen);else await assert.rejects(rpc.snapshot(frozen),/fresh_signed_envelope_inexecutable/);
});

for(const nonce of [86,87,90])test(`public finalized consumed-account replay accepts nonce${nonce} without reading present token balances`,async()=>{
 let calls:string[]=[];const head={number:"0x1e98aaaa",hash:`0x${"ab".repeat(32)}`,timestamp:"0x6bffff00",transactions:[]};
 const rpc=new Cleanup85NativeRpc("https://example.org",{request:async(_url,_method,body)=>{
   const request=JSON.parse(body!);calls.push(request.method);const result=request.method==="eth_getTransactionCount"?`0x${nonce.toString(16)}`:request.method==="eth_getBlockByNumber"?head:request.method==="eth_chainId"?"0xa4b1":null;
   return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:request.id,result})};
 }});
 await rpc.finalizedConsumedAccount({finalityHead:head} as Parameters<typeof rpc.finalizedConsumedAccount>[0]);assert.deepEqual(calls,["eth_getTransactionCount","eth_getBlockByNumber","eth_chainId"]);
});
test("public consumed-account replay rejects unconsumed nonce85",async()=>{
 const rpc=new Cleanup85NativeRpc("https://example.org",{request:async(_url,_method,body)=>{const r=JSON.parse(body!);return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:r.id,result:"0x55"})};}});
 await assert.rejects(rpc.finalizedConsumedAccount({finalityHead:{number:"0x1e98aaaa",hash:`0x${"ab".repeat(32)}`,timestamp:"0x6bffff00",transactions:[]}} as Parameters<typeof rpc.finalizedConsumedAccount>[0]),/finalized_consumed_nonce/);
});

test("permanent cancellation slot is create-only across clone, new policy and concurrent publication",async t=>{
 const state=await temporaryState();t.after(state.cleanup);const records=new Cleanup85NativePublicRecords(state.root),id=CLEANUP85_REQUEST.parentOperationId;
 const slot={version:"apn.cleanup85-single-cancellation.v1",parentOperationId:id,oldCleanupMaterialHash:CLEANUP85_REQUEST.oldCleanupMaterialHash,requestBinding:"1".repeat(64),operationId:"2".repeat(64),fingerprint:"3".repeat(64)};
 const outcomes=await Promise.allSettled([records.publish(id,"slot",slot),records.publish(id,"slot",{...slot,operationId:"4".repeat(64)})]);assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
 const frozen=await records.load(id,"slot");await assert.rejects(records.publish(id,"slot",{...slot,policyRevision:99}));assert.deepEqual(await records.load(id,"slot"),frozen);await records.publish(id,"slot",frozen);
});
test("public inspect absent operation needs neither active policy nor custody/key or physical RPC",async t=>{
 const state=await temporaryState();t.after(state.cleanup);let privateCalls=0,posts=0;
 const store=new StateStore(state.root);await store.initialize();
 const service=new Cleanup85NativeCancellation(store,{resolve:async()=>{privateCalls++;throw Error("private forbidden");}} as never,{APN_ARBITRUM_RPC_URL:"https://example.org"},{https:{request:async()=>{posts++;throw Error("network forbidden");}}});
 const status=await service.inspect({...CLEANUP85_REQUEST,recoveryBinding:"1".repeat(64),parentIntentHash:"2".repeat(64)});assert.equal(status.phase,"absent");assert.equal(privateCalls,0);assert.equal(posts,0);
});
test("production execute forged recovery request refuses before RPC, private custody or SIGN",async t=>{
 const state=await temporaryState();t.after(state.cleanup);let privateCalls=0,posts=0;
 const store=new StateStore(state.root);await store.initialize();
 const service=new Cleanup85NativeCancellation(store,{resolve:async()=>{privateCalls++;throw Error("private forbidden");}} as never,{APN_ARBITRUM_RPC_URL:"https://example.org",APN_SEI_RPC_URL:"https://example.com"},{https:{request:async()=>{posts++;throw Error("network forbidden");}}});
 await assert.rejects(service.execute({...CLEANUP85_REQUEST,recoveryBinding:"1".repeat(64),parentIntentHash:"2".repeat(64)}));assert.equal(privateCalls,0);assert.equal(posts,0);
});
