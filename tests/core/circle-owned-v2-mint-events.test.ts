import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getAddress, toEventSelector, toFunctionSelector, type Address, type Hex } from "viem";
import { canonicalJson } from "../../src/canonical.js";
import { CircleRpc } from "../../src/circle-v2-evm/rpc.js";
import { readCircleMintFeeRecipient } from "../../src/circle-v2-evm/mint-fee-recipient.js";
import { decodeCircleDestination, bindCircleAttestation, decodeCircleSource, encodeCircleMint, circleWord, type CircleAttestation, type CircleObservation, type CircleSourceProof } from "../../src/circle-v2-evm/protocol.js";
import { CIRCLE_RECIPIENT, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { event, observation, source, iris, message, snapshot } from "./circle-v2-evm-runtime-fixtures.js";
interface Fixture { source: CircleSourceProof; attestation: CircleAttestation; observation: CircleObservation; feeRecipient: Address; captures: { request: {method:string;params:unknown[]}; result:unknown }[]; }
const load = async () => JSON.parse(await readFile("tests/fixtures/circle-owned-v2/linea-public-mint.json", "utf8")) as Fixture;
function logs(f:Fixture):Record<string,any>[] {return (f.observation.receipt as {logs:Record<string,any>[]}).logs;}
function rpc(f:Fixture, change?:(method:string,result:any,params:unknown[])=>unknown){ const sent:{method:string;params:unknown[]}[]=[];
 const transport={request:async(_url:string,_method:unknown,body:string|null)=>{const r=JSON.parse(body!),capture=f.captures.find(c=>c.request.method===r.method&&canonicalJson(c.request.params)===canonicalJson(r.params));assert.ok(capture,`unexpected RPC ${body}`);sent.push(r);return{status:200,body:JSON.stringify({jsonrpc:"2.0",id:r.id,result:change?change(r.method,structuredClone(capture.result),r.params):capture.result})};}};
 return{rpc:new CircleRpc("https://rpc.linea.build",59144,transport as never),sent};}
test("actual untouched Linea V2 receipt decodes through owned production path with authenticated historical issuer",async()=>{
 const f=await load(),before=canonicalJson(f),r=rpc(f),issuer=await readCircleMintFeeRecipient(r.rpc,f.observation);
 assert.equal(issuer,f.feeRecipient);const p=decodeCircleDestination(f.source,f.attestation,f.observation,"1",undefined,issuer);
 assert.equal(p.transactionHash,"0x014921c17c1f86407f2cb92b8f62169e76144ff08a18a7d3068b078194947a45");assert.equal(p.amountAtomic,"40095");assert.equal(p.finalityTag,"safe");assert.equal(f.attestation.feeExecutedAtomic,"5");assert.equal(canonicalJson(f),before);
 for(const c of r.sent.filter(c=>["eth_call","eth_getCode","eth_getStorageAt"].includes(c.method)))assert.deepEqual(c.params.at(-1),{blockHash:p.blockHash,requireCanonical:true});
 assert.ok(!r.sent.some(c=>/send|sign|estimate/i.test(c.method)));
});
for(const variant of ["recipient","token","fee","net","issuer","extra","duplicate","missing","oldABI","trailingABI","caller","attestation","finality"] as const)test(`actual V2 production decoder refuses ${variant}`,async()=>{
 const f=await load(),l=logs(f),mint=l[4]!,net=l[1]!,fee=l[3]!;
 if(variant==="recipient")net.topics[2]=circleWord(f.feeRecipient);
 if(variant==="token")fee.address=CIRCLE_MESSENGER;
 if(variant==="fee")fee.data=`0x${"00".repeat(31)}06`;
 if(variant==="net")net.data=`0x${(40094n).toString(16).padStart(64,"0")}`;
 if(variant==="issuer")fee.topics[2]=circleWord(CIRCLE_RECIPIENT);
 if(variant==="extra")l.push({...structuredClone(fee),logIndex:"0xff"});
 if(variant==="duplicate")l.push(structuredClone(net));
 if(variant==="missing")l.splice(3,1);
 if(variant==="oldABI"){mint.topics[0]=toEventSelector("MintAndWithdraw(address,uint256,address)");mint.data=mint.data.slice(0,66);}
 if(variant==="trailingABI")mint.data+="00".repeat(32);
 if(variant==="caller")l[5]!.topics[1]=circleWord(f.feeRecipient);
 if(variant==="attestation")f.attestation={...f.attestation,feeExecutedAtomic:"6"};
 if(variant==="finality")f.observation={...f.observation,finalityTag:"included"};
 assert.throws(()=>decodeCircleDestination(f.source,f.attestation,f.observation,"1",undefined,f.feeRecipient));
});
test("nonzero V2 fee requires authenticated issuer; foreign getter/code/reanchor fail closed",async()=>{
 const f=await load();assert.throws(()=>decodeCircleDestination(f.source,f.attestation,f.observation,"1"),/fee_recipient_required/);
 for(const variant of ["getter","configuration","code","reanchor"]){const r=rpc(f,(method,result,params)=>method==="eth_call"&&(variant==="configuration"||variant==="getter"&&(params[0] as {data:string}).data===toFunctionSelector("feeRecipient()"))?`0x${"00".repeat(32)}`:method==="eth_getCode"&&variant==="code"?"0x00":method==="eth_getBlockByNumber"&&variant==="reanchor"?{...result,hash:`0x${"11".repeat(32)}`}:result);await assert.rejects(readCircleMintFeeRecipient(r.rpc,f.observation));}
});
test("pinned V2 zero fee requires four-argument aggregate and exactly one principal mint",async()=>{
 const src=decodeCircleSource(source(59144),59144),a=await bindCircleAttestation(src,await iris(src,message(59144,true,0n)),snapshot(59144)),route=circleRoute(59144);
 const l=[event("Transfer",route.token,{from:getAddress(`0x${"00".repeat(20)}`),to:CIRCLE_RECIPIENT,value:40100n},0),event("MintAndWithdraw",CIRCLE_MESSENGER,{mintRecipient:CIRCLE_RECIPIENT,amount:40100n,mintToken:route.token,feeCollected:0n},1),event("MessageReceived",CIRCLE_TRANSMITTER,{caller:route.gasPayer,sourceDomain:3,nonce:a.nonce,sender:circleWord(CIRCLE_MESSENGER),finalityThresholdExecuted:1000,messageBody:a.body},2)];
 const o=observation(59144,route.gasPayer,CIRCLE_TRANSMITTER,encodeCircleMint(a),l);assert.equal(decodeCircleDestination(src,a,o,"1").amountAtomic,"40100");
 l[1]!.topics[0]=toEventSelector("MintAndWithdraw(address,uint256,address)");l[1]!.data=l[1]!.data.slice(0,66) as Hex;assert.throws(()=>decodeCircleDestination(src,a,o,"1"),/version/);
});
