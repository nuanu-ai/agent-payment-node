import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson,domainHash } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest } from "../../src/circle-v2-evm/cleanup85-recovery-store.js";
import { activeAssetPolicyFromState } from "../../src/allowlist-active-policy.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { evmNativeCustody } from "../../src/evm-native-custody.js";
import { activateDirectPolicy, directAdmission } from "./direct-allowlist-helpers.js";
import type { CircleOperationV1 } from "../../src/circle-v2-evm/operation-model.js";
import type { CircleNonceRetirementIntent } from "../../src/circle-v2-evm/nonce-retirement-store.js";
import type { WalletRecord } from "../../src/model.js";
import type { ProviderProfileRecord } from "../../src/provider-profile.js";
export const fixtureNow=Date.parse("2026-10-09T12:20:00.000Z");
/** Actual captured unsigned public metadata. Dummy encrypted headers never contain a private key
 * and the production fixture broker must throw before any decryption or signing. */
export async function cleanup85PublicState(root:string){
 const captured=JSON.parse(await readFile(new URL("../fixtures/cleanup85-native/public-metadata.json",import.meta.url),"utf8")) as {parent:CircleOperationV1;retirement:{intent:CircleNonceRetirementIntent;authority:unknown;sign:unknown};wallets:Record<string,WalletRecord>;providers:Record<string,ProviderProfileRecord>};
 const state=new StateStore(root);await state.initialize();
 const put=async(path:string,body:unknown)=>{await mkdir(join(root,path.split("/").slice(0,-1).join("/")),{recursive:true,mode:0o700});await writeFile(join(root,path),canonicalJson(body)+"\n",{mode:0o600});};
 const op=captured.parent;await put(`circle-v2-evm/${op.operationId}.json`,op);
 for(const [suffix,body]of Object.entries(captured.retirement))await put(`circle-v2-nonce-retirements/${op.operationId}-${suffix}.json`,body);
 for(const [profile,wallet]of Object.entries(captured.wallets)){
  await state.writeNewWallet(wallet);if(captured.providers[profile]!==null)await put(`profiles/${wallet.profileHash}/profile.json`,captured.providers[profile]);
  await state.writeEncryptedWalletEnvelope(profile,{schemaVersion:"apn.wallet-envelope.v1",identity:{profile,address:wallet.address,chainId:8453,createdAt:wallet.createdAt,bindingHash:wallet.bindingHash},kdf:{name:"HKDF-SHA-256",salt:"AA=="},cipher:{name:"AES-256-GCM",nonce:"AA==",ciphertext:"AA==",tag:"AA=="}});
 }
 for(const effect of op.effects)await put(`circle-v2-evm-effects/${op.operationId}-${effect.role}.json`,{schemaVersion:"apn.circle-v2-evm-effect-envelope.v1",operationId:op.operationId,role:effect.role,fingerprint:op.fingerprint,envelopeHash:effect.envelope.envelopeHash,salt:"AA==",nonce:"AA==",ciphertext:"AA==",tag:"AA=="});
 for(const row of op.usage){const identity={account:row.account,chain:row.chain,asset:row.asset};await put(`asset-usage/${domainHash("apn.asset-usage-bucket.v1",canonicalJson(identity))}/${row.reservationId}.json`,row);}
 const now=new Date(fixtureNow);await activateDirectPolicy(root,op.profile,{accounts:{evm:op.sourceCustody.walletAddress},admissions:[directAdmission("eip155:42161",null,{maximumPerTransferAtomic:"2000000000000",dailyLimitAtomic:"500000000000000"})],now,expiresAt:"2026-10-09T16:20:00.000Z"});
 const policy=activeAssetPolicyFromState(await new AllowlistPolicyStore(root).read(op.profile),now)!;
 const policies=captured.retirement.authority as {policies:CircleOperationV1["policies"]};
 const frame=await new Cleanup85RecoveryStore(root).start(op,captured.retirement.intent,{sourceCustody:op.sourceCustody,destinationCustody:op.destinationCustody,recipientCustody:await evmNativeCustody(state,"default"),policies:policies.policies,capturedAt:now.toISOString(),windowEndsAt:"2026-10-09T16:20:00.000Z",evidence:captured.retirement.intent.consumedBurn!});
 return {state,request:cleanup85CancellationRequest(frame),parent:op,policy};
}
import { approvalObservationFixture } from "./circle-v2-evm-approval-public-fixture.js";
import { consumerTransaction, consumerReceipt } from "./circle-v2-evm-consumed-public-fixture.js";
import { CIRCLE_SOURCE_TOKEN } from "../../src/circle-v2-evm/catalog.js";
import type { BridgeHttps } from "../../src/lifi/https.js";
/** Captured runtime/code/headers and authentic83/84 signatures; unchanged public account values
 * are explicit deterministic fixture projections, never a claim of a new live financial preflight. */
export async function cleanup85PublicTransport(){
 const read=async(name:string)=>JSON.parse(await readFile(new URL(`../fixtures/cleanup85-native/${name}`,import.meta.url),"utf8"));
 const deployments=(await read("public-deployments.json")).responses as {endpoint:string;method:string;params:unknown[];result:unknown}[],native=await read("native-snapshot-responses.json") as {endpoint:string;method:string;params:unknown[];body:string}[],snapshot=await read("native-snapshot-proof.json"),consumer=await read("nonce84-block.json");
 const wire=await read("consumer-wire-responses.json") as {method:string;body:string}[];
 const consumerTx=JSON.parse(wire.find(x=>x.method==="eth_getTransactionByHash")!.body).result,consumerRx=JSON.parse(wire.find(x=>x.method==="eth_getTransactionReceipt")!.body).result;
 const consumerBlock=consumer.result??consumer.response?.result;
 if(consumerBlock===undefined)throw Error("uncaptured_nonce84_header");
 const rows: {method:string;params:unknown[];phase:string;endpoint:string}[]=[];
 const blocks=new Map<string,unknown>();for(const r of deployments)if(r.method==="eth_getBlockByNumber")blocks.set(String(r.params[0]),r.result);
 blocks.set(approvalObservationFixture.canonicalBlock.number,approvalObservationFixture.canonicalBlock);blocks.set(consumerBlock.number,consumerBlock);blocks.set(approvalObservationFixture.finalityHead.number,approvalObservationFixture.finalityHead);blocks.set(snapshot.archiveAnchor.number,snapshot.archiveAnchor);
 let phase="prepare";
 const https:Pick<BridgeHttps,"request">={request:async(url,_method,body)=>{
  const r=JSON.parse(body!);rows.push({method:r.method,params:r.params,phase,endpoint:url});if(r.method==="eth_sendRawTransaction")throw Error("fixture_financial_network_FORBIDDEN");
  const chain=url.includes("sei")?1329:42161,record=deployments.find(x=>(x.endpoint.includes("sei")?1329:42161)===chain&&x.method===r.method&&canonicalJson(x.params)===canonicalJson(r.params));
  let result:unknown;
  if(record!==undefined)result=record.result;
  else if(r.method==="eth_chainId")result=chain===42161?"0xa4b1":"0x531";
  else if(r.method==="eth_getBlockByNumber")result=r.params[0]==="latest"?snapshot.archiveAnchor:r.params[0]==="finalized"?approvalObservationFixture.finalityHead:blocks.get(r.params[0]);
  else if(r.method==="eth_getTransactionByHash")result=r.params[0]===consumerTransaction.hash?consumerTx:r.params[0]===(approvalObservationFixture.transaction as {hash:string}).hash?approvalObservationFixture.transaction:null;
  else if(r.method==="eth_getTransactionReceipt")result=r.params[0]===consumerReceipt.transactionHash?consumerRx:r.params[0]===(approvalObservationFixture.receipt as {transactionHash:string}).transactionHash?approvalObservationFixture.receipt:null;
  else if(r.method==="eth_getTransactionCount")result="0x55";
  else if(r.method==="eth_getBalance"||r.method==="eth_estimateGas"||r.method==="eth_maxPriorityFeePerGas")result=JSON.parse(native.find(x=>x.method===r.method)!.body).result;
  else if(r.method==="eth_call"&&String(r.params[0].to).toLowerCase()===CIRCLE_SOURCE_TOKEN.toLowerCase()){
   const selector=String(r.params[0].data).slice(0,10);result=selector==="0x70a08231"?`0x${97924n.toString(16).padStart(64,"0")}`:selector==="0xdd62ed3e"?`0x${40100n.toString(16).padStart(64,"0")}`:undefined;
  }else if(r.method==="eth_getCode"||r.method==="eth_getStorageAt"){
   const recorded=native.find(x=>x.method===r.method&&String(x.params[0]).toLowerCase()===String(r.params[0]).toLowerCase());if(recorded!==undefined)result=JSON.parse(recorded.body).result;
  }
  if(result===undefined)throw Error(`uncaptured_public_fixture ${chain} ${r.method} ${canonicalJson(r.params)}`);
  return {status:200,body:JSON.stringify({jsonrpc:"2.0",id:r.id,result})};
 }};
 return {https,rows,setPhase:(value:string)=>{phase=value;},snapshot};
}
