import { readFile } from "node:fs/promises";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, hashDomain, type Hex } from "viem";
import { hashObject } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { sealWallet } from "../../src/state.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import type { MerchantRpcPort } from "../../src/x402-merchant/rpc.js";
import { MERCHANT_DATA } from "../../src/x402-merchant/rpc.js";
import type { MerchantOperation } from "../../src/x402-merchant/model.js";
import type { HttpPort, HttpObservation } from "../../src/x402-model.js";
import { MERCHANT_AMOUNT, MERCHANT_CHAIN, MERCHANT_IMPLEMENTATION, MERCHANT_MECHANISM, MERCHANT_OWNER, MERCHANT_PAYEE, MERCHANT_TOKEN, MERCHANT_URL } from "../../src/x402-merchant/pins.js";
import { MerchantService } from "../../src/x402-merchant/service.js";
export const BLOCK_HASH=`0x${"a".repeat(64)}` as Hex,TX_HASH=`0x${"b".repeat(64)}` as Hex;
export const challenge={x402Version:2,error:"Payment required",resource:{url:MERCHANT_URL,description:"Bitcoin price",mimeType:"application/json"},accepts:[{scheme:"exact",network:MERCHANT_CHAIN,amount:MERCHANT_AMOUNT,asset:MERCHANT_TOKEN,payTo:MERCHANT_PAYEE,maxTimeoutSeconds:300,extra:{name:"USDm",version:"2"}}],extensions:{bazaar:{info:{input:{type:"http",method:"GET"}}}}};
export function observation(now:Date,status=402):HttpObservation {return {status,rawHeaderPairs:status===402?[["payment-required",Buffer.from(JSON.stringify(challenge)).toString("base64")]]:[["content-type","application/json"],["payment-response","opaque-preserved"]],bodyBytes:Buffer.from(status===200?JSON.stringify({bitcoin:{usd:97234.12,usd_24h_change:2.31}}):"{}"),finalUrl:MERCHANT_URL,observedOrigin:"https://x402engine.app",dnsAddresses:["1.1.1.1"],selectedAddress:"1.1.1.1",startedAt:now.toISOString(),observedAt:now.toISOString(),safeTransportProvenance:{protocol:"https",tlsAuthorized:true,redirectCount:0}};}
export class MerchantFixtureRpc implements MerchantRpcPort {
 nonce="0x0"; sends=0; batches=0; calls=0; badCode=false; finality=true; reorg=false; lost=false; queued:()=>Promise<void>|void=()=>{}; receiptOverride:((r:Record<string,unknown>)=>void)|undefined; operation:MerchantOperation|undefined;
 constructor(readonly codes:readonly string[]){}
 async batch(calls:readonly {method:string;params:readonly unknown[]}[]){this.batches++;return await Promise.all(calls.map(c=>this.value(c.method,c.params)));}
 async call(method:string,params:readonly unknown[],beforeSend?:()=>Promise<void>|void,beforeWire?:()=>void){this.calls++;if(method==="eth_sendRawTransaction"){await this.queued();await beforeSend?.();beforeWire?.();this.sends++;if(this.lost)throw new Error("lost");return TX_HASH;}return this.value(method,params);}
 async value(method:string,p:readonly unknown[]):Promise<unknown>{
 const block={number:"0x10",hash:BLOCK_HASH,parentHash:`0x${"d".repeat(64)}`,stateRoot:BLOCK_HASH,transactionsRoot:BLOCK_HASH,receiptsRoot:BLOCK_HASH,sha3Uncles:BLOCK_HASH,logsBloom:`0x${"0".repeat(512)}`,nonce:"0x0000000000000000",miner:MERCHANT_OWNER,extraData:"0x",timestamp:"0x100",gasLimit:"0x100000",gasUsed:"0x186a0",difficulty:"0x0",baseFeePerGas:"0x1"};
 if(method==="eth_chainId")return "0x10e6";
 if(method==="eth_getBlockByNumber")return {...block,...(p[1]===true?{transactions:[await this.value("eth_getTransactionByHash",[TX_HASH])]}:{}),...(p[0]==="finalized"&&!this.finality?{number:"0xf"}:{}),...(this.reorg&&p[0]==="0x10"?{hash:`0x${"c".repeat(64)}`}:{})};
 if(method==="eth_getCode")return String(p[0]).toLowerCase()===MERCHANT_OWNER.toLowerCase()?"0x":this.badCode?"0x00":String(p[0]).toLowerCase()===MERCHANT_TOKEN.toLowerCase()?this.codes[0]:this.codes[1];
 if(method==="eth_getStorageAt")return `0x${MERCHANT_IMPLEMENTATION.slice(2).toLowerCase().padStart(64,"0")}`;
 if(method==="eth_getBalance")return "0x100000000000000";
 if(method==="eth_getTransactionCount")return this.nonce;
 if(method==="eth_estimateGas")return "0x186a0";
 if(method==="eth_maxPriorityFeePerGas")return "0x1";
 if(method==="eth_call") {const d=(p[0] as {data:string}).data.slice(0,10);if(d==="0x06fdde03")return encodeAbiParameters([{type:"string"}],["MegaUSD"]);if(d==="0x95d89b41")return encodeAbiParameters([{type:"string"}],["USDm"]);if(d==="0x313ce567")return encodeAbiParameters([{type:"uint8"}],[18]);if(d==="0x3644e515")return hashDomain({types:{EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}]},domain:{name:"MegaUSD",version:"1",chainId:4326n,verifyingContract:MERCHANT_TOKEN}});return encodeAbiParameters([{type:"uint256"}],[10n**18n]);}
 if(method==="eth_getTransactionReceipt") {const r={transactionHash:TX_HASH,blockNumber:"0x10",blockHash:BLOCK_HASH,status:"0x1",type:"0x2",transactionIndex:"0x0",gasUsed:"0x186a0",effectiveGasPrice:"0x2",logs:[{address:MERCHANT_TOKEN,topics:encodeEventTopics({abi:erc20Abi,eventName:"Transfer",args:{from:MERCHANT_OWNER,to:MERCHANT_PAYEE}}),data:encodeAbiParameters([{type:"uint256"}],[BigInt(MERCHANT_AMOUNT)]),transactionHash:TX_HASH,blockHash:BLOCK_HASH,blockNumber:"0x10",transactionIndex:"0x0",logIndex:"0x0",removed:false}]};this.receiptOverride?.(r);return r;}
 if(method==="eth_getTransactionByHash") {const e=this.operation!.envelope;return {hash:TX_HASH,blockHash:BLOCK_HASH,blockNumber:"0x10",transactionIndex:"0x0",type:"0x2",accessList:[],from:MERCHANT_OWNER,to:MERCHANT_TOKEN,input:MERCHANT_DATA,value:"0x0",nonce:`0x${BigInt(e.nonce).toString(16)}`,chainId:"0x10e6",gas:`0x${BigInt(e.gas).toString(16)}`,maxFeePerGas:`0x${BigInt(e.maxFeePerGas).toString(16)}`,maxPriorityFeePerGas:`0x${BigInt(e.maxPriorityFeePerGas).toString(16)}`};}
 throw new Error(method);
 }
}
export async function merchantFixture(root:string){
 let now=new Date("2026-10-09T04:00:00.000Z");const state=new StateStore(root);await state.initialize();
 await state.writeWallet(sealWallet({schemaVersion:"apn.state.v1",profile:"default",profileHash:state.profileHash("default"),address:MERCHANT_OWNER,createdAt:now.toISOString(),bindingHash:"d".repeat(64)}));
 const policy=new AllowlistPolicyStore(root);const activate=async(options:{nativeCap?:string;omitNative?:boolean;policyTtlMs?:number}={})=>{const prior=await policy.read("default"),record=await policy.stage({profile:"default",now,...(prior.records.length===0?{}:{expectedRevision:prior.records.at(-1)!.revision}),policy:{schemaVersion:"apn.allowlist-policy-file.v1",overlayVersion:`merchant.${prior.records.length+1}`,accounts:{evm:MERCHANT_OWNER},effectiveAt:new Date(now.getTime()-1000).toISOString(),expiresAt:new Date(now.getTime()+(options.policyTtlMs??3600000)).toISOString(),admissions:[{chain:MERCHANT_CHAIN,kind:"token",identifier:MERCHANT_TOKEN,rail:"x402",maximumPerTransferAtomic:MERCHANT_AMOUNT,dailyLimitAtomic:MERCHANT_AMOUNT,mechanism:MERCHANT_MECHANISM},...(options.omitNative?[]:[{chain:MERCHANT_CHAIN,kind:"native" as const,rail:"x402" as const,maximumPerTransferAtomic:options.nativeCap??"100000000000000",dailyLimitAtomic:options.nativeCap??"100000000000000",mechanism:MERCHANT_MECHANISM}])]}});
 await policy.appendDecision("default",prior.entries.at(-1)?.entryDigest??null,{status:"active",revision:record.revision,stagedRecordDigest:record.recordDigest,policyDigest:record.registry.policyDigest,registry:record.registry,approvalFingerprint:hashObject(record),decidedAt:now.toISOString()});};await activate();
 const code=JSON.parse(await readFile("tests/core/merchant-code-fixture.json","utf8"));const rpc=new MerchantFixtureRpc(code.responses.map((v:{result:string})=>v.result));let signs=0,seals=0,deliveryFails=false;const headers:string[]=[];
 const http:HttpPort={get:async input=>{if(input.paymentSignature!==undefined){headers.push(input.paymentSignature);if(deliveryFails)throw new Error("merchant response lost");return observation(now,200);}return observation(now);}};
 let approve:()=>Promise<void>=async()=>{};
 const service=new MerchantService(state,{rpc,http,now:()=>new Date(now),approve:async o=>{rpc.operation=o;await approve();},custody:{verify:async()=>TX_HASH,sign:async()=>{signs++;return "0x02";},seal:async()=>{seals++;}}});
 return {state,service,rpc,http,activate,headers,signs:()=>signs,seals:()=>seals,advance:(ms:number)=>{now=new Date(now.getTime()+ms);},onApprove:(fn:()=>Promise<void>)=>{approve=fn;},failDelivery:()=>{deliveryFails=true;},repairDelivery:()=>{deliveryFails=false;},prepare:()=>service.prepare({profile:"default",maximumNativeFee:"1000000000000",idempotencyKey:"merchant-test-0001"})};
}
