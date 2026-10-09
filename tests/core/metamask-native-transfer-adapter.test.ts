import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { encodeFunctionData, getAddress } from "viem";
import { hashObject, sha256 } from "../../src/canonical.js";
import { directEvmListRows } from "../../src/evm-direct-networks.js";
import type { MetaMaskNativeFeeQuote } from "../../src/metamask-native-fee-evidence.js";
import type { MetaMaskNativeOwnedScope, MetaMaskNativeOwnedContext } from "../../src/metamask-native-transfer-owner.js";

const PAYER = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const HASH = "e3e44343da17c1912c2da0ce5b58f9c804b53d3715b8a2756c0b035fd50d288a";
const POLICY = "# Mimir Wallet Policy\nschema_version: 1\nwallet_address: \"0xf41170df51aab52aaa04fbc3ff325cf051644aca\"\n\naddresses:\n  allowlist:\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1329\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 137\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 143\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 59144\n    - address: \"0x823a3a5bab1186141b32fc65f8e25ca24c679ce7\"\n      chain_id: 8453\n  blocklist: []\n\nevm:\n  allowed_chains:\n    - 1\n    - 10\n    - 56\n    - 137\n    - 143\n    - 999\n    - 1329\n    - 4326\n    - 4663\n    - 8453\n    - 42161\n    - 43114\n    - 46630\n    - 59144\n    - 84532\n    - 11155111\n  outflow_limits_usd:\n    rolling_24h: 0.5\n";
const TX = `0x${"a".repeat(64)}`;
const PROJECT = "11111111-2222-4333-8444-555555555555";
const PROJECT_HASH = sha256(PROJECT);
let postProject: string | undefined;
const RID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let queue: {exitCode:number;stdout:Buffer}[] = [], calls: {argv:readonly string[];timeout?:number}[] = [];
let allowTransport = false, currentChecks = 0, rejectAfterHandoff = false;
const buffers: Buffer[] = [];
// These doubles test the transport contract only. They cannot prove an owned private issuer positive.
mock.module("../../src/metamask-package.js", {namedExports: {resolveMetaMaskBin: async () => "/test-only-pinned-package"}});
mock.module("../../src/metamask-process-runner.js", {namedExports: {takeMetaMaskNativeProcessFailureIdentifiers: () => undefined, NodeMetaMaskProcessRunner: class {
  async runJson(argv:readonly string[], timeout?:number) {
    calls.push({argv, ...(timeout === undefined ? {} : {timeout})});
    const value = queue.shift(); assert.ok(value, "unexpected child call"); if (argv[1] === "send-transaction") policyQueue({project:postProject??PROJECT}); return value;
  }
}}});
mock.module("../../src/metamask-native-transfer-owner.js", {namedExports: {
  claimMetaMaskNativeOwnedScope: () => {if (!allowTransport) throw new Error("unowned");},
  assertMetaMaskNativeOwnedScope: () => {},
  assertMetaMaskNativeOwnedContextCurrent: async () => {currentChecks++; if (rejectAfterHandoff && currentChecks === 3) throw new Error("expired");},
  readMetaMaskNativeSettlement: async () => {throw new Error("not a settlement fixture");},
  readMetaMaskNativeReservation: async () => {throw new Error("not a ledger fixture");},
  assertMetaMaskNativeFailedBeforeEffect: async () => {throw new Error("not a release fixture");},
  assertMetaMaskNativeGenericCapacityRelease: async () => {throw new Error("not a release fixture");},
  assertMetaMaskNativeConflictDomainAvailable: async () => {throw new Error("not a conflict-domain fixture");},
  assertMetaMaskNativeOwnedConflictDomainAvailable: async () => {throw new Error("not a conflict-domain fixture");},
}});
const {readFixedMetaMaskNativePolicy, submitOwnedMetaMaskNative, readFixedMetaMaskNativeRequest} = await import("../../src/metamask-native-transfer-adapter.js");
function result(data:unknown, exitCode=0) {const stdout=Buffer.from(JSON.stringify({ok:true,data})); buffers.push(stdout); return {exitCode,stdout};}
function setup() {queue=[];calls=[];buffers.length=0;allowTransport=false;currentChecks=0;rejectAfterHandoff=false;postProject=undefined;}
function policyQueue(overrides: {policy?:string;mode?:string;address?:string;lastAddress?:string;exit?:number;project?:string;lastProject?:string} = {}) {
  queue.push(result({authenticated:true,summary:{mode:"session",projectId:overrides.project??PROJECT}}),result({mode:"server",chainNamespace:"evm",address:PAYER}),
    result({mode:overrides.mode??"guard",address:PAYER}),
    result({policy:overrides.policy??POLICY,address:overrides.address??PAYER},overrides.exit??0),
    result({mode:"server",chainNamespace:"evm",address:overrides.lastAddress??PAYER}),result({authenticated:true,summary:{mode:"session",projectId:overrides.lastProject??overrides.project??PROJECT}}));
}
function context():MetaMaskNativeOwnedContext {
  const now=new Date(), token=getAddress(directEvmListRows(1).find(r=>r.symbol==="USDC"&&r.kind==="token")!.identifier!);
  const body={schemaVersion:"apn.metamask-native-fee-quote.v1" as const,chainId:1 as const,sender:getAddress(PAYER),token,tokenDecimals:6 as const,
    seller:"0x991e254b5c8e0aaf6c244eaa2706bad059809b04",grossAtomic:"1000" as const,netAtomic:"1000" as const,tokenFeeAtomic:"0" as const,nativeFeeCapAtomic:"13000001",
    transaction:{type:2 as const,to:token,data:encodeFunctionData({abi:[{type:"function",name:"transfer",stateMutability:"nonpayable",inputs:[{name:"to",type:"address"},{name:"amount",type:"uint256"}],outputs:[{type:"bool"}]}],functionName:"transfer",args:[getAddress("0x991e254b5c8e0aaf6c244eaa2706bad059809b04"),1000n]}),valueAtomic:"0" as const,nonceAtomic:"7",gasLimitAtomic:"65000",maxFeePerGasAtomic:"200",maxPriorityFeePerGasAtomic:"2",authorizationList:[] as const},
    feeQuote:{chainId:1,l1DataFeeUpperWei:"0",operatorFeeUpperWei:"0",maximumExecutionFeeWei:"13000000",totalQuoteWei:"13000000",totalFeeEnforcedOnchain:false,blockNumberAtomic:"100",blockHash:`0x${"b".repeat(64)}` as `0x${string}`,rpcOrigin:"https://rpc.example",observedAt:now.toISOString()},expiresAt:new Date(now.getTime()+60000).toISOString()};
  const quote={...body,quoteHash:hashObject(body)} as MetaMaskNativeFeeQuote;
  return {stateRoot:"/not-a-production-root",profile:"metamask-live-v042",profileHash:"1".repeat(64),accountBindingHash:"2".repeat(64),capabilityHash:"3".repeat(64),profileRevision:1,policyDigest:"4".repeat(64),policyRevision:1,activationDigest:"5".repeat(64),vendorPolicyHash:HASH,vendorProjectHash:PROJECT_HASH,quote,operationId:"6".repeat(64),consentExpiresAt:new Date(now.getTime()+60000).toISOString(),issuedDay:now.toISOString().slice(0,10)};
}
const scope = {} as MetaMaskNativeOwnedScope;

test("fixed normal policy reads corroborate selected address, Guard and exact approved bytes without a financial child", async () => {
 setup();policyQueue();const value=await readFixedMetaMaskNativePolicy(1);
 assert.deepEqual(Object.keys(value).sort(),["observedAt","policyBytes","selectedAddress","tradingMode","vendorPolicyHash","vendorProjectHash"]);
 assert.equal(value.vendorPolicyHash,HASH);assert.equal(value.tradingMode,"guard");assert.equal(value.policyBytes,866);
 assert.deepEqual(calls.map(c=>c.argv.slice(0,3)),[["auth","status","--json"],["wallet","address","--chain-namespace"],["wallet","trading-mode","get"],["wallet","policy","get"],["wallet","address","--chain-namespace"],["auth","status","--json"]]);
 assert.ok(buffers.every(b=>b.every(byte=>byte===0)));
});
test("OP Seller absence refuses before any normal child", async()=>{setup();await assert.rejects(readFixedMetaMaskNativePolicy(10));assert.equal(calls.length,0);});
for (const [name, change] of Object.entries({empty:{policy:""},drift:{policy:POLICY+"\n"},beast:{mode:"beast"},wrongPayer:{address:"0x1111111111111111111111111111111111111111"},selectedDrift:{lastAddress:"0x1111111111111111111111111111111111111111"},failedRead:{exit:1}})) {
 test(`policy ${name} refuses unsigned`,async()=>{setup();policyQueue(change);await assert.rejects(readFixedMetaMaskNativePolicy(1));assert.ok(calls.every(c=>c.argv[1]!=="send-transaction"));});
}
test("test-owned transport constructs only exact finite type2 ERC20 payload and returns an acknowledgement hint",async()=>{
 setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:PAYER,hash:TX}));const ctx=context();
 assert.deepEqual(await submitOwnedMetaMaskNative(scope,ctx),{disposition:"acknowledged",transactionHash:TX});
 const child=calls.find(c=>c.argv[1]==="send-transaction")!;assert.equal(child.argv[1],"send-transaction");const payload=JSON.parse(child.argv[child.argv.indexOf("--payload")+1]!);
 assert.deepEqual(payload,{to:ctx.quote.token,data:ctx.quote.transaction.data,value:"0x0",gas:"0xfde8",nonce:"0x7",maxFeePerGas:"0xc8",maxPriorityFeePerGas:"0x2"});
 assert.ok(calls.every(c=>c.timeout!==undefined&&c.timeout>0&&c.timeout<=60000));assert.ok(buffers.every(b=>b.every(byte=>byte===0)));
});
test("counterfeit transport scope refuses before child through the statically imported claim gate",async()=>{setup();await assert.rejects(submitOwnedMetaMaskNative(scope,context()));assert.equal(calls.length,0);});
test("post-handoff guard failure preserves the actual transaction hash as UNKNOWN",async()=>{setup();allowTransport=true;rejectAfterHandoff=true;policyQueue();queue.push(result({mode:"server",address:PAYER,hash:TX}));const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");assert.equal("transactionHash" in value&&value.transactionHash,TX);assert.equal(calls.filter(c=>c.argv[1]==="send-transaction").length,1);});
test("nonzero provider exit preserves returned hash without claiming acknowledgement",async()=>{setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:PAYER,hash:TX},1));const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");assert.equal("transactionHash" in value&&value.transactionHash,TX);});
test("returned hash casing is canonicalized for the immutable owner journal",async()=>{setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:PAYER,hash:`0x${"A".repeat(64)}`}));assert.deepEqual(await submitOwnedMetaMaskNative(scope,context()),{disposition:"acknowledged",transactionHash:TX});});
test("nonzero provider exit preserves returned request ID as UNKNOWN",async()=>{setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:PAYER,status:"AWAITING_MFA",pollingId:RID},1));const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");assert.equal("requestId" in value&&value.requestId,RID);});
test("post-handoff guard failure preserves the actual pending request ID as UNKNOWN",async()=>{setup();allowTransport=true;rejectAfterHandoff=true;policyQueue();queue.push(result({mode:"server",address:PAYER,status:"AWAITING_MFA",pollingId:RID}));const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");assert.equal("requestId" in value&&value.requestId,RID);});
test("late ambiguous response has UNKNOWN outcome and no automatic resend",async()=>{setup();allowTransport=true;policyQueue();queue.push({exitCode:1,stdout:Buffer.from("malformed")});const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");assert.equal(calls.filter(c=>c.argv[1]==="send-transaction").length,1);});

// These request reads never authorize a financial effect or settlement.
test("policy project drift refuses without exposing project ID",async()=>{setup();policyQueue({lastProject:"different-project"});await assert.rejects(readFixedMetaMaskNativePolicy(1));assert.ok(calls.every(c=>c.argv[1]!=="send-transaction"));});
test("empty project metadata refuses unsigned",async()=>{setup();policyQueue({project:""});await assert.rejects(readFixedMetaMaskNativePolicy(1));assert.equal(calls.length,1);});
test("owned quote's project pin mismatch refuses before SDK financial child",async()=>{setup();allowTransport=true;policyQueue({project:"different-project"});await assert.rejects(submitOwnedMetaMaskNative(scope,context()));assert.ok(calls.every(c=>c.argv[1]!=="send-transaction"));});
test("post-private project drift preserves returned hash as UNKNOWN",async()=>{setup();allowTransport=true;postProject="different-project";policyQueue();queue.push(result({mode:"server",address:PAYER,hash:TX}));const v=await submitOwnedMetaMaskNative(scope,context());assert.equal(v.disposition,"unknown");assert.equal("transactionHash" in v&&v.transactionHash,TX);});
function requestQueue(request:Record<string,unknown>,status:Record<string,unknown>,after=PROJECT,exit=0){policyQueue();queue.push(result({request,status},exit));policyQueue({project:after});}
const request=()=>({pollingId:RID,kind:"transaction",namespace:"evm",chainId:1});
test("normal request READ returns matching hash and chain hints without financial replay",async()=>{setup();requestQueue({...request(),txHash:TX},{txHash:TX,status:"CONFIRMED"});const v=await readFixedMetaMaskNativeRequest(RID,PROJECT_HASH);assert.deepEqual(v,{disposition:"acknowledged",requestId:RID,transactionHash:TX,chainId:1});const watch=calls.find(c=>c.argv[2]==="watch")!;assert.deepEqual(watch.argv,["wallet","requests","watch",RID,"--wallet-timeout","1","--json"]);assert.equal(watch.timeout,6000);assert.ok(calls.every(c=>c.argv[1]!=="send-transaction"));});
test("normal pending request stays pending and cannot prove fee or finality",async()=>{setup();requestQueue(request(),{status:"AWAITING_MFA"});assert.deepEqual(await readFixedMetaMaskNativeRequest(RID,PROJECT_HASH),{disposition:"pending",requestId:RID,chainId:1});});
for(const [name,changed] of Object.entries({wrongRID:{...request(),pollingId:"different"},wrongNamespace:{...request(),namespace:"solana"},wrongKind:{...request(),kind:"message"}}))test(`request ${name} is UNKNOWN`,async()=>{setup();requestQueue(changed,{txHash:TX});assert.equal((await readFixedMetaMaskNativeRequest(RID,PROJECT_HASH)).disposition,"unknown");assert.ok(calls.every(c=>c.argv[1]!=="send-transaction"));});
test("request hash conflict is UNKNOWN",async()=>{setup();requestQueue({...request(),txHash:TX},{txHash:`0x${"c".repeat(64)}`});assert.equal((await readFixedMetaMaskNativeRequest(RID,PROJECT_HASH)).disposition,"unknown");});
test("post-read project drift preserves actual watch hash as UNKNOWN",async()=>{setup();requestQueue(request(),{txHash:TX},"different-project");const v=await readFixedMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal("transactionHash" in v&&v.transactionHash,TX);});
test("service denial never proves no effect or releases a hold",async()=>{setup();requestQueue(request(),{status:"DENIED"});const v=await readFixedMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.ok(!("actualNativeFee" in v));});
test("request invalid input refuses before any normal child",async()=>{setup();assert.equal((await readFixedMetaMaskNativeRequest("",PROJECT_HASH)).disposition,"unknown");assert.equal(calls.length,0);});

test("malformed present request hash cannot fall back to another valid hash",async()=>{setup();requestQueue({...request(),txHash:"malformed"},{txHash:TX});assert.equal((await readFixedMetaMaskNativeRequest(RID,PROJECT_HASH)).disposition,"unknown");});
