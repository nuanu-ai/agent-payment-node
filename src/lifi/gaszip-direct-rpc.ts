import { gaszipNativeNet } from "./gaszip-native-delivery.js";
import { gaszipSendRefused } from "./gaszip-outcome.js";
import { assertGaszipPhysicalGuard } from "./gaszip-authority.js";
import { gaszipOracleUint256 } from "./gaszip-oracle-data.js";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "../evm-asset.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { BridgeHttps } from "./https.js";
import { gaszipCodec, type GaszipCorrelatedDelivery, type GaszipDirectRoute } from "./gaszip-direct-route.js";
import type { GaszipFundingPlan, GaszipFundingRecord } from "./gaszip-direct-journal.js";
const ORACLE="0x420000000000000000000000000000000000000F";
const ABI=parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)","function getOperatorFee(uint256) view returns (uint256)"]);
const hex=(x:bigint):Hex=>`0x${x.toString(16)}`;
export interface GaszipRpcPort { call(method:string,params:readonly unknown[],beforeSend?:()=>void):Promise<unknown> }
/** Finite public RPC transport shares DNS pinning, response bounds, TLS and no-redirect/no-retry HTTP. */
export class GaszipFundingRpc implements GaszipRpcPort {
  private sequence=0; private reads=0; private readonly url:string;
  constructor(private readonly route:GaszipDirectRoute,url:string,private readonly https:Pick<BridgeHttps,"request">=new BridgeHttps()){
    const u=parsePublicHttpsUrl(url,"APN_RPC_CONFIG","GasZip RPC",2048);if(u.search!=="" || u.hash!=="")gaszipCodec(route).fail("rpc_url");this.url=u.toString();
  }
  async call(method:string,params:readonly unknown[],beforeSend?:()=>void):Promise<unknown>{
    const c=gaszipCodec(this.route);
    if(!["eth_chainId","eth_getBlockByNumber","eth_getBalance","eth_getCode","eth_getTransactionCount","eth_call","eth_estimateGas","eth_maxPriorityFeePerGas","eth_sendRawTransaction","eth_getTransactionByHash","eth_getTransactionReceipt"].includes(method)|| ++this.reads>64)c.fail("rpc_method_or_budget");
    if(method==="eth_sendRawTransaction"){if(params.length!==1)c.fail("send_parameters");assertGaszipPhysicalGuard(beforeSend,params[0]);}
    const id=String(++this.sequence);const r=await this.https.request(this.url,"POST",canonicalJson({jsonrpc:"2.0",id,method,params}),1024*1024,"APN_RPC_CONFIG",beforeSend);
    if(r.status!==200)c.fail("rpc_http");let v:Record<string,unknown>;try{v=c.object(JSON.parse(r.body));}catch{return c.fail("rpc_json");}
    // A well-formed JSON-RPC error answer to the one send is a definite refusal, unless it says the node already holds the bytes.
    if(method==="eth_sendRawTransaction" && gaszipSendRefused(v,id))c.fail("send_rejected");
    if(v.jsonrpc!=="2.0" || v.id!==id || !Object.hasOwn(v,"result") || Object.hasOwn(v,"error"))c.fail("rpc_result");return v.result;
  }
}
export async function readGaszipFundingPlan(route:GaszipDirectRoute,rpc:GaszipRpcPort,owner:string,amount:string,maxFee:string,frozenPlan?:GaszipFundingPlan):Promise<GaszipFundingPlan>{
  const c=gaszipCodec(route);
  if(c.quantity(await rpc.call("eth_chainId",[]))!==BigInt(route.sourceChain))c.fail("source_chain");
  const block=c.object(await rpc.call("eth_getBlockByNumber",["latest",false]));const blockHash=c.hash(block.hash);
  const tag={blockHash,requireCanonical:true};const tx={from:owner,to:route.target,data:route.data,value:hex(BigInt(amount))};
  const [code,balance,n,p,g]=await Promise.all([rpc.call("eth_getCode",[route.target,tag]),rpc.call("eth_getBalance",[owner,tag]),
    rpc.call("eth_getTransactionCount",[owner,"latest"]),rpc.call("eth_getTransactionCount",[owner,"pending"]),rpc.call("eth_estimateGas",[tx,tag])]);
  if(code!=="0x" || c.quantity(n)!==c.quantity(p) || c.quantity(n)>BigInt(Number.MAX_SAFE_INTEGER))c.fail("source_code_or_nonce");
  // Base requires a quoted total fee including L1 data and operator components. It is not an on-chain total-fee cap.
  const gas=frozenPlan===undefined?(c.quantity(g)*110n+99n)/100n:c.quantity(g),tip=1_000_000n,fee=2n*c.quantity(block.baseFeePerGas)+tip;
  const [l1,op]=await Promise.all([rpc.call("eth_call",[{to:ORACLE,data:encodeFunctionData({abi:ABI,functionName:"getL1FeeUpperBound",args:[BigInt(MAX_DIRECT_TRANSACTION_BYTES)]})},tag]),
    rpc.call("eth_call",[{to:ORACLE,data:encodeFunctionData({abi:ABI,functionName:"getOperatorFee",args:[frozenPlan===undefined?gas:BigInt(frozenPlan.gas)]})},tag])]);
  const l1Fee=gaszipOracleUint256(l1,c.fail),operator=gaszipOracleUint256(op,c.fail),total=gas*fee+l1Fee+operator;
  // The exclusive owner conflict keeps the full caller-authorized fee reserve unavailable to other local rails.
  const signedUpper=(frozenPlan===undefined?gas*fee:BigInt(frozenPlan.gas)*BigInt(frozenPlan.maxFee))+l1Fee+operator;
  // The owner's fee ceiling bounds the signed upper fee, operator component included; reads pinned with requireCanonical
  // need no header recheck (the node refuses a non-canonical hash).
  if(signedUpper>BigInt(maxFee) || c.quantity(balance)<BigInt(amount)+BigInt(maxFee))c.fail("source_balance_or_fee_cap");
  return {blockHash,nonce:c.quantity(n).toString(),gas:gas.toString(),maxFee:fee.toString(),tip:tip.toString(),l1FeeUpper:l1Fee.toString(),operatorFeeUpper:operator.toString(),feeUpper:total.toString()};
}
export function assertGaszipFundingFresh(route:GaszipDirectRoute,initial:GaszipFundingPlan,fresh:GaszipFundingPlan,maximumFee:string):void{
  // Reprice only unsigned L1/operator estimates. Every signed field stays frozen in the saved plan.
  const minimumPrice=(BigInt(fresh.maxFee)-BigInt(fresh.tip))/2n+BigInt(initial.tip);
  const fullUpper=BigInt(initial.gas)*BigInt(initial.maxFee)+BigInt(fresh.l1FeeUpper)+BigInt(fresh.operatorFeeUpper);
  if(initial.nonce!==fresh.nonce || BigInt(fresh.gas)>BigInt(initial.gas) || initial.tip!==fresh.tip ||
    minimumPrice>BigInt(initial.maxFee) || fullUpper>BigInt(maximumFee))gaszipCodec(route).fail("source_plan_drift");
}
export interface GaszipSafeProof { readonly hash: Hex; readonly blockHash: Hex; readonly blockNumber:string; readonly status:"success"|"reverted";
  readonly transactionDigest:string; readonly receiptDigest:string; readonly amount:string; readonly actualFee:string|null }
/** The exact transaction and receipt must agree, have canonical block identity, and lie at or below a fresh safe head. */
export async function proveGaszipSafeTransaction(route:GaszipDirectRoute,rpc:GaszipRpcPort,chain:number,hash:Hex,
  expected:{from:string;to:string;data:Hex;value:string;nonce:string;gas?:string;maxFee?:string;tip?:string;gasPrice?:string},known?:unknown):Promise<GaszipSafeProof|null>{
  const c=gaszipCodec(route);
  if(c.quantity(await rpc.call("eth_chainId",[]))!==BigInt(chain))c.fail("proof_chain");
  const [tv,rv,sv]=await Promise.all([known??rpc.call("eth_getTransactionByHash",[hash]),rpc.call("eth_getTransactionReceipt",[hash]),rpc.call("eth_getBlockByNumber",["safe",false])]);
  if(tv===null || rv===null)return null;const t=c.object(tv),r=c.object(rv),safe=c.object(sv);
  const blockHash=c.hash(r.blockHash),number=c.quantity(r.blockNumber);
  if(number>c.quantity(safe.number))return null;
  if(c.hash(t.hash)!==hash || c.hash(r.transactionHash)!==hash || c.hash(t.blockHash)!==blockHash || c.quantity(t.blockNumber)!==number ||
    c.address(t.from)!==expected.from || c.address(r.from)!==expected.from || c.address(t.to)!==expected.to || c.address(r.to)!==expected.to ||
    t.input!==expected.data || c.quantity(t.value).toString()!==expected.value || c.quantity(t.nonce).toString()!==expected.nonce ||
    c.quantity(t.chainId)!==BigInt(chain) || (expected.gas!==undefined && c.quantity(t.gas).toString()!==expected.gas) ||
    (expected.maxFee!==undefined && c.quantity(t.maxFeePerGas).toString()!==expected.maxFee) || (expected.tip!==undefined && c.quantity(t.maxPriorityFeePerGas).toString()!==expected.tip) ||
    (expected.gasPrice!==undefined && (c.quantity(t.type)!==0n || c.quantity(r.type)!==0n || c.quantity(t.gasPrice).toString()!==expected.gasPrice ||
      c.quantity(r.effectiveGasPrice).toString()!==expected.gasPrice || c.quantity(r.gasUsed)===0n || !Array.isArray(r.logs) || r.logs.length!==0 || r.contractAddress!==null)))c.fail("proof_binding");
  const included=c.object(await rpc.call("eth_getBlockByNumber",[hex(number),false]));
  if(c.hash(included.hash)!==blockHash || c.quantity(r.status)!==0n && c.quantity(r.status)!==1n)c.fail("proof_reorg_or_status");
  if(expected.gasPrice!==undefined && (!Array.isArray(included.transactions) || included.transactions.filter(x=>x===hash).length!==1))c.fail("destination_canonical_membership");
  if(expected.gas!==undefined && c.quantity(r.gasUsed)>BigInt(expected.gas) || expected.maxFee!==undefined && c.quantity(r.effectiveGasPrice)>BigInt(expected.maxFee))c.fail("source_receipt_gas_binding");
  let actualFee:string|null=null;
  if(chain===route.sourceChain){
    if(r.l1Fee===undefined)c.fail("source_receipt_l1_fee_missing");
    // The paid fee is the receipt's: execution, L1 data fee and the Jovian operator fee from its own fields (absent = zero).
    if((r.operatorFeeScalar===undefined)!==(r.operatorFeeConstant===undefined))c.fail("operator_receipt_shape");
    const operator=r.operatorFeeScalar===undefined?0n:c.quantity(r.gasUsed)*c.quantity(r.operatorFeeScalar)*100n+c.quantity(r.operatorFeeConstant);
    if(r.operatorFee!==undefined && c.quantity(r.operatorFee)!==operator)c.fail("operator_receipt_shape");
    actualFee=(c.quantity(r.gasUsed)*c.quantity(r.effectiveGasPrice)+c.quantity(r.l1Fee)+operator).toString();
  }
  return {hash,blockHash,blockNumber:number.toString(),status:c.quantity(r.status)===1n?"success":"reverted",
    transactionDigest:hashObject(t),receiptDigest:hashObject(r),amount:expected.value,actualFee};
}
/**
 * The payout is proved from the chain alone: the exact signed transaction from the provider's signer to the owner, its
 * successful receipt with empty input and no logs at or below the safe head, its block membership, and an owner account
 * that has no code, so the plain value transfer could not run code and credited exactly its value. No historical balances.
 */
export async function proveGaszipDelivery(route:GaszipDirectRoute,rpc:GaszipRpcPort,owner:string,d:GaszipCorrelatedDelivery):Promise<GaszipSafeProof|null>{
  const c=gaszipCodec(route);let amount=d.amount;let signedBudget:{gas:string;gasPrice:string}|undefined;let known:unknown;
  if(d.grossNative===true){known=await rpc.call("eth_getTransactionByHash",[d.hash]);if(known===null)return null;
    const t=c.object(known);signedBudget={gas:c.quantity(t.gas).toString(),gasPrice:c.quantity(t.gasPrice).toString()};
    amount=await gaszipNativeNet(known,d,owner,route.destinationChain,0n,c);}
  const p=await proveGaszipSafeTransaction(route,rpc,route.destinationChain,d.hash,{from:d.signer,to:owner,data:"0x",value:amount,nonce:d.nonce,...signedBudget},known);
  if(p===null)return null;if(p.status!=="success")c.fail("destination_revert");
  if(await rpc.call("eth_getCode",[owner,"latest"])!=="0x")c.fail("destination_owner_code");return p;
}
export async function proveGaszipSource(route:GaszipDirectRoute,rpc:GaszipRpcPort,r:GaszipFundingRecord):Promise<GaszipSafeProof|null>{
  if(r.transactionHash===null)return null;return proveGaszipSafeTransaction(route,rpc,route.sourceChain,r.transactionHash,{from:r.owner.address,to:route.target,
    data:route.data,value:r.amountAtomic,nonce:r.plan.nonce,gas:r.plan.gas,maxFee:r.plan.maxFee,tip:r.plan.tip});
}
