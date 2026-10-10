import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { decodeSolanaRpcBody, solanaRpcHttpResponse } from "../../src/solana/https-body.js";
import { SolanaRpc, SolanaRpcBudget } from "../../src/solana/rpc.js";
const LIMIT=2_097_152;
test("compressed RPC preserves exact JSON bytes and u64 values for the real parser",()=>{
 const bytes=Buffer.from('{"context":{"slot":454312631},"value":{"rentEpoch":18446744073709551615,"data":["AQ==","base64"]}}');
 const decoded=decodeSolanaRpcBody(gzipSync(bytes),"gzip");assert.deepEqual(decoded,bytes);
 const result=parseJsonWithBigInts(decoded.toString()) as any;assert.equal(result.value.rentEpoch,18446744073709551615n);
 assert.deepEqual(result.value.data,["AQ==","base64"]);
});
for(const encoding of [undefined,"identity"])test(`uncompressed RPC retains the existing ${String(encoding)} body`,()=>{
 const bytes=Buffer.from('{"value":null}');assert.deepEqual(decodeSolanaRpcBody(bytes,encoding),bytes);
});
test("exact decoded response limit is accepted",()=>{
 const bytes=Buffer.alloc(LIMIT,0x61);assert.deepEqual(decodeSolanaRpcBody(gzipSync(bytes),"gzip"),bytes);
});
test("small compressed bomb exceeds the decoded limit and is refused",()=>{
 const packed=gzipSync(Buffer.alloc(LIMIT+1));assert.ok(packed.length<4096);
 assert.throws(()=>decodeSolanaRpcBody(packed,"gzip"),{code:"APN_RPC_PROTOCOL"});
});
test("wire response limit remains enforced before decoding",()=>{
 assert.throws(()=>decodeSolanaRpcBody(Buffer.alloc(LIMIT+1),"identity"),{code:"APN_RPC_PROTOCOL"});
});
test("truncated gzip is refused",()=>{
 const packed=gzipSync(Buffer.from("body"));assert.throws(()=>decodeSolanaRpcBody(packed.subarray(0,packed.length-1),"gzip"),{code:"APN_RPC_PROTOCOL"});
});
test("corrupt gzip checksum is refused",()=>{
 const packed=gzipSync(Buffer.from("body"));packed[packed.length-8]=packed[packed.length-8]!^1;
 assert.throws(()=>decodeSolanaRpcBody(packed,"gzip"),{code:"APN_RPC_PROTOCOL"});
});
for(const encoding of ["br","deflate","gzip, gzip",["gzip"]])test(`unsupported RPC encoding ${String(encoding)} is refused`,()=>{
 assert.throws(()=>decodeSolanaRpcBody(Buffer.from("body"),encoding),{code:"APN_RPC_PROTOCOL"});
});
test("a bounded gzip HTTP 429 reaches RPC cooldown classification after one POST",async()=>{
 let posts=0;
 const rpc=new SolanaRpc("https://rpc.example.test",async()=>{posts++;return solanaRpcHttpResponse(gzipSync(Buffer.from('{"error":"rate limited"}')),{statusCode:429,contentType:"application/json",contentEncoding:"gzip",retryAfter:"10"});},new SolanaRpcBudget({maxPhysicalRequests:1}));
 await assert.rejects(rpc.call("getGenesisHash",[]),{code:"APN_RPC_RATE_LIMITED",details:{retryAfterMs:10000}});assert.equal(posts,1);
});
test("successful HTTP evidence preserves the decoded bytes and drops irrelevant retry headers",async()=>{
 const bytes=Buffer.from('{"value":18446744073709551615}');const response=solanaRpcHttpResponse(gzipSync(bytes),{statusCode:200,contentType:"application/json",contentEncoding:"gzip",retryAfter:"10"});
 assert.equal(response.status,200);assert.equal(response.headers.get("retry-after"),null);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
});
for(const statusCode of [undefined,301,403,500])test(`HTTP ${String(statusCode)} cannot become success or cooldown evidence`,()=>{
 assert.throws(()=>solanaRpcHttpResponse(Buffer.from('{}'),{statusCode,contentType:"application/json",contentEncoding:undefined,retryAfter:"10"}),{code:"APN_RPC_PROTOCOL"});
});
test("HTML and invalid compressed cooldown responses remain fail closed",()=>{
 assert.throws(()=>solanaRpcHttpResponse(Buffer.from('{}'),{statusCode:429,contentType:"text/html",contentEncoding:undefined,retryAfter:"10"}),{code:"APN_RPC_PROTOCOL"});
 assert.throws(()=>solanaRpcHttpResponse(Buffer.from('invalid gzip'),{statusCode:429,contentType:"application/json",contentEncoding:"gzip",retryAfter:"10"}),{code:"APN_RPC_PROTOCOL"});
});
