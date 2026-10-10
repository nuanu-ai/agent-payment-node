import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test,{mock} from "node:test";
import {encodeFunctionData,getAddress} from "viem";
import {hashObject,sha256} from "../../src/canonical.js";
import {directEvmListRows} from "../../src/evm-direct-networks.js";
import type {MetaMaskNativeFeeQuote} from "../../src/metamask-native-fee-evidence.js";
import type {MetaMaskNativeOwnedContext,MetaMaskNativeOwnedScope} from "../../src/metamask-native-transfer-owner.js";
import {NodeMetaMaskProcessRunner as RealRunner,takeMetaMaskNativeProcessFailureIdentifiers,takeMetaMaskNativeProcessFailureDiagnostic} from "../../src/metamask-process-runner.js";
const PAYER="0xf41170df51aab52aaa04fbc3ff325cf051644aca",HASH="e3e44343da17c1912c2da0ce5b58f9c804b53d3715b8a2756c0b035fd50d288a",PROJECT="11111111-2222-4333-8444-555555555555",PROJECT_HASH=sha256(PROJECT),RID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",TX=`0x${"a".repeat(64)}`;
let script="";
// Real runJson accumulation/spawn/timeout, with only package resolution pointed to an owned local fake child.
// Owner assertions are transport doubles, not a private issuer positive.
mock.module("../../src/metamask-process-runner.js",{namedExports:{NodeMetaMaskProcessRunner:class extends RealRunner{constructor(){super(async()=>script);}},takeMetaMaskNativeProcessFailureIdentifiers,takeMetaMaskNativeProcessFailureDiagnostic}});
mock.module("../../src/metamask-package.js",{namedExports:{resolveMetaMaskBin:async()=>script}});
mock.module("../../src/metamask-native-transfer-owner.js",{namedExports:{claimMetaMaskNativeOwnedScope:()=>{},assertMetaMaskNativeOwnedScope:()=>{},assertMetaMaskNativeOwnedContextCurrent:async()=>{},readMetaMaskNativeSettlement:async()=>{throw new Error("unused");},readMetaMaskNativeReservation:async()=>{throw new Error("unused");},assertMetaMaskNativeFailedBeforeEffect:async()=>{throw new Error("unused");},assertMetaMaskNativeGenericCapacityRelease:async()=>{throw new Error("unused");},assertMetaMaskNativeConflictDomainAvailable:async()=>{throw new Error("unused");},assertMetaMaskNativeOwnedConflictDomainAvailable:async()=>{throw new Error("unused");}}});
const {submitOwnedMetaMaskNative}=await import("../../src/metamask-native-transfer-adapter.js");
const POLICY = "# Mimir Wallet Policy\nschema_version: 1\nwallet_address: \"0xf41170df51aab52aaa04fbc3ff325cf051644aca\"\n\naddresses:\n  allowlist:\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1329\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 137\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 143\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 59144\n    - address: \"0x823a3a5bab1186141b32fc65f8e25ca24c679ce7\"\n      chain_id: 8453\n  blocklist: []\n\nevm:\n  allowed_chains:\n    - 1\n    - 10\n    - 56\n    - 137\n    - 143\n    - 999\n    - 1329\n    - 4326\n    - 4663\n    - 8453\n    - 42161\n    - 43114\n    - 46630\n    - 59144\n    - 84532\n    - 11155111\n  outflow_limits_usd:\n    rolling_24h: 0.5\n";
function context():MetaMaskNativeOwnedContext {
  const now=new Date(), token=getAddress(directEvmListRows(1).find(r=>r.symbol==="USDC"&&r.kind==="token")!.identifier!);
  const body={schemaVersion:"apn.metamask-native-fee-quote.v1" as const,chainId:1 as const,sender:getAddress(PAYER),token,tokenDecimals:6 as const,
    seller:"0x991e254b5c8e0aaf6c244eaa2706bad059809b04",grossAtomic:"1000" as const,netAtomic:"1000" as const,tokenFeeAtomic:"0" as const,nativeFeeCapAtomic:"13000001",
    transaction:{type:2 as const,to:token,data:encodeFunctionData({abi:[{type:"function",name:"transfer",stateMutability:"nonpayable",inputs:[{name:"to",type:"address"},{name:"amount",type:"uint256"}],outputs:[{type:"bool"}]}],functionName:"transfer",args:[getAddress("0x991e254b5c8e0aaf6c244eaa2706bad059809b04"),1000n]}),valueAtomic:"0" as const,nonceAtomic:"7",gasLimitAtomic:"65000",maxFeePerGasAtomic:"200",maxPriorityFeePerGasAtomic:"2",authorizationList:[] as const},
    feeQuote:{chainId:1,l1DataFeeUpperWei:"0",operatorFeeUpperWei:"0",maximumExecutionFeeWei:"13000000",totalQuoteWei:"13000000",totalFeeEnforcedOnchain:false,blockNumberAtomic:"100",blockHash:`0x${"b".repeat(64)}` as `0x${string}`,rpcOrigin:"https://rpc.example",observedAt:now.toISOString()},expiresAt:new Date(now.getTime()+60000).toISOString()};
  const quote={...body,quoteHash:hashObject(body)} as MetaMaskNativeFeeQuote;
  return {stateRoot:"/not-a-production-root",profile:"metamask-live-v042",profileHash:"1".repeat(64),accountBindingHash:"2".repeat(64),capabilityHash:"3".repeat(64),profileRevision:1,policyDigest:"4".repeat(64),policyRevision:1,activationDigest:"5".repeat(64),vendorPolicyHash:HASH,vendorProjectHash:PROJECT_HASH,quote,operationId:"6".repeat(64),consentExpiresAt:new Date(now.getTime()+60000).toISOString(),issuedDay:now.toISOString().slice(0,10)};
}
async function childTest(output:unknown,hang:boolean, expected:{requestId?:string;transactionHash?:string}) {
 const dir=await mkdtemp(join(tmpdir(),"apn-mm-failure-child-"));script=join(dir,"child.cjs");
 try{
 const body=`const args=process.argv.slice(2);const payer=${JSON.stringify(PAYER)},project=${JSON.stringify(PROJECT)},policy=${JSON.stringify(POLICY)};let data;if(args[0]==='auth')data={authenticated:true,summary:{mode:'session',projectId:project}};else if(args[1]==='address')data={mode:'server',address:payer,chainNamespace:'evm'};else if(args[1]==='trading-mode')data={mode:'guard',address:payer};else if(args[1]==='policy')data={address:payer,policy};else if(args[1]==='send-transaction'){process.stdout.write(${JSON.stringify(JSON.stringify(output))});${hang?"setInterval(()=>{},1000);":"process.exitCode=1;"}}else throw new Error('unexpected readonly command');if(data)process.stdout.write(JSON.stringify({ok:true,data}));`;
 await writeFile(script,body,{mode:0o600});const ctx=context();const value=await submitOwnedMetaMaskNative({} as MetaMaskNativeOwnedScope,{...ctx,consentExpiresAt:new Date(Date.now()+1500).toISOString()});
 assert.equal(value.disposition,"unknown");assert.equal(value.requestId,expected.requestId);assert.equal(value.transactionHash,expected.transactionHash);assert.ok(!("actualNativeFee" in value));
 }finally{await rm(dir,{recursive:true,force:true});}
}
test("real child RID notice then hang remains UNKNOWN with observable actual RID",async()=>childTest({_notice:{kind:"AWAITING_MFA",pollingId:RID}},true,{requestId:RID}));
test("real child hash then hang remains UNKNOWN with actual returned hash",async()=>childTest({ok:true,data:{mode:"server",address:PAYER,hash:TX,chainId:1,projectId:PROJECT}},true,{transactionHash:TX}));
test("real child notice then nonzero exit remains UNKNOWN with actual RID",async()=>childTest({_notice:{kind:"AWAITING_MFA",pollingId:RID}},false,{requestId:RID}));
test("real child conflicting chain metadata cannot supply a trusted timeout hash",async()=>childTest({ok:true,data:{mode:"server",address:PAYER,hash:TX,chainId:143}},true,{}));
