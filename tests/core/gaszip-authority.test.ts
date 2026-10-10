import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, type Hex } from "viem";
import { withGaszipForegroundAuthority } from "../../src/lifi/gaszip-authority.js";
import { SeiFundingRpc } from "../../src/lifi/sei-gaszip-rpc.js";
import { MegaFundingRpc } from "../../src/lifi/mega-gaszip-rpc.js";
const raw="0x010203" as Hex;
for(const Rpc of [SeiFundingRpc,MegaFundingRpc])test(`${Rpc.name} requires live exact-payload foreground authority`,async()=>{
 let posts=0,guard:(()=>void)|undefined;const rpc=new Rpc("https://rpc.example.com",{request:async(_u,_m,body,_max,_code,beforeSend)=>{beforeSend!();beforeSend!();posts++;return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:JSON.parse(body!).id,result:keccak256(raw)})};}});
 await assert.rejects(rpc.call("eth_sendRawTransaction",[raw]));await assert.rejects(rpc.call("eth_sendRawTransaction",[raw],()=>{}));assert.equal(posts,0);
 let confirms=0;await withGaszipForegroundAuthority("binding",new Date(Date.now()+60000).toISOString(),Date.now,async()=>{confirms++;},async authority=>{
 guard=authority.beforeSend("binding",raw,keccak256(raw));await assert.rejects(rpc.call("eth_sendRawTransaction",["0x04"],guard));await assert.rejects(rpc.call("eth_sendRawTransaction",[raw,raw],guard));
 await rpc.call("eth_sendRawTransaction",[raw],guard);await assert.rejects(rpc.call("eth_sendRawTransaction",[raw],guard));assert.throws(()=>authority.beforeSend("binding",raw,keccak256(raw)));});
 assert.equal(posts,1);assert.equal(confirms,1);assert.throws(()=>guard!());await assert.rejects(rpc.call("eth_sendRawTransaction",[raw],guard));
});
test("foreground proof and activation deadlines refuse expired or rebound capability",async()=>{
 let now=1000;await withGaszipForegroundAuthority("b",new Date(100000).toISOString(),()=>now,async()=>{},async authority=>{
 authority.assert("b",new Date(1001).toISOString());const guard=authority.beforeSend("b",raw,keccak256(raw));now=1001;assert.throws(guard);now=1000;assert.throws(guard);});
 await withGaszipForegroundAuthority("b",new Date(100000).toISOString(),()=>now,async()=>{},async authority=>{now+=60000;assert.throws(()=>authority.assert("b"));});
});
