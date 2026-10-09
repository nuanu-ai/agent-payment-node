import { decodeFunctionResult, encodeFunctionData, erc20Abi, keccak256 } from "viem";
import { hashObject } from "../canonical.js";
import type { MerchantOperation } from "./model.js";
import { merchantCurrent, object, quantity, hexHash, bytes, type MerchantRpcPort } from "./rpc.js";
import { MERCHANT_OWNER, MERCHANT_TOKEN, MERCHANT_PROXY_HASH, MERCHANT_IMPLEMENTATION, MERCHANT_IMPLEMENTATION_HASH } from "./pins.js";
import { refuse } from "./protocol.js";
const SLOT="0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** Absence of effects is established by dispatch fences; canonical unchanged state is supporting evidence. */
export async function merchantUnsentProof(rpc:MerchantRpcPort,o:MerchantOperation):Promise<string>{
 if(o.feeContext===undefined)refuse("merchant_retirement_new_claims_only");
 await merchantCurrent(rpc,o.envelope); // Fresh finite chain, token/proxy/domain/owner identity. Never authorizes signing.
 const original=object(await rpc.call("eth_getBlockByNumber",[`0x${BigInt(o.feeContext.anchorNumber).toString(16)}`,false])),safe=object(await rpc.call("eth_getBlockByNumber",["safe",false]));
 if(hexHash(original.hash)!==o.feeContext.anchorHash||quantity(original.number)!==BigInt(o.feeContext.anchorNumber)||quantity(safe.number)<quantity(original.number))refuse("merchant_retirement_anchor");
 const read=async(head:Record<string,unknown>)=>{const tag={blockHash:hexHash(head.hash),requireCanonical:true};const v=await rpc.batch([
  {method:"eth_getTransactionCount",params:[MERCHANT_OWNER,tag]}, {method:"eth_getBalance",params:[MERCHANT_OWNER,tag]},
  {method:"eth_call",params:[{to:MERCHANT_TOKEN,data:encodeFunctionData({abi:erc20Abi,functionName:"balanceOf",args:[MERCHANT_OWNER]})},tag]},
  {method:"eth_getCode",params:[MERCHANT_TOKEN,tag]},{method:"eth_getStorageAt",params:[MERCHANT_TOKEN,SLOT,tag]},{method:"eth_getCode",params:[MERCHANT_IMPLEMENTATION,tag]},
  {method:"eth_getBlockByNumber",params:[head.number,false]}]);
  if(keccak256(bytes(v[3]))!==MERCHANT_PROXY_HASH||bytes(v[4])!==`0x${MERCHANT_IMPLEMENTATION.slice(2).toLowerCase().padStart(64,"0")}`||keccak256(bytes(v[5]))!==MERCHANT_IMPLEMENTATION_HASH||hexHash(object(v[6]).hash)!==hexHash(head.hash))refuse("merchant_retirement_runtime_or_reanchor");
  return {nonce:quantity(v[0]).toString(),native:quantity(v[1]).toString(),token:decodeFunctionResult({abi:erc20Abi,functionName:"balanceOf",data:bytes(v[2])}).toString(),head};};
 const before=await read(original),after=await read(safe);
 if(before.nonce!==o.envelope.nonce||after.nonce!==before.nonce||after.native!==before.native||after.token!==before.token)refuse("merchant_retirement_owner_state_changed");
 return hashObject({before,after,operationId:o.operationId,fingerprint:o.fingerprint});
}
