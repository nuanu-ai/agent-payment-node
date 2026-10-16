import assert from "node:assert/strict";
import test from "node:test";
import { gaszipOracleUint256 } from "../../src/lifi/gaszip-oracle-data.js";
import { GASZIP_DIRECT_ROUTES, gaszipCodec, inspectGaszipDelivery, inspectGaszipFundingQuote, type GaszipCorrelatedDelivery } from "../../src/lifi/gaszip-direct-route.js";
import { GaszipFundingJournal, publicGaszipFunding, sealGaszipFunding, validateGaszipFunding, type GaszipFundingRecord } from "../../src/lifi/gaszip-direct-journal.js";
import { GaszipFundingRpc, assertGaszipFundingFresh, proveGaszipDelivery, proveGaszipSafeTransaction, readGaszipFundingPlan, type GaszipRpcPort } from "../../src/lifi/gaszip-direct-rpc.js";
import { GaszipFundingService } from "../../src/lifi/gaszip-direct-service.js";
const SEI_ROUTE=GASZIP_DIRECT_ROUTES.sei,MEGA_ROUTE=GASZIP_DIRECT_ROUTES.mega,seiCodec=gaszipCodec(SEI_ROUTE),megaCodec=gaszipCodec(MEGA_ROUTE);
const OWNER="0x991e254B5C8e0AAf6c244eaa2706BAd059809b04";
const BLOCK=`0x${"1".repeat(64)}`;
const L1="0x00000000000000000000000000000000000000000000000000000001477e4bf3",ZERO=`0x${"0".repeat(64)}`;
const refuse=(reason:string):never=>{throw Error(reason);};
test("oracle DATA accepts exact padded uint256 words without weakening JSON-RPC quantities",()=>{
 assert.equal(gaszipOracleUint256(L1,refuse),5494426611n);assert.equal(gaszipOracleUint256(ZERO,refuse),0n);
 assert.equal(gaszipOracleUint256(`0x${"f".repeat(64)}`,refuse),(1n<<256n)-1n);
 for(const v of ["0x0","0x",`0x${"0".repeat(63)}`,`0x${"0".repeat(65)}`,`0x${"0".repeat(66)}`,`0x${"z".repeat(64)}`,L1+" ",0,null])assert.throws(()=>gaszipOracleUint256(v,refuse),/oracle_uint256_data/u);
 for(const quantity of [seiCodec.quantity,megaCodec.quantity]){assert.equal(quantity("0x0"),0n);assert.equal(quantity("0x1477e4bf3"),5494426611n);for(const v of [L1,ZERO,"0x00","0x01"])assert.throws(()=>quantity(v),/rpc_quantity/u);}
});
/** Real finite transport parses JSON envelopes containing ABI DATA; never normalizes fixture results. */
function transport(change?:{method:string;value:unknown},oracle:unknown=L1){return {request:async(_url:string,_method:string,body:string|null)=>{
 const request=JSON.parse(body!) as {id:string;method:string;params:unknown[]};let result:unknown;
 if(request.method==="eth_chainId")result="0x2105";
 else if(request.method==="eth_getBlockByNumber")result={hash:BLOCK,number:"0x64",baseFeePerGas:"0x4c4b40"};
 else if(request.method==="eth_getCode")result="0x";
 else if(request.method==="eth_getBalance")result="0x5af3107a4000";
 else if(request.method==="eth_getTransactionCount")result="0x0";
 else if(request.method==="eth_estimateGas")result="0x5308";
 else if(request.method==="eth_call"){const call=request.params[0] as {data:string};result=call.data.startsWith("0xf1c7a58b")?oracle:ZERO;if(call.data.startsWith("0xf1c7a58b"))assert.ok(call.data.endsWith("00000200"));}
 else throw Error("unexpected production transport fixture method");
 if(change?.method===request.method)result=change.value;
 return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:request.id,result})};
}};}
for(const lane of ["sei","mega"] as const)test(`${lane} production RPC envelope decodes oracle DATA and preserves all quantity guards`,async()=>{
 const plan=(rpc:GaszipRpcPort,owner:string,amount:string,maxFee:string)=>readGaszipFundingPlan(lane==="sei"?SEI_ROUTE:MEGA_ROUTE,rpc,owner,amount,maxFee);
 const rpc=(change?:{method:string;value:unknown},oracle?:unknown)=>lane==="sei"?new GaszipFundingRpc(SEI_ROUTE,"https://mainnet.base.org",transport(change,oracle)):new GaszipFundingRpc(MEGA_ROUTE,"https://mainnet.base.org",transport(change,oracle));
 const p=await plan(rpc(),OWNER,"10000000000000","1000000000000");assert.equal(p.l1FeeUpper,"5494426611");assert.equal(p.operatorFeeUpper,"0");assert.equal(p.feeUpper,(BigInt(p.gas)*BigInt(p.maxFee)+5494426611n).toString());
 for(const bad of ["0x0",`0x${"0".repeat(63)}`,`0x${"0".repeat(66)}`,`0x${"0".repeat(63)}g`])await assert.rejects(plan(rpc(undefined,bad),OWNER,"10000000000000","1000000000000"),/oracle_uint256_data/u);
 for(const method of ["eth_chainId","eth_getBalance","eth_getTransactionCount","eth_estimateGas"])await assert.rejects(plan(rpc({method,value:"0x00"}),OWNER,"10000000000000","1000000000000"),/rpc_quantity/u);
});
