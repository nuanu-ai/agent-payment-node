import { decodeFunctionResult, encodeFunctionData, erc20Abi } from "viem";
import { hashObject } from "../canonical.js";
import type { MerchantOperation } from "./model.js";
import { deploymentMatches, deploymentReads, merchantCurrent, object, quantity, hexHash, bytes, readNamed, type MerchantRpcPort } from "./rpc.js";
import { merchantTerms } from "./terms.js";
import { refuse } from "./protocol.js";
/** Absence of effects is established by dispatch fences; canonical unchanged state is supporting evidence. */
export async function merchantUnsentProof(rpc:MerchantRpcPort,o:MerchantOperation):Promise<string>{
 if(o.feeContext===undefined)refuse("merchant_retirement_new_claims_only");
 const t=merchantTerms(o);
 await merchantCurrent(rpc,t,o.envelope); // Fresh finite chain, token/proxy/domain/owner identity. Never authorizes signing.
 const original=object(await rpc.call("eth_getBlockByNumber",[`0x${BigInt(o.feeContext.anchorNumber).toString(16)}`,false])),safe=object(await rpc.call("eth_getBlockByNumber",["safe",false]));
 if(hexHash(original.hash)!==o.feeContext.anchorHash||quantity(original.number)!==BigInt(o.feeContext.anchorNumber)||quantity(safe.number)<quantity(original.number))refuse("merchant_retirement_anchor");
 const read=async(head:Record<string,unknown>)=>{const tag={blockHash:hexHash(head.hash),requireCanonical:true};const v=await readNamed(rpc,[
  ["nonce",{method:"eth_getTransactionCount",params:[t.payer,tag]}],["native",{method:"eth_getBalance",params:[t.payer,tag]}],
  ["token",{method:"eth_call",params:[{to:t.token,data:encodeFunctionData({abi:erc20Abi,functionName:"balanceOf",args:[t.payer as `0x${string}`]})},tag]}],
  ...deploymentReads(t,tag),["anchor",{method:"eth_getBlockByNumber",params:[head.number,false]}]] as const);
  if(!deploymentMatches(t,v)||hexHash(object(v.anchor).hash)!==hexHash(head.hash))refuse("merchant_retirement_runtime_or_reanchor");
  return {nonce:quantity(v.nonce).toString(),native:quantity(v.native).toString(),token:decodeFunctionResult({abi:erc20Abi,functionName:"balanceOf",data:bytes(v.token)}).toString(),head};};
 const before=await read(original),after=await read(safe);
 if(before.nonce!==o.envelope.nonce||after.nonce!==before.nonce||after.native!==before.native||after.token!==before.token)refuse("merchant_retirement_owner_state_changed");
 return hashObject({before,after,operationId:o.operationId,fingerprint:o.fingerprint});
}
