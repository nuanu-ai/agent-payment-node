import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, serializeTransaction, type Hex } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { gaszipOracleUint256 } from "../lifi/gaszip-oracle-data.js";
import type { MerchantTerms } from "./terms.js";
import { refuse } from "./protocol.js";
import type { MerchantEnvelope } from "./model.js";
import type { MerchantRpcPort } from "./rpc.js";
import { decodeRelayBaseReceiptFee } from "../relay/source-fee-proof.js";
/** v1 fee contexts only (0.5.41-0.5.43 and earlier v2 operations): the pinned GasPriceOracle identity they recorded. */
export const MEGA_FEE_ORACLE = { address:getAddress("0x420000000000000000000000000000000000000F"),
  proxyHash:"0xfa8c9db6c6cab7108dea276f4cd09d575674eb0852c0fa3187e59e98ef977998",
  implementation:getAddress("0xc0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d3000f"), implementationHash:"0x4d195a9d7caf9fb6d4beaf80de252c626c853afd5868c4f4f8d19c9d301c2679",
  slot:"0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",version:"1.4.0" } as const;
const ABI=parseAbi(["function isEcotone() view returns (bool)","function isFjord() view returns (bool)","function isIsthmus() view returns (bool)","function version() view returns (string)","function getL1FeeUpperBound(uint256) view returns (uint256)","function getOperatorFee(uint256) view returns (uint256)"]);
interface FeeContextBody { readonly anchorNumber:string;readonly anchorHash:Hex;readonly unsignedBytes:string;readonly unsignedHash:Hex;
  readonly executionUpper:string;readonly l1EstimatedUpper:string;readonly admissionEstimatedUpper:string }
/** v1: the oracle's code, implementation, version and fork flags were pinned, and only a zero operator fee was accepted. */
export interface MerchantFeeContextV1 extends FeeContextBody { readonly schemaVersion:"apn.merchant-mega-fee.v1";readonly oraclePinsDigest:string;readonly operatorEstimatedUpper:"0" }
/**
 * v2 (new operations, PHASE2 P5): the GasPriceOracle predeploy is read at the anchor block by address, with no code,
 * version or fork-flag pins; its L1 upper bound and operator fee enter the admission estimate. The paid fee comes from
 * the receipt's own fee fields.
 */
export interface MerchantFeeContextV2 extends FeeContextBody { readonly schemaVersion:"apn.merchant-mega-fee.v2";readonly oracle:typeof MEGA_FEE_ORACLE.address;readonly operatorEstimatedUpper:string }
export type MerchantFeeContext = MerchantFeeContextV1 | MerchantFeeContextV2;
const q=(v:unknown)=>{if(typeof v!=="string"||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(v))refuse("merchant_fee_quantity");return BigInt(v);};
const obj=(v:unknown)=>{if(!isPlainRecord(v))refuse("merchant_fee_object");return v;};
const hash=(v:unknown):Hex=>{if(typeof v!=="string"||!/^0x[0-9a-fA-F]{64}$/u.test(v))refuse("merchant_fee_hash");return v.toLowerCase() as Hex;};
const data=(v:unknown):Hex=>{if(typeof v!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/u.test(v))refuse("merchant_fee_data");return v as Hex;};
/** The unsigned transfer the fee context prices: the operation's own token, payee and amount under its frozen envelope. */
export function unsignedMerchantEnvelope(e:Pick<MerchantEnvelope,"nonce"|"gas"|"maxFeePerGas"|"maxPriorityFeePerGas">,t:Pick<MerchantTerms,"token"|"payee"|"amount">):Hex {
  if(BigInt(e.nonce)>BigInt(Number.MAX_SAFE_INTEGER))refuse("merchant_fee_nonce");
  return serializeTransaction({type:"eip1559",chainId:4326,nonce:Number(e.nonce),gas:BigInt(e.gas),maxFeePerGas:BigInt(e.maxFeePerGas),maxPriorityFeePerGas:BigInt(e.maxPriorityFeePerGas),to:t.token as Hex,value:0n,accessList:[],data:encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[t.payee as Hex,BigInt(t.amount)]})});
}
/** Checked against what the record stored: v1 against the oracle pins it recorded, v2 against the oracle address alone. */
export function validateMerchantFeeContext(v:unknown,e:MerchantEnvelope,t:Pick<MerchantTerms,"token"|"payee"|"amount">):MerchantFeeContext {
  const v2=isPlainRecord(v)&&v.schemaVersion==="apn.merchant-mega-fee.v2";
  if(!isPlainRecord(v)||!exactKeys(v,["schemaVersion","anchorNumber","anchorHash",v2?"oracle":"oraclePinsDigest","unsignedBytes","unsignedHash","executionUpper","l1EstimatedUpper","operatorEstimatedUpper","admissionEstimatedUpper"]))refuse("merchant_fee_context_shape");
  const f=v as unknown as MerchantFeeContext,raw=unsignedMerchantEnvelope(e,t);
  for(const key of ["anchorNumber","unsignedBytes","executionUpper","l1EstimatedUpper","operatorEstimatedUpper","admissionEstimatedUpper"] as const)if(!/^(0|[1-9][0-9]{0,77})$/u.test(f[key]))refuse("merchant_fee_context_uint");
  const identity=f.schemaVersion==="apn.merchant-mega-fee.v2"?f.oracle===MEGA_FEE_ORACLE.address:f.schemaVersion==="apn.merchant-mega-fee.v1"&&f.oraclePinsDigest===hashObject(MEGA_FEE_ORACLE)&&f.operatorEstimatedUpper==="0";
  if(!identity||hash(f.anchorHash)!==f.anchorHash||f.unsignedHash!==keccak256(raw)||f.unsignedBytes!==String((raw.length-2)/2)||
    BigInt(f.executionUpper)!==BigInt(e.gas)*BigInt(e.maxFeePerGas)||BigInt(f.admissionEstimatedUpper)!==BigInt(f.executionUpper)+BigInt(f.l1EstimatedUpper)+BigInt(f.operatorEstimatedUpper)||BigInt(f.admissionEstimatedUpper)>BigInt(e.maximumNativeFee))refuse("merchant_fee_context_binding");return f;
}
/** Exact canonical oracle identity and zero-only operator contract; both estimation and inclusion use this pin. */
export async function merchantOracleAt(rpc:MerchantRpcPort,number:string,blockHash:Hex,gas:bigint,unsignedBytes?:bigint):Promise<bigint> {
  const tag={blockHash,requireCanonical:true},call=(name:"isEcotone"|"isFjord"|"isIsthmus"|"version"|"getL1FeeUpperBound"|"getOperatorFee",args?:readonly [bigint])=>({method:"eth_call",params:[{to:MEGA_FEE_ORACLE.address,data:encodeFunctionData({abi:ABI,functionName:name,args} as never)},tag]});
  const values=await rpc.batch([{method:"eth_getCode",params:[MEGA_FEE_ORACLE.address,tag]},{method:"eth_getStorageAt",params:[MEGA_FEE_ORACLE.address,MEGA_FEE_ORACLE.slot,tag]},{method:"eth_getCode",params:[MEGA_FEE_ORACLE.implementation,tag]},call("isEcotone"),call("isFjord"),call("isIsthmus"),call("version"),call("getOperatorFee",[gas]),...(unsignedBytes===undefined?[]:[call("getL1FeeUpperBound",[unsignedBytes])])]);
  if(keccak256(data(values[0]))!==MEGA_FEE_ORACLE.proxyHash||data(values[1]).toLowerCase()!==`0x${MEGA_FEE_ORACLE.implementation.slice(2).toLowerCase().padStart(64,"0")}`||keccak256(data(values[2]))!==MEGA_FEE_ORACLE.implementationHash||
    values.slice(3,6).some(v=>gaszipOracleUint256(v,refuse)!==1n)||decodeFunctionResult({abi:ABI,functionName:"version",data:data(values[6])})!==MEGA_FEE_ORACLE.version||gaszipOracleUint256(values[7],refuse)!==0n)refuse("merchant_fee_oracle_identity_or_operator");
  const recheck=obj(await rpc.call("eth_getBlockByNumber",[`0x${BigInt(number).toString(16)}`,false]));if(q(recheck.number)!==BigInt(number)||hash(recheck.hash)!==blockHash)refuse("merchant_fee_anchor_changed");
  return unsignedBytes===undefined?0n:gaszipOracleUint256(values[8],refuse);
}
/** The admission fee estimate at one anchor. `pinned` (v1 records) keeps the oracle pins; new operations read by address only. */
export async function merchantFeeQuote(rpc:MerchantRpcPort,head:Record<string,unknown>,e:MerchantEnvelope,t:Pick<MerchantTerms,"token"|"payee"|"amount">,pinned:boolean):Promise<MerchantFeeContext> {
  const raw=unsignedMerchantEnvelope(e,t),number=q(head.number).toString(),blockHash=hash(head.hash),execution=BigInt(e.gas)*BigInt(e.maxFeePerGas),bytes=BigInt((raw.length-2)/2);
  if(!pinned){
    // One batch pinned to the anchor hash with requireCanonical; the node refuses a non-canonical hash, so no header recheck.
    const tag={blockHash,requireCanonical:true},call=(name:"getL1FeeUpperBound"|"getOperatorFee",arg:bigint)=>({method:"eth_call",params:[{to:MEGA_FEE_ORACLE.address,data:encodeFunctionData({abi:ABI,functionName:name,args:[arg]})},tag]});
    const [l1Value,operatorValue]=await rpc.batch([call("getL1FeeUpperBound",bytes),call("getOperatorFee",BigInt(e.gas))]);
    const l1=gaszipOracleUint256(l1Value,refuse),operator=gaszipOracleUint256(operatorValue,refuse);
    return {schemaVersion:"apn.merchant-mega-fee.v2",anchorNumber:number,anchorHash:blockHash,oracle:MEGA_FEE_ORACLE.address,unsignedBytes:bytes.toString(),unsignedHash:keccak256(raw),
      executionUpper:execution.toString(),l1EstimatedUpper:l1.toString(),operatorEstimatedUpper:operator.toString(),admissionEstimatedUpper:(execution+l1+operator).toString()};
  }
  // Fjord adds its own 68-byte signature allowance. Pass the exact unsigned serialized length once.
  const l1=await merchantOracleAt(rpc,number,blockHash,BigInt(e.gas),bytes);
  return {schemaVersion:"apn.merchant-mega-fee.v1",anchorNumber:number,anchorHash:blockHash,oraclePinsDigest:hashObject(MEGA_FEE_ORACLE),unsignedBytes:String((raw.length-2)/2),unsignedHash:keccak256(raw),executionUpper:execution.toString(),l1EstimatedUpper:l1.toString(),operatorEstimatedUpper:"0",admissionEstimatedUpper:(execution+l1).toString()};
}
export function checkMerchantFullFee(fresh:MerchantFeeContext,frozen:MerchantFeeContext,e:MerchantEnvelope,native:string,t:Pick<MerchantTerms,"token"|"payee"|"amount">):void {
  validateMerchantFeeContext(frozen,e,t);validateMerchantFeeContext(fresh,e,t);
  if(e.nativeFeeReserveWei!==undefined&&(!/^[1-9][0-9]*$/u.test(e.nativeFeeReserveWei)||BigInt(e.nativeFeeReserveWei)<BigInt(frozen.admissionEstimatedUpper)||BigInt(e.nativeFeeReserveWei)>BigInt(e.maximumNativeFee)))refuse("merchant_native_reserve_binding");
  if(fresh.schemaVersion!==frozen.schemaVersion||fresh.unsignedHash!==frozen.unsignedHash||BigInt(fresh.admissionEstimatedUpper)>BigInt(e.nativeFeeReserveWei??frozen.admissionEstimatedUpper)||BigInt(fresh.admissionEstimatedUpper)>BigInt(e.maximumNativeFee)||BigInt(native)<BigInt(e.nativeFeeReserveWei??frozen.admissionEstimatedUpper))refuse("merchant_full_fee_admission_changed");
}
export interface MerchantPaidFee { readonly execution:string;readonly l1:string;readonly operator:string;readonly total:string }
/** v1 fee rule: L1 is additional to receipt execution cost. Missing quantities/unsupported nonzero operator fields refuse. */
export function merchantActualFee(r:Record<string,unknown>):MerchantPaidFee {
  if(q(r.type)!==2n||r.l1Fee===undefined||q(r.gasUsed)===0n||r.blobGasUsed!==undefined&&q(r.blobGasUsed)!==0n)refuse("merchant_receipt_full_fee_type");
  if((r.operatorFeeScalar===undefined)!==(r.operatorFeeConstant===undefined))refuse("merchant_receipt_operator_shape");
  for(const k of ["operatorFeeScalar","operatorFeeConstant","operatorFee"])if(r[k]!==undefined&&q(r[k])!==0n)refuse("merchant_receipt_operator_unreviewed");
  const execution=q(r.gasUsed)*q(r.effectiveGasPrice),l1=q(r.l1Fee);return {execution:execution.toString(),l1:l1.toString(),operator:"0",total:(execution+l1).toString()};
}
/**
 * v2 fee rule (new operations): the paid fee from the receipt's own fields, as LI.FI's bridgeActualFees reads Base:
 * execution plus `l1Fee` plus the Jovian operator fee (gasUsed * operatorFeeScalar * 100 + operatorFeeConstant).
 */
export function merchantReceiptFee(r:Record<string,unknown>):MerchantPaidFee {
  if(q(r.type)!==2n||r.l1Fee===undefined||q(r.gasUsed)===0n||r.blobGasUsed!==undefined&&q(r.blobGasUsed)!==0n)refuse("merchant_receipt_full_fee_type");
  let fee:ReturnType<typeof decodeRelayBaseReceiptFee>;
  try{fee=decodeRelayBaseReceiptFee(r);}catch{return refuse("merchant_receipt_operator_shape");}
  return {execution:fee.l2ExecutionFeeWei,l1:fee.l1FeeWei,operator:fee.operatorFeeWei,total:fee.totalFeeWei};
}
/** Block-wide payer debit witness is explicit; it never attributes a two-transaction delta to one target. */
export async function merchantPayerDebit(rpc:MerchantRpcPort,owner:string,blockValue:unknown,target:Record<string,unknown>,budget:string,feeOf:(r:Record<string,unknown>)=>MerchantPaidFee=merchantActualFee):Promise<{before:string;after:string;aggregateDebit:string;transactionHashes:readonly Hex[];evidenceHash:string}> {
  const block=obj(blockValue),number=q(block.number),blockHash=hash(block.hash);if(number===0n||!Array.isArray(block.transactions))refuse("merchant_receipt_payer_block");
  const rows=block.transactions.map(obj),outgoing=rows.filter(t=>getAddress(String(t.from))===getAddress(owner));
  if(outgoing.length<1||outgoing.length>8||rows.some(t=>t.to!==null&&getAddress(String(t.to))===getAddress(owner)))refuse("merchant_receipt_payer_ambiguity");
  const hashes=outgoing.map(t=>hash(t.hash));if(new Set(hashes).size!==hashes.length||hashes.filter(h=>h===hash(target.transactionHash)).length!==1)refuse("merchant_receipt_payer_membership");
  const receipts=await rpc.batch(hashes.map(h=>({method:"eth_getTransactionReceipt",params:[h]})));let aggregate=0n;
  for(let i=0;i<outgoing.length;i++){const tx=outgoing[i]!,r=obj(receipts[i]);if(hash(r.transactionHash)!==hash(tx.hash)||hash(r.blockHash)!==blockHash||q(r.blockNumber)!==number||q(tx.blockNumber)!==number||hash(tx.blockHash)!==blockHash||q(r.transactionIndex)!==q(tx.transactionIndex)||q(tx.transactionIndex)>=BigInt(rows.length)||hash(rows[Number(q(tx.transactionIndex))]!.hash)!==hash(tx.hash)||getAddress(String(r.to))!==getAddress(String(tx.to))||getAddress(String(r.from))!==getAddress(owner)||q(tx.type)!==2n||q(tx.chainId)!==4326n||q(r.status)!==0n&&q(r.status)!==1n)refuse("merchant_receipt_payer_binding");
    if(hash(r.transactionHash)===hash(target.transactionHash)&&hashObject(r)!==hashObject(target))refuse("merchant_receipt_payer_receipt_changed");
    const price=q(r.effectiveGasPrice),offered=q(block.baseFeePerGas)+q(tx.maxPriorityFeePerGas),cap=q(tx.maxFeePerGas);
    if(q(r.gasUsed)>q(tx.gas)||price!==(cap<offered?cap:offered))refuse("merchant_receipt_payer_gas_binding");
    aggregate+=BigInt(feeOf(r).total)+(q(r.status)===1n?q(tx.value):0n);}
  if(BigInt(feeOf(target).total)>BigInt(budget))refuse("merchant_receipt_full_fee_budget");
  const prev=obj(await rpc.call("eth_getBlockByNumber",[`0x${(number-1n).toString(16)}`,false])),previousHash=hash(prev.hash);if(q(prev.number)!==number-1n||hash(block.parentHash)!==previousHash)refuse("merchant_receipt_payer_parent");
  const [before,after,again]=await rpc.batch([{method:"eth_getBalance",params:[owner,{blockHash:previousHash,requireCanonical:true}]},{method:"eth_getBalance",params:[owner,{blockHash,requireCanonical:true}]},{method:"eth_getBlockByNumber",params:[`0x${number.toString(16)}`,true]}]);
  if(hash(obj(again).hash)!==blockHash||hashObject(obj(again).transactions)!==hashObject(block.transactions)||q(before)-q(after)!==aggregate)refuse("merchant_receipt_payer_debit");
  return {before:q(before).toString(),after:q(after).toString(),aggregateDebit:aggregate.toString(),transactionHashes:hashes,evidenceHash:hashObject({receipts,prev,before,after,again})};
}
