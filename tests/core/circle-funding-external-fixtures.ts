import { circleEnvelope } from "../../src/circle-v2-evm/operation-model.js";
import { mkdtemp, realpath, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";import { join } from "node:path";
import { decodeFunctionData, encodeFunctionResult, getAddress, keccak256, serializeTransaction, toRlp, toEventSelector, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StateStore,sealWallet } from "../../src/state.js";import { canonicalJson,hashObject } from "../../src/canonical.js";
import { projectLegacyLocalProfile } from "../../src/provider-profile.js";import { evmNativeCustody } from "../../src/evm-native-custody.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { CircleUsage } from "../../src/circle-v2-evm/usage.js";import { CircleRepository } from "../../src/circle-v2-evm/repository.js";
import { CircleFundingEvmService } from "../../src/circle-v2-evm/funding-runtime.js";import { CIRCLE_RPC_ABI } from "../../src/circle-v2-evm/rpc.js";
import { CIRCLE_SOURCE_OWNER,CIRCLE_SOURCE_TOKEN,CIRCLE_MESSENGER,CIRCLE_MINTER,CIRCLE_TRANSMITTER,circleLegacyRoute as circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { advanceCircleFundingOperation as advanceCircle, sealCircleFundingOperation as sealCircle, circleFundingFingerprint, type CircleFundingOperationV2 } from "../../src/circle-v2-evm/funding-operation.js";
import { circleFundingBinding, quoteCircleFundingFee } from "../../src/circle-v2-evm/funding-binding.js";
import { bindCircleAttestation,decodeCircleSource,verifyCircleApproval,encodeCircleApproval,encodeCircleBurn,encodeCircleMint,circleWord,type CircleObservation } from "../../src/circle-v2-evm/protocol.js";
import { source,event,observation,iris,message,snapshot } from "./circle-v2-evm-runtime-fixtures.js";import { initial,at,fundingIdentity } from "./circle-v2-evm-nonce-runtime-fixtures.js";
export const actor=privateKeyToAccount(`0x${"09".padStart(64,"0")}`),q=(n:bigint|number)=>`0x${BigInt(n).toString(16)}`;
export const testFeeRecipient=getAddress("0xfc1bdd1ff58200761d56ccbce73f6f42ebe56379");
const hash=(v:string)=>`0x${v.repeat(64).slice(0,64)}` as Hex,approvalHash=hash("a"),burnHash=hash("b");
function bytesQuantity(n:unknown):Hex{const x=BigInt(String(n)),s=x.toString(16);return x===0n?"0x":`0x${s.padStart(Math.ceil(s.length/2)*2,"0")}`;}
export function block(number:number,transactions:Hex[]=[],parentHash=hash("1"),timeBase=1900000000):Record<string,unknown>{
 const b:Record<string,unknown>={parentHash,sha3Uncles:hash("2"),miner:getAddress(`0x${"3".repeat(40)}`),stateRoot:hash("4"),transactionsRoot:hash("5"),receiptsRoot:hash("6"),logsBloom:`0x${"00".repeat(256)}`,difficulty:"0x0",number:q(number),gasLimit:"0x989680",gasUsed:"0x493e0",timestamp:q(timeBase+number),extraData:"0x",mixHash:hash("7"),nonce:`0x${"00".repeat(8)}`,baseFeePerGas:"0x1312d00",transactions};
 const fields=[...(["parentHash","sha3Uncles","miner","stateRoot","transactionsRoot","receiptsRoot","logsBloom"].map(k=>b[k])),...(["difficulty","number","gasLimit","gasUsed","timestamp"].map(k=>bytesQuantity(b[k]))),b.extraData,b.mixHash,b.nonce,bytesQuantity(b.baseFeePerGas)];b.hash=keccak256(toRlp(fields as Hex[]));return b;
}
function normalize(o:{-readonly [K in keyof CircleObservation]:CircleObservation[K]},header:Record<string,unknown>,tx:Hex,nonce:number,gas:number){const h=header.hash,n=header.number;
 o.canonicalBlock=header;o.recheckedBlock=header;o.finalityHead=block(20);o.finalityTag=o.chainId===42161?"finalized":"safe";
 o.transaction={...(o.transaction as object),hash:tx,nonce:q(nonce),gas:q(gas),maxFeePerGas:"0x1312d00",maxPriorityFeePerGas:"0x0",transactionIndex:"0x0",blockNumber:n,blockHash:h};
 const r=o.receipt as Record<string,unknown>;o.receipt={...r,transactionHash:tx,transactionIndex:"0x0",blockNumber:n,blockHash:h,gasUsed:q(gas),effectiveGasPrice:"0x1312d00",logs:(r.logs as Record<string,unknown>[]).map(l=>({...l,transactionHash:tx,transactionIndex:"0x0",blockNumber:n,blockHash:h}))};return o;
}
function fundingInitial(root:string):CircleFundingOperationV2 {
 const old=initial(root),funding=circleFundingBinding(143,fundingIdentity(old),{recipient:getAddress(`0x${"77".repeat(20)}`),amountAtomic:"510000",maxFeeAtomic:"1000",minMintAtomic:"509000"}),feeQuote=quoteCircleFundingFee(funding,[{finalityThreshold:1000,minimumFee:1}],at,at);
 const {externalFulfillment:_e,nonceRetirement:_n,schemaVersion:_s,integrityHash:_h,...body}=old;
 const op=sealCircle({...body,schemaVersion:"apn.circle-v2-evm-operation.v2",funding,feeQuote,feeQuoteAtomic:feeQuote.quotedFeeAtomic,state:"awaiting_source",expiresAt:new Date(at+900000).toISOString(),effects:body.effects.map(e=>({...e,envelope:{...e.envelope,data:e.role==="burn"?encodeCircleBurn(143,funding):encodeCircleApproval(false,funding)}}))} as Omit<CircleFundingOperationV2,"integrityHash">);
 return sealCircle({...op,effects:op.effects.map(e=>{const {envelopeHash:_h,...body}=e.envelope;return {...e,envelope:circleEnvelope(body)};})});
}
function fundingMessage(op:CircleFundingOperationV2,attested=false,fee=71n,expiry=1000n):Hex {
 let b=message(143,attested,fee,1000n,expiry);const put=(offset:number,v:string)=>{b=`${b.slice(0,2+offset*2)}${v}${b.slice(2+(offset+32)*2)}` as Hex;};
 put(184,circleWord(op.funding.recipient).slice(2));put(216,BigInt(op.funding.amountAtomic).toString(16).padStart(64,"0"));put(280,BigInt(op.funding.maxFeeAtomic).toString(16).padStart(64,"0"));return b;
}
function fundingSource(op:CircleFundingOperationV2){return observation(42161,CIRCLE_SOURCE_OWNER,CIRCLE_MESSENGER,encodeCircleBurn(143,op.funding),[event("MessageSent",CIRCLE_TRANSMITTER,{message:fundingMessage(op)},0),event("DepositForBurn",CIRCLE_MESSENGER,{burnToken:CIRCLE_SOURCE_TOKEN,amount:510000n,depositor:CIRCLE_SOURCE_OWNER,mintRecipient:circleWord(op.funding.recipient),destinationDomain:15,destinationTokenMessenger:circleWord(CIRCLE_MESSENGER),destinationCaller:`0x${"0".repeat(64)}`,maxFee:1000n,minFinalityThreshold:1000,hookData:"0x"},1)]);}
async function fundingIris(op:CircleFundingOperationV2,proof:ReturnType<typeof decodeCircleSource>,fee:bigint,expiry:bigint){
 const bytes=fundingMessage(op,true,fee,expiry),{decodeCircleMessage,CIRCLE_ZERO}=await import("../../src/circle-v2-evm/protocol.js"),m=decodeCircleMessage(bytes,143,true,op.funding);
 const signers=[1n,2n].map(n=>privateKeyToAccount(`0x${n.toString(16).padStart(64,"0")}`)).sort((a,b)=>BigInt(a.address)<BigInt(b.address)?-1:1),sigs=await Promise.all(signers.map(x=>x.sign({hash:keccak256(bytes)})));
 return {sourceTxHash:proof.transactionHash,messages:[{cctpVersion:2,status:"complete",eventNonce:m.nonce,message:bytes,attestation:`0x${sigs.map(x=>x.slice(2)).join("")}`,decodedMessage:{sourceDomain:"3",destinationDomain:"15",nonce:m.nonce,sender:circleWord(CIRCLE_MESSENGER),recipient:circleWord(CIRCLE_MESSENGER),destinationCaller:CIRCLE_ZERO,messageBody:m.body,minFinalityThreshold:"1000",finalityThresholdExecuted:"1000",decodedMessageBody:{burnToken:circleWord(CIRCLE_SOURCE_TOKEN),mintRecipient:circleWord(op.funding.recipient),amount:op.funding.amountAtomic,messageSender:circleWord(CIRCLE_SOURCE_OWNER),maxFee:op.funding.maxFeeAtomic,feeExecuted:m.feeExecutedAtomic,expirationBlock:m.expirationBlock,hookData:"0x"}}}]};
}
/** Destination layout: the external mint's block, the destination head, the time of destination block 0 (one block per
 * second), the local gas payer's nonce and the attestation's expiration block. Defaults keep the original blocks 9/10/20. */
export interface ExternalLayout { readonly mintBlock: number; readonly head: number; readonly timeBase: number; readonly gasPayerNonce: number; readonly expiry: bigint; }
export async function fundingExternalFixture(revisions=false,issuerFee=71n,options:Partial<ExternalLayout>={}){
 const layout:ExternalLayout={mintBlock:10,head:20,timeBase:1900000000,gasPayerNonce:3,expiry:1000n,...options};
 const net=510000n-issuerFee;
 const root=await realpath(await mkdtemp(join(tmpdir(),"circle-external-"))),state=new StateStore(root),repo=new CircleRepository(root),usage=new CircleUsage(state,()=>at),policies=new AllowlistPolicyStore(root);await state.initialize();let op=fundingInitial(root);
 for(const [profile,address] of [[op.profile,CIRCLE_SOURCE_OWNER],[op.destinationProfile,circleRoute(143).gasPayer]] as const){const wallet=sealWallet({schemaVersion:"apn.state.v1",profile,profileHash:state.profileHash(profile),address,createdAt:new Date(at).toISOString(),bindingHash:"a".repeat(64)});await state.writeWallet(wallet);await state.writeProviderProfile(projectLegacyLocalProfile(wallet));}
 op=sealCircle({...op,sourceCustody:await evmNativeCustody(state,op.profile),destinationCustody:await evmNativeCustody(state,op.destinationProfile)});
 for(const profile of [op.profile,op.destinationProfile]){let record;const max=revisions?(profile===op.profile?35:17):1;
 for(let i=1;i<=max;i++)record=await policies.stage({profile,...(i===1?{}:{expectedRevision:i-1}),now:new Date(at),policy:{schemaVersion:"apn.allowlist-policy-file.v1",overlayVersion:`old${i}`,accounts:{evm:profile===op.profile?CIRCLE_SOURCE_OWNER:circleRoute(143).gasPayer},effectiveAt:new Date(at-1).toISOString(),expiresAt:new Date(at+1000).toISOString(),admissions:[{chain:"eip155:42161",kind:"token",identifier:CIRCLE_SOURCE_TOKEN,rail:"bridge",maximumPerTransferAtomic:"510000",dailyLimitAtomic:"510000",mechanism:op.funding.mechanism},{chain:"eip155:42161",kind:"native",rail:"bridge",maximumPerTransferAtomic:"30000000000000",dailyLimitAtomic:"75000000000000",mechanism:op.funding.mechanism},{chain:"eip155:143",kind:"native",rail:"bridge",maximumPerTransferAtomic:"100000000000000000",dailyLimitAtomic:"100000000000000000",mechanism:op.funding.mechanism}]}});
 await policies.appendDecision(profile,null,{status:"active",revision:record!.revision,stagedRecordDigest:record!.recordDigest,policyDigest:record!.registry.policyDigest,registry:record!.registry,approvalFingerprint:hashObject(profile),decidedAt:new Date(at).toISOString()});}
 const frozen=await usage.withPolicyLocks([op.profile,op.destinationProfile],()=>usage.policies(op));op=sealCircle({...op,policies:frozen});op=advanceCircle(sealCircle({...op,fingerprint:circleFundingFingerprint(op),transitions:[]}),{},"prepared",at);await repo.saveFunding(op);
 op=advanceCircle(op,{usage:await usage.withPolicyLocks([op.profile,op.destinationProfile],()=>usage.reserve(op))},"reserved",at);await repo.saveFunding(op);
 const approvalHeader=block(9,[approvalHash]),burnHeader=block(10,[burnHash]);
 const approval=normalize(observation(42161,CIRCLE_SOURCE_OWNER,CIRCLE_SOURCE_TOKEN,encodeCircleApproval(false,op.funding),[event("Approval",CIRCLE_SOURCE_TOKEN,{owner:CIRCLE_SOURCE_OWNER,spender:CIRCLE_MESSENGER,value:510000n},0)]),approvalHeader,approvalHash,1,65536);
 const burn=normalize(fundingSource(op),burnHeader,burnHash,2,500000);const approvalProof=verifyCircleApproval(approval,false,"510000",op.funding),sourceProof=decodeCircleSource(burn,143,op.funding);
 for(const role of ["approval","burn"] as const){for(const phase of ["signing_started","sealed","submission_started","submitted","confirmed"] as const){op=advanceCircle(op,{state:"source_unknown",effects:op.effects.map(e=>e.role===role?{...e,phase,...(phase==="signing_started"?{}:{transactionHash:role==="approval"?approvalHash:burnHash,materialHash:"8".repeat(64)}),...(phase==="confirmed"?{proof:role==="approval"?approvalProof:sourceProof}:{})}:e)},`${role}_${phase}`,at);await repo.saveFunding(op);}}
 const attestation=await bindCircleAttestation(sourceProof,await fundingIris(op,sourceProof,issuerFee,layout.expiry),snapshot(143),op.funding);
 op=advanceCircle(op,{source:sourceProof,attestation,residualAllowanceAtomic:"0",state:"awaiting_mint",usage:await usage.follow(op,"unknown_finality")},"attestation",at);await repo.saveFunding(op);
 // Current successors are deliberately different and old authorizations expired; adoption has no mint authority.
 for(const profile of [op.profile,op.destinationProfile]){const head=(await policies.read(profile)).entries.at(-1)!;const record=await policies.stage({profile,expectedRevision:head.revision,now:new Date(at+2000),policy:{schemaVersion:"apn.allowlist-policy-file.v1",overlayVersion:"new-no-circle",accounts:{evm:profile===op.profile?CIRCLE_SOURCE_OWNER:circleRoute(143).gasPayer},effectiveAt:new Date(at+1000).toISOString(),expiresAt:new Date(at+7200000).toISOString(),admissions:[{chain:"eip155:42161",kind:"native",rail:"direct",maximumPerTransferAtomic:"1",dailyLimitAtomic:"1"}]}});await policies.appendDecision(profile,head.entryDigest,{status:"active",revision:record.revision,stagedRecordDigest:record.recordDigest,policyDigest:record.registry.policyDigest,registry:record.registry,approvalFingerprint:hashObject("new"+profile),decidedAt:new Date(at+2000).toISOString()});}
 const unsigned={type:"legacy" as const,chainId:143,nonce:3,gas:500000n,gasPrice:20000000n,to:CIRCLE_TRANSMITTER,value:0n,data:encodeCircleMint(attestation)},raw=await actor.signTransaction(unsigned),txHash=keccak256(raw);
 // Obtain the public signature fields without loading any production wallet.
 const {parseTransaction}=await import("viem"),signed=parseTransaction(raw);const parent=block(layout.mintBlock-1,[],hash("1"),layout.timeBase),destHeader=block(layout.mintBlock,[txHash],parent.hash as Hex,layout.timeBase);
 const v2Mint=event("MintAndWithdraw",CIRCLE_MESSENGER,{mintRecipient:op.funding.recipient,amount:net,mintToken:circleRoute(143).token,feeCollected:issuerFee},2) as Record<string,unknown>;v2Mint.topics=[toEventSelector("MintAndWithdraw(address,uint256,address,uint256)"),...(v2Mint.topics as string[]).slice(1)];v2Mint.data=`0x${net.toString(16).padStart(64,"0")}${issuerFee.toString(16).padStart(64,"0")}`;
 const dest=normalize(observation(143,actor.address,CIRCLE_TRANSMITTER,unsigned.data,[event("Transfer",circleRoute(143).token,{from:getAddress(`0x${"0".repeat(40)}`),to:op.funding.recipient,value:net},0),...(issuerFee===0n?[]:[event("Transfer",circleRoute(143).token,{from:getAddress(`0x${"0".repeat(40)}`),to:testFeeRecipient,value:issuerFee},1)]),v2Mint,event("MessageReceived",CIRCLE_TRANSMITTER,{caller:actor.address,sourceDomain:3,nonce:attestation.nonce,sender:circleWord(CIRCLE_MESSENGER),finalityThresholdExecuted:1000,messageBody:attestation.body},3)]),destHeader,txHash,3,500000);
 dest.transaction={...(dest.transaction as object),type:"0x0",chainId:"0x8f",gasPrice:"0x1312d00",r:signed.r,s:signed.s,v:q(signed.v!),from:actor.address};
 const received=((dest.receipt as Record<string,unknown>).logs as Record<string,unknown>[]).find(l=>String(l.address).toLowerCase()===CIRCLE_TRANSMITTER.toLowerCase())!;
 const destBlock=(n:number)=>n===layout.mintBlock?destHeader:n===layout.mintBlock-1?parent:block(n,[],hash("1"),layout.timeBase);
 // `chain` is the mutable public state; `historical` records every state read at a block other than a head (P1), refused as a pruned node refuses it.
 const chain={usedNonce:1n,ownTransactions:new Map<string,{transaction:unknown;receipt:unknown}>()},calls:string[]=[],historical:string[]=[],logWindows:{from:bigint;to:bigint}[]=[];
 const answer=(network:number,{method,params,id}:{method:string;params:any[];id:unknown})=>{calls.push(method);let result:unknown;
 if(["eth_call","eth_getCode","eth_getStorageAt","eth_getBalance"].includes(method)&&!["latest","safe","finalized"].includes(params.at(-1))){historical.push(`${network}:${method}:${JSON.stringify(params.at(-1))}`);return{jsonrpc:"2.0",id,error:{code:-32000,message:"historical state is not available"}};}
 if(method==="eth_chainId")result=q(network);
 else if(method==="eth_getTransactionByHash"||method==="eth_getTransactionReceipt"){const o=params[0]===approvalHash?approval:params[0]===burnHash?burn:params[0]===txHash?dest:chain.ownTransactions.get(params[0])??null;result=o===null?null:method==="eth_getTransactionByHash"?o.transaction:o.receipt;}
 else if(method==="eth_getBlockByNumber"){const tag=params[0],head=["latest","safe","finalized"].includes(tag);result=network===42161?(head||BigInt(tag)===20n?block(20):BigInt(tag)===9n?approvalHeader:BigInt(tag)===10n?burnHeader:block(Number(BigInt(tag)))):destBlock(head?layout.head:Number(BigInt(tag)));}
 else if(method==="eth_getTransactionCount")result=q(layout.gasPayerNonce);
 else if(method==="eth_getLogs"&&network===143){const filter=params[0],from=BigInt(filter.fromBlock),to=BigInt(filter.toBlock);logWindows.push({from,to});
  result=String(filter.address).toLowerCase()===CIRCLE_TRANSMITTER.toLowerCase()&&canonicalJson(filter.topics)===canonicalJson([(received.topics as string[])[0],null,attestation.nonce])&&BigInt(layout.mintBlock)>=from&&BigInt(layout.mintBlock)<=to?[received]:[];}
 else if(method==="eth_call"){const f=decodeFunctionData({abi:CIRCLE_RPC_ABI,data:params[0].data}),name=f.functionName,args=f.args as readonly unknown[]|undefined;let v:unknown;
 switch(name){case"localDomain":v=network===42161?3:15;break;case"remoteTokenMessengers":v=circleWord(CIRCLE_MESSENGER);break;case"remoteTokensToLocalTokens":v=network===42161?CIRCLE_SOURCE_TOKEN:circleRoute(143).token;break;case"localMinter":v=CIRCLE_MINTER;break;case"localMessageTransmitter":v=CIRCLE_TRANSMITTER;break;case"localTokenMessenger":v=CIRCLE_MESSENGER;break;case"version":case"messageBodyVersion":v=1;break;case"decimals":v=6;break;case"paused":v=false;break;case"usedNonces":v=chain.usedNonce;break;case"balanceOf":v=net;break;case"getEnabledAttester":v=snapshot(143).enabledAttesters[Number(args![0])];break;default:throw Error(`FORBIDDEN_VIEW ${name}`);}
 result=encodeFunctionResult({abi:CIRCLE_RPC_ABI,functionName:name,result:v as never});}
 else throw Error(`FORBIDDEN_NETWORK_METHOD ${method}`);return{jsonrpc:"2.0",id,result};};
 const publicNetwork={request:async(url:string,_method:unknown,body:string|null)=>{const request=JSON.parse(body!),network=url.includes("arbitrum")?42161:143;
  return{status:200,body:JSON.stringify(Array.isArray(request)?request.map(r=>answer(network,r)):answer(network,request))};}};
 const secret={load:async()=>{throw Error("PRIVATE_READ");},create:async()=>{throw Error("PRIVATE_CREATE");}};
 const service=new CircleFundingEvmService(state,secret,{APN_ARBITRUM_RPC_URL:"https://arbitrum.example",APN_MONAD_RPC_URL:"https://monad.example"},()=>at+3000,{},publicNetwork as never);
 return{root,state,repo,usage,policies,op,service,publicNetwork,calls,historical,logWindows,chain,layout,dest,burn,approval,parent,txHash,secret,attestation};
}
