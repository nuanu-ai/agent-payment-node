import { Cleanup85NativePublicRecords } from "../../src/circle-cleanup85-native-records.js";
import { Cleanup85NativeCancellation } from "../../src/circle-cleanup85-native-cancellation.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction, serializeTransaction, type Hex } from "viem";
import { cleanup85Envelope, evmRpcSignatureScalar, validateCleanup85Envelope, verifyCleanup85Raw, verifyCleanup85Observation, verifyNativeCancellationRawFields, validateCleanup85Request, CLEANUP85_REQUEST, CLEANUP85_OWNER } from "../../src/circle-cleanup85-native-codec.js";
import type { CircleObservation } from "../../src/circle-v2-evm/protocol.js";
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
test("RPC signature scalars normalize canonical quantities and exact legacy words only",()=>{
 assert.equal(evmRpcSignatureScalar("0x1"),`0x${"0".repeat(63)}1`);
 assert.equal(evmRpcSignatureScalar(`0x${"1".repeat(63)}`),`0x${"0"}${"1".repeat(63)}`);
 assert.equal(evmRpcSignatureScalar(`0x${"f".repeat(64)}`),`0x${"f".repeat(64)}`);
 assert.equal(evmRpcSignatureScalar(`0x${"00".repeat(31)}01`),`0x${"00".repeat(31)}01`);
 assert.equal(evmRpcSignatureScalar(`0x${"AB".repeat(32)}`),`0x${"ab".repeat(32)}`);
 for(const value of [undefined,"0x01","0X01","0xA",`0x0${"1".repeat(62)}`,`0x1${"0".repeat(64)}`,`0x${"1".repeat(65)}`]) assert.throws(()=>evmRpcSignatureScalar(value));
});
test("signature scalar reconstruction verifies synthetic minimal quantity and refuses zero or out-of-range scalars",async()=>{
 const vectors=[
  {maxFee:45000027n,rNibbles:63,hash:"0xf9f3f4dfbb4c9a4a7e5d94f35839bae1cd1a1d0e290aa17c54b3892f8552f60e" as Hex},
  {maxFee:45000047n,rNibbles:62,hash:"0xb7cae0f879f2c1688549328d65ddaf60e307fc2ce285069a2de6f6416dc22e70" as Hex},
 ];
 let parsed63:ReturnType<typeof parseTransaction>|undefined,envelope63:ReturnType<typeof cleanup85Envelope>|undefined;
 for(const vector of vectors){
  const envelope=cleanup85Envelope("21470",vector.maxFee.toString(),"0"),raw=await account.signTransaction({...transaction,maxFeePerGas:vector.maxFee}),parsed=parseTransaction(raw);
  const r=`0x${BigInt(parsed.r!).toString(16)}` as Hex,s=`0x${BigInt(parsed.s!).toString(16)}` as Hex;
  assert.equal(r.length,vector.rNibbles+2);assert.equal(evmRpcSignatureScalar(r),parsed.r);assert.equal(evmRpcSignatureScalar(s),parsed.s);
  const unsigned={type:"eip1559" as const,chainId:parsed.chainId!,nonce:parsed.nonce!,to:parsed.to!,data:parsed.data!,value:parsed.value!,gas:parsed.gas!,maxFeePerGas:parsed.maxFeePerGas!,maxPriorityFeePerGas:parsed.maxPriorityFeePerGas!,accessList:parsed.accessList??[]};
  const reconstructed=serializeTransaction(unsigned,{r:evmRpcSignatureScalar(r),s:evmRpcSignatureScalar(s),yParity:parsed.yParity!});
  assert.equal(reconstructed,raw);assert.equal(keccak256(raw),vector.hash);assert.equal(await verifyNativeCancellationRawFields({...envelope,from:account.address},reconstructed),vector.hash);
  if(vector.rNibbles===63){parsed63=parsed;envelope63=envelope;}
 }
 assert.ok(parsed63&&envelope63);
 const parsed=parsed63!,envelope=envelope63!,unsigned={type:"eip1559" as const,chainId:parsed.chainId!,nonce:parsed.nonce!,to:parsed.to!,data:parsed.data!,value:parsed.value!,gas:parsed.gas!,maxFeePerGas:parsed.maxFeePerGas!,maxPriorityFeePerGas:parsed.maxPriorityFeePerGas!,accessList:parsed.accessList??[]};
 const oneNibble=serializeTransaction(unsigned,{r:evmRpcSignatureScalar("0x1"),s:parsed.s!,yParity:parsed.yParity!});
 await assert.rejects(verifyNativeCancellationRawFields({...envelope,from:account.address},oneNibble));
 const curveOrder=`0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141` as Hex;
 for(const signature of [{r:`0x${"0".repeat(64)}` as Hex,s:parsed.s!},{r:curveOrder,s:parsed.s!},{r:parsed.r!,s:curveOrder}]){
  const invalid=serializeTransaction(unsigned,{...signature,yParity:parsed.yParity!});
  await assert.rejects(verifyNativeCancellationRawFields({...envelope,from:account.address},invalid));
 }
});
test("finalized native observation parses quantity and exact-word signature encodings before sender verification",async()=>{
 const envelope=cleanup85Envelope("21470","45000027","0"),raw=await account.signTransaction({...transaction,maxFeePerGas:45000027n}),parsed=parseTransaction(raw),hash=keccak256(raw);
 const blockHash=keccak256("0x01"),blockNumber="0x1e960000",timestamp="0x6b000000",headHash=keccak256("0x02");
 const baseTx={hash,blockHash,blockNumber,from:CLEANUP85_OWNER,transactionIndex:"0x0",type:"0x2",chainId:"0xa4b1",nonce:"0x55",to:envelope.to,input:"0x",value:"0x1",gas:"0x53de",maxFeePerGas:"0x2aea55b",maxPriorityFeePerGas:"0x1",accessList:[],yParity:`0x${parsed.yParity!.toString(16)}`};
 const receipt={transactionHash:hash,blockHash,blockNumber,transactionIndex:"0x0",type:"0x2",status:"0x1",from:CLEANUP85_OWNER,to:envelope.to,gasUsed:"0x5208",effectiveGasPrice:"0x1",logs:[]};
 const block={hash:blockHash,number:blockNumber,timestamp,transactions:[hash]},head={hash:headHash,number:"0x1e960001",timestamp:"0x6b000001"};
 const observationFor=(r:string,s:string,patch:Record<string,unknown>={})=>({chainId:42161,finalityTag:"finalized",transaction:{...baseTx,r,s,...patch},receipt,canonicalBlock:block,recheckedBlock:block,finalityHead:head} as unknown as CircleObservation);
 const quantityR=`0x${BigInt(parsed.r!).toString(16)}`,quantityS=`0x${BigInt(parsed.s!).toString(16)}`;
 for(const [name,r,s] of [["quantity",quantityR,quantityS],["legacy word",parsed.r!,parsed.s!]] as const){
  await assert.rejects(verifyCleanup85Observation(envelope,hash,observationFor(r,s)),/signed_wire_binding/,name);
 }
 await assert.rejects(verifyCleanup85Observation(envelope,hash,observationFor(quantityR,quantityS,{input:"0x1"})),/malformed bytes/);
 await assert.rejects(verifyCleanup85Observation(envelope,hash,observationFor(quantityR,quantityS,{hash:"0x01"})),/malformed bytes/);
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
