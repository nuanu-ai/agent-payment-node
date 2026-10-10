import assert from "node:assert/strict";
import test from "node:test";
import { bridgeRpcCall, RpcReadSession } from "../../src/lifi/rpc.js";
import { isHistoricalStateRead } from "../../src/lifi/rpc-archive.js";
import { ApnError } from "../../src/errors.js";
const owner = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const before = { blockHash: `0x${"a".repeat(64)}`, requireCanonical: true };
const after = { blockHash: `0x${"b".repeat(64)}`, requireCanonical: true };
const environment = { APN_LINEA_RPC_URL: "https://linea-rpc.publicnode.com", APN_LINEA_ARCHIVE_RPC_URL: "https://archive.example" };
function fixture(chain = "0xe708", error = false) {
  const rows: {host:string;method:string;params:unknown[]}[] = [];
  return {rows,transport:{request:async(endpoint:string,_verb:string,body:string|null)=>{
    const q = JSON.parse(body!); rows.push({host:new URL(endpoint).host,method:q.method,params:q.params});
    const result = q.method === "eth_chainId" ? chain : q.params[1]?.blockHash === before.blockHash ? "0x1" : "0x2";
    return {status:200,body:JSON.stringify(error && q.method === "eth_getBalance" ? {jsonrpc:"2.0",id:q.id,error:{code:-32000,message:"TEST refusal"}} : {jsonrpc:"2.0",id:q.id,result})};
  }}};
}
for (const sessionMode of [false,true]) test(`canonical hash-only balance pair uses checked archive; session=${sessionMode}`,async()=>{
  const f=fixture(),descriptor=bridgeRpcCall(59144,environment,{transport:f.transport});
  const session=new RpcReadSession({wait:async()=>{}}),call=sessionMode?descriptor.sessionCall(session):descriptor.call;
  assert.equal(descriptor.origin,"https://linea-rpc.publicnode.com");
  assert.deepEqual(await Promise.all([call("eth_getBalance",[owner,before]),call("eth_getBalance",[owner,after])]),["0x1","0x2"]);
  assert.deepEqual(f.rows.map(r=>[r.host,r.method]),[["archive.example","eth_chainId"],["archive.example","eth_getBalance"],["archive.example","eth_getBalance"]]);
  assert.deepEqual(f.rows.filter(r=>r.method==="eth_getBalance").map(r=>r.params[1]),[before,after]);
  if(sessionMode){assert.equal(session.telemetry().httpRequests,3);assert.equal(session.telemetry().attemptsByEndpointRole.archive,3);assert.equal(session.telemetry().attemptsByEndpointRole.primary,0);}
});
const unchangedTags:unknown[]=["latest","safe","finalized","pending","0x10","0x0",{blockNumber:"0x10",requireCanonical:true},{blockHash:before.blockHash},{blockHash:before.blockHash,requireCanonical:false},{blockHash:before.blockHash,requireCanonical:"true"},{blockHash:"0xdead",requireCanonical:true},{blockHash:`0x${"0".repeat(64)}`,requireCanonical:true},{blockHash:before.blockHash,blockNumber:"0x10",requireCanonical:true},[before],null];
for(const [index,tag] of unchangedTags.entries()) test(`balance tag ${index} retains primary classification`,async()=>{
  assert.equal(isHistoricalStateRead("eth_getBalance",[owner,tag]),false);
  const f=fixture();await bridgeRpcCall(59144,environment,{transport:f.transport}).call("eth_getBalance",[owner,tag]);
  assert.deepEqual(f.rows.map(r=>[r.host,r.method]),[["linea-rpc.publicnode.com","eth_getBalance"]]);
});
test("balance classifier requires exact params and leaves legacy state rules intact",()=>{
  assert.equal(isHistoricalStateRead("eth_getBalance",[owner,before]),true);
  assert.equal(isHistoricalStateRead("eth_getBalance",[owner,before,"extra"]),false);
  assert.equal(isHistoricalStateRead("eth_getBalance",[owner]),false);
  assert.equal(isHistoricalStateRead("eth_getCode",[owner,"0x10"]),true);
  assert.equal(isHistoricalStateRead("eth_call",[{to:owner},{blockHash:before.blockHash}]),true);
  assert.equal(isHistoricalStateRead("eth_getStorageAt",[owner,"0x0","0x10"]),true);
});
for(const sessionMode of [false,true]) test(`balance rejects wrong archive chain before witness; session=${sessionMode}`,async()=>{
  const f=fixture("0x1"),d=bridgeRpcCall(59144,environment,{transport:f.transport});
  const call=sessionMode?d.sessionCall(new RpcReadSession({wait:async()=>{}})):d.call;
  await assert.rejects(call("eth_getBalance",[owner,before]),{code:"APN_RPC_CONFIG",message:/bridge_archive_RPC_chain/});
  assert.deepEqual(f.rows.map(r=>r.method),["eth_chainId"]);
});
test("canonical balance requires distinct configured archive before transport",async()=>{
  for(const archive of [undefined,"https://linea-rpc.publicnode.com/archive"]){const f=fixture();await assert.rejects(bridgeRpcCall(59144,{...environment,APN_LINEA_ARCHIVE_RPC_URL:archive},{transport:f.transport}).call("eth_getBalance",[owner,before]),{code:"APN_PROVIDER_CAPABILITY_UNAVAILABLE"});assert.equal(f.rows.length,0);}
});
test("balance RPC refusal is attributed to archive without primary fallback",async()=>{
  const f=fixture("0xe708",true),d=bridgeRpcCall(59144,environment,{transport:f.transport});
  await assert.rejects(d.sessionCall(new RpcReadSession({wait:async()=>{}}))("eth_getBalance",[owner,before]),(e:unknown)=>{assert(e instanceof ApnError);assert.equal(e.details?.endpointRole,"archive");return true;});
  assert(f.rows.every(r=>r.host==="archive.example"));
});
