import assert from "node:assert/strict";
import test from "node:test";
import https from "node:https";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate as tick } from "node:timers/promises";
import { keccak256, type Hex } from "viem";
import { BridgeHttps } from "../../src/lifi/https.js";
import { withGaszipForegroundAuthority } from "../../src/lifi/gaszip-authority.js";
const raw="0x010203" as Hex;
async function until(p:()=>boolean){for(let i=0;i<1000&&!p();i++)await tick();assert.ok(p());}
function wire(t:test.TestContext){const requests:any[]=[];t.mock.method(https,"request",(_url:any,_options:any,callback:any)=>{
 const req=new EventEmitter() as any,socket=new EventEmitter() as any;socket.remoteAddress="8.8.8.8";
 const row={ends:0,tls(){req.emit("socket",socket);socket.emit("secureConnect");},respond(){const response=new EventEmitter() as any;response.statusCode=200;response.headers={};callback(response);response.emit("data",Buffer.from("{}"));response.emit("end");}};
 req.end=()=>{row.ends++;};req.destroy=()=>{queueMicrotask(()=>req.emit("error",Error("synthetic")));};requests.push(row);return req;
 });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});return requests;}
for(const stage of ["DNS","TLS","queue"] as const)test(`actual BridgeHttps ${stage} expiration never calls request.end for the guarded POST`,async t=>{
 const requests=wire(t);let now=1000;const bridge=new BridgeHttps(async()=>{if(stage==="DNS")now=2000;return [{address:"8.8.8.8",family:4}];});
 await withGaszipForegroundAuthority("b",new Date(2000).toISOString(),()=>now,async()=>{},async authority=>{
 const guard=authority.beforeSend("b",raw,keccak256(raw));
 if(stage==="DNS"){await assert.rejects(bridge.request("https://rpc.example.com","POST",raw,1024,"APN_RPC_CONFIG",guard));assert.equal(requests.length,0);return;}
 let first:Promise<unknown>|undefined,second:Promise<unknown>|undefined;
 if(stage==="queue"){first=bridge.request("https://rpc.example.com","GET",null,1024,"APN_RPC_CONFIG");second=bridge.request("https://rpc.example.com","GET",null,1024,"APN_RPC_CONFIG");await until(()=>requests.length===2);}
 const sending=bridge.request("https://rpc.example.com","POST",raw,1024,"APN_RPC_CONFIG",guard);const rejected=assert.rejects(sending);
 if(stage==="TLS"){await until(()=>requests.length===1);assert.equal(requests[0].ends,0);now=2000;requests[0].tls();}
 else{now=2000;requests[0].respond();requests[1].respond();await Promise.all([first,second]);}
 await rejected;assert.equal(requests.length,stage==="TLS"?1:2);if(stage==="TLS")assert.equal(requests[0].ends,0);
 });
});
