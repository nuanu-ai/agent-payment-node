import {performance} from "node:perf_hooks";
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { encodeFunctionData, getAddress } from "viem";
import { hashObject, sha256 } from "../../src/canonical.js";
import { directEvmListRows } from "../../src/evm-direct-networks.js";
import type { MetaMaskNativeFeeQuote } from "../../src/metamask-native-fee-evidence.js";
import type { MetaMaskNativeOwnedScope, MetaMaskNativeOwnedContext } from "../../src/metamask-native-transfer-owner.js";

const OWNER = "0xf41170df51aab52aaa04fbc3ff325cf051644aca", SELLER = "0x991e254b5c8e0aaf6c244eaa2706bad059809b04";
const PAYER = getAddress("0x4444444444444444444444444444444444444444"), RECIPIENT = getAddress("0x5555555555555555555555555555555555555555");
/** The owner's own reviewed policy (0.5.42): it still admits the seller on its chains, now by meaning rather than bytes. */
const OWNER_POLICY = "# Mimir Wallet Policy\nschema_version: 1\nwallet_address: \"0xf41170df51aab52aaa04fbc3ff325cf051644aca\"\n\naddresses:\n  allowlist:\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 1329\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 137\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 143\n    - address: \"0x991e254b5c8e0aaf6c244eaa2706bad059809b04\"\n      chain_id: 59144\n    - address: \"0x823a3a5bab1186141b32fc65f8e25ca24c679ce7\"\n      chain_id: 8453\n  blocklist: []\n\nevm:\n  allowed_chains:\n    - 1\n    - 10\n    - 56\n    - 137\n    - 143\n    - 999\n    - 1329\n    - 4326\n    - 4663\n    - 8453\n    - 42161\n    - 43114\n    - 46630\n    - 59144\n    - 84532\n    - 11155111\n  outflow_limits_usd:\n    rolling_24h: 0.5\n";
/** Another user's policy: their wallet and recipient, a protocol section and a comment the reader does not need. */
const POLICY = `# Mimir Wallet Policy\nschema_version: 1\nwallet_address: '${PAYER}'\naddresses:\n  allowlist:\n  - address: "${RECIPIENT.toLowerCase()}"  # payee\n    chain_id: 1\n  - address: "${RECIPIENT}"\n    chain_id: 10\n    label: "payee on OP"\n  blocklist: []\nprotocols:\n  allowlist:\n    - name: uniswap\nevm:\n  allowed_chains:\n    - 1\n    - 10\n  outflow_limits_usd:\n    rolling_24h: 25\n    per_transaction: 5.5\n`;
const TX = `0x${"a".repeat(64)}`;
const PROJECT = "11111111-2222-4333-8444-555555555555";
const PROJECT_HASH = sha256(PROJECT);
const RID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let queue: {exitCode:number;stdout:Buffer}[] = [], calls: {argv:readonly string[];timeout?:number}[] = [];
let readFailure:Error|undefined, readFailureAt=1;
let allowTransport = false, currentChecks = 0, rejectAfterHandoff = false;
const buffers: Buffer[] = [];
// These doubles test the transport contract only. They cannot prove an owned private issuer positive.
// Encoded here: a value import of the evidence module would load the real owner and runner before the mocks below.
const metaMaskNativeTransferData=(to:`0x${string}`,amount:string)=>encodeFunctionData({abi:[{type:"function",name:"transfer",stateMutability:"nonpayable",inputs:[{name:"to",type:"address"},{name:"amount",type:"uint256"}],outputs:[{type:"bool"}]}],functionName:"transfer",args:[to,BigInt(amount)]});
mock.module("../../src/metamask-package.js", {namedExports: {resolveMetaMaskBin: async () => "/test-only-pinned-package"}});
mock.module("../../src/metamask-process-runner.js", {namedExports: {takeMetaMaskNativeProcessFailureDiagnostic: () => undefined, takeMetaMaskNativeProcessFailureIdentifiers: () => undefined, NodeMetaMaskProcessRunner: class {
  async runJson(argv:readonly string[], timeout?:number) {
    calls.push({argv, ...(timeout === undefined ? {} : {timeout})});
    if(readFailure&&calls.length===readFailureAt){const failure=readFailure;readFailure=undefined;throw failure;}
    const value = queue.shift(); assert.ok(value, "unexpected child call"); return value;
  }
}}});
mock.module("../../src/metamask-native-transfer-owner.js", {namedExports: {
  claimMetaMaskNativeOwnedScope: () => {if (!allowTransport) throw new Error("unowned");},
  assertMetaMaskNativeOwnedScope: (_s:unknown,c:MetaMaskNativeOwnedContext) => ({utcExpiresAt:c.consentExpiresAt,monotonicDeadlineMs:performance.now()+Date.parse(c.consentExpiresAt)-Date.now()}),
  assertMetaMaskNativeOwnedContextCurrent: async (_scope:unknown,ctx:MetaMaskNativeOwnedContext) => {currentChecks++; if (rejectAfterHandoff && currentChecks === 2) throw new Error("expired");const p=await readMetaMaskNativeVendorPolicy(ctx.quote.chainId,ctx.quote.sender,RECIPIENT,ctx.consentExpiresAt);assert.equal(p.vendorProjectHash,ctx.vendorProjectHash);assert.equal(p.vendorPolicyHash,ctx.vendorPolicyHash);},
}});
const {readMetaMaskNativeVendorPolicy, submitOwnedMetaMaskNative, readMetaMaskNativeRequest} = await import("../../src/metamask-native-transfer-adapter.js");
function result(data:unknown, exitCode=0) {const stdout=Buffer.from(JSON.stringify({ok:true,data})); buffers.push(stdout); return {exitCode,stdout};}
function setup() {readFailureAt=1;readFailure=undefined;queue=[];calls=[];buffers.length=0;allowTransport=false;currentChecks=0;rejectAfterHandoff=false;}
function project(id=PROJECT) {queue.push(result({authenticated:true,summary:{mode:"session",projectId:id}}));}
function policyQueue(overrides: {payer?:string;policy?:string;mode?:string;address?:string;exit?:number;project?:string} = {}) {
  project(overrides.project);
  queue.push(result({mode:overrides.mode??"guard",address:overrides.payer??PAYER}),
    result({policy:overrides.policy??POLICY,address:overrides.address??overrides.payer??PAYER},overrides.exit??0));
}
function context(policy=POLICY):MetaMaskNativeOwnedContext {
  const now=new Date(), token=getAddress(directEvmListRows(1).find(r=>r.symbol==="USDC"&&r.kind==="token")!.identifier!);
  const body={schemaVersion:"apn.metamask-native-fee-quote.v2" as const,chainId:1 as const,sender:PAYER,token,tokenDecimals:6 as const,recipient:RECIPIENT,amountAtomic:"2500",nativeFeeCapAtomic:"13000001",
    transaction:{type:2 as const,to:token,data:metaMaskNativeTransferData(RECIPIENT,"2500"),valueAtomic:"0" as const,nonceAtomic:"7",gasLimitAtomic:"65000",maxFeePerGasAtomic:"200",maxPriorityFeePerGasAtomic:"2",authorizationList:[] as const},
    feeQuote:{chainId:1,l1DataFeeUpperWei:"0",operatorFeeUpperWei:"0",maximumExecutionFeeWei:"13000000",totalQuoteWei:"13000000",totalFeeEnforcedOnchain:false,blockNumberAtomic:"100",blockHash:`0x${"b".repeat(64)}` as `0x${string}`,rpcOrigin:"https://rpc.example",observedAt:now.toISOString()},expiresAt:new Date(now.getTime()+60000).toISOString()};
  const quote={...body,quoteHash:hashObject(body)} as MetaMaskNativeFeeQuote;
  return {profile:"qa-mm-wallet",profileHash:"1".repeat(64),accountBindingHash:"2".repeat(64),capabilityHash:"3".repeat(64),profileRevision:1,policyDigest:"4".repeat(64),policyRevision:1,activationDigest:"5".repeat(64),vendorPolicyHash:sha256(policy),vendorProjectHash:PROJECT_HASH,quote,operationId:"6".repeat(64),consentExpiresAt:new Date(now.getTime()+60000).toISOString(),issuedDay:now.toISOString().slice(0,10)};
}
const scope = {} as MetaMaskNativeOwnedScope;
const noSend = () => calls.every(c=>c.argv[1]!=="send-transaction");

test("three vendor reads confirm the session project, Guard mode and a policy that admits this payer, chain and recipient", async () => {
 setup();policyQueue();const value=await readMetaMaskNativeVendorPolicy(1,PAYER,RECIPIENT);
 assert.deepEqual(Object.keys(value).sort(),["observedAt","outflowLimitsUsd","selectedAddress","tradingMode","vendorPolicyHash","vendorProjectHash"]);
 assert.equal(value.vendorPolicyHash,sha256(POLICY));assert.equal(value.tradingMode,"guard");assert.equal(value.vendorProjectHash,PROJECT_HASH);
 assert.deepEqual(value.outflowLimitsUsd,{rolling_24h:"25",per_transaction:"5.5"});
 assert.deepEqual(calls.map(c=>c.argv.slice(0,3)),[["auth","status","--json"],["wallet","trading-mode","get"],["wallet","policy","get"]]);
 assert.ok(buffers.every(b=>b.every(byte=>byte===0)));
 setup();policyQueue();assert.equal((await readMetaMaskNativeVendorPolicy(10,PAYER,RECIPIENT)).vendorPolicyHash,sha256(POLICY));
});
test("the owner's existing policy keeps working by meaning: seller allowlisted where it is, refused where it is not", async () => {
 for (const chain of [1,143,59144,1329] as const) {setup();policyQueue({payer:OWNER,policy:OWNER_POLICY});assert.equal((await readMetaMaskNativeVendorPolicy(chain,getAddress(OWNER),getAddress(SELLER))).vendorPolicyHash,sha256(OWNER_POLICY));}
 setup();policyQueue({payer:OWNER,policy:OWNER_POLICY});await assert.rejects(readMetaMaskNativeVendorPolicy(10,getAddress(OWNER),getAddress(SELLER)),{message:/does not allowlist this recipient/});
 setup();policyQueue({payer:OWNER,policy:OWNER_POLICY});await assert.rejects(readMetaMaskNativeVendorPolicy(1,getAddress(OWNER),RECIPIENT),{message:/does not allowlist this recipient/});
});
const refusals: Record<string, {readonly change: Parameters<typeof policyQueue>[0]; readonly reason?: string}> = {
  empty:{change:{policy:""},reason:"metamask_guard_policy_unreadable"},
  otherWallet:{change:{policy:POLICY.replace(`'${PAYER}'`,`'${RECIPIENT}'`)},reason:"metamask_guard_policy_wallet_mismatch"},
  notAllowlisted:{change:{policy:POLICY.replaceAll(RECIPIENT,PAYER).replace(RECIPIENT.toLowerCase(),PAYER.toLowerCase())},reason:"metamask_guard_recipient_not_allowlisted"},
  otherChainOnly:{change:{policy:POLICY.replace("    chain_id: 1\n","    chain_id: 137\n")},reason:"metamask_guard_recipient_not_allowlisted"},
  blocklisted:{change:{policy:POLICY.replace("  blocklist: []",`  blocklist:\n    - "${RECIPIENT}"`)},reason:"metamask_guard_recipient_blocklisted"},
  chainNotAllowed:{change:{policy:POLICY.replace("    - 1\n    - 10\n","    - 10\n")},reason:"metamask_guard_chain_not_allowed"},
  noOutflowLimit:{change:{policy:POLICY.replace("  outflow_limits_usd:\n    rolling_24h: 25\n    per_transaction: 5.5\n","")},reason:"metamask_guard_outflow_limit_missing"},
  zeroOutflowLimit:{change:{policy:POLICY.replace("rolling_24h: 25","rolling_24h: 0").replace("per_transaction: 5.5","per_transaction: 0.0")},reason:"metamask_guard_outflow_limit_missing"},
  schemaTwo:{change:{policy:POLICY.replace("schema_version: 1","schema_version: 2")},reason:"metamask_guard_policy_schema_unsupported"},
  unquotedHexAddress:{change:{policy:POLICY.replace(`"${RECIPIENT.toLowerCase()}"`,RECIPIENT.toLowerCase()).replace(`"${RECIPIENT}"`,RECIPIENT)},reason:"metamask_guard_recipient_not_allowlisted"},
  anchor:{change:{policy:POLICY.replace("addresses:","addresses: &a")},reason:"metamask_guard_policy_unreadable"},
  flow:{change:{policy:POLICY.replace("  blocklist: []","  blocklist: [x]")},reason:"metamask_guard_policy_unreadable"},
  tab:{change:{policy:POLICY.replace("  blocklist","\tblocklist")},reason:"metamask_guard_policy_unreadable"},
  duplicateKey:{change:{policy:POLICY+"wallet_address: \"0x0000000000000000000000000000000000000001\"\n"},reason:"metamask_guard_policy_unreadable"},
  badIndent:{change:{policy:POLICY.replace("    chain_id: 1\n","      chain_id: 1\n")},reason:"metamask_guard_policy_unreadable"},
  beast:{change:{mode:"beast"}}, wrongPayer:{change:{address:"0x1111111111111111111111111111111111111111"}}, failedRead:{change:{exit:1}},
};
for (const [name, {change, reason}] of Object.entries(refusals)) {
 test(`policy ${name} refuses before any financial child`,async()=>{setup();policyQueue(change);
  await assert.rejects(readMetaMaskNativeVendorPolicy(1,PAYER,RECIPIENT),(error:unknown)=>reason===undefined||(error as {details?:{reason?:string}}).details?.reason===reason);assert.ok(noSend());});
}
test("byte changes that keep the meaning still admit: whitespace, comments, key order",async()=>{
 for (const policy of [POLICY+"\n\n# trailing note\n",POLICY.replace("schema_version: 1\n","")+"schema_version: 1   # version, now last\n"]) {
  setup();policyQueue({policy});assert.equal((await readMetaMaskNativeVendorPolicy(1,PAYER,RECIPIENT)).vendorPolicyHash,sha256(policy));
 }
});
test("the transport constructs only the exact type-2 ERC20 payload, names the transfer in its intent and returns an acknowledgement",async()=>{
 setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:PAYER,hash:TX}));const ctx=context();
 assert.deepEqual(await submitOwnedMetaMaskNative(scope,ctx),{disposition:"acknowledged",transactionHash:TX});
 const child=calls.find(c=>c.argv[1]==="send-transaction")!;const payload=JSON.parse(child.argv[child.argv.indexOf("--payload")+1]!);
 assert.deepEqual(payload,{to:ctx.quote.token,data:ctx.quote.transaction.data,value:"0x0",gas:"0xfde8",nonce:"0x7",maxFeePerGas:"0xc8",maxPriorityFeePerGas:"0x2"});
 assert.equal(child.argv[child.argv.indexOf("--intent")+1],`APN ${ctx.operationId}: 2500 atomic USDC to ${RECIPIENT}`);
 assert.equal(calls.length,4);assert.ok(calls.every(c=>c.timeout!==undefined&&c.timeout>0&&c.timeout<=60000));assert.ok(buffers.every(b=>b.every(byte=>byte===0)));
});
test("counterfeit transport scope refuses before child through the statically imported claim gate",async()=>{setup();await assert.rejects(submitOwnedMetaMaskNative(scope,context()));assert.equal(calls.length,0);});
test("a hand-off that returned a hash is acknowledged: no owner guard re-runs after the effect",async()=>{setup();allowTransport=true;rejectAfterHandoff=true;policyQueue();queue.push(result({mode:"server",address:PAYER,hash:TX}));const value=await submitOwnedMetaMaskNative(scope,context());assert.deepEqual(value,{disposition:"acknowledged",transactionHash:TX});assert.equal(currentChecks,1);assert.equal(calls.filter(c=>c.argv[1]==="send-transaction").length,1);});
test("nonzero provider exit preserves returned hash without claiming acknowledgement",async()=>{setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:PAYER,hash:TX},1));const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");assert.equal("transactionHash" in value&&value.transactionHash,TX);});
test("returned hash casing is canonicalized for the immutable owner journal",async()=>{setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:PAYER,hash:`0x${"A".repeat(64)}`}));assert.deepEqual(await submitOwnedMetaMaskNative(scope,context()),{disposition:"acknowledged",transactionHash:TX});});
test("nonzero provider exit preserves returned request ID as UNKNOWN",async()=>{setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:PAYER,status:"AWAITING_MFA",pollingId:RID},1));const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");assert.equal("requestId" in value&&value.requestId,RID);});
test("a hand-off that returned a pending request keeps its request ID, with no guard after the effect",async()=>{setup();allowTransport=true;rejectAfterHandoff=true;policyQueue();queue.push(result({mode:"server",address:PAYER,status:"AWAITING_MFA",pollingId:RID}));const value=await submitOwnedMetaMaskNative(scope,context());assert.notEqual(value.disposition,"acknowledged");assert.equal("requestId" in value&&value.requestId,RID);assert.equal(currentChecks,1);});
test("late ambiguous response has UNKNOWN outcome and no automatic resend",async()=>{setup();allowTransport=true;policyQueue();queue.push({exitCode:1,stdout:Buffer.from("malformed")});const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");assert.equal(calls.filter(c=>c.argv[1]==="send-transaction").length,1);});
test("a send result naming another wallet is never acknowledged",async()=>{setup();allowTransport=true;policyQueue();queue.push(result({mode:"server",address:RECIPIENT,hash:TX}));const value=await submitOwnedMetaMaskNative(scope,context());assert.equal(value.disposition,"unknown");});
test("the vendor policy changing between prepare and send refuses before the financial child",async()=>{setup();allowTransport=true;policyQueue({policy:POLICY+"# edited\n"});await assert.rejects(submitOwnedMetaMaskNative(scope,context()));assert.ok(noSend());});

// These request reads never authorize a financial effect or settlement.
test("empty project metadata refuses unsigned",async()=>{setup();policyQueue({project:""});await assert.rejects(readMetaMaskNativeVendorPolicy(1,PAYER,RECIPIENT));assert.equal(calls.length,1);});
test("owned quote's project pin mismatch refuses before SDK financial child",async()=>{setup();allowTransport=true;policyQueue({project:"different-project"});await assert.rejects(submitOwnedMetaMaskNative(scope,context()));assert.ok(noSend());});
function requestQueue(request:Record<string,unknown>,status:Record<string,unknown>,after=PROJECT,exit=0){project();queue.push(result({request,status},exit));project(after);}
function readEvidence(request:Record<string,unknown>,status:Record<string,unknown>,transaction_hash:string|null=null) {return {stage:"complete",guard_step:null,request_id:RID,watch_returned:true,before_guard_verified:true,after_guard_verified:true,request_identity_verified:true,provider_status:status.status??null,transaction_hash,chain_id:1,response_hash:sha256(JSON.stringify({ok:true,data:{request,status}})),reason:null,error_code:null,diagnostic:null};}
const request=()=>({pollingId:RID,kind:"transaction",namespace:"evm",chainId:1});
test("a request READ is three processes: project, watch, project; it returns matching hash and chain hints",async()=>{setup();requestQueue({...request(),txHash:TX},{txHash:TX,status:"CONFIRMED"});const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.deepEqual(v,{disposition:"acknowledged",requestId:RID,transactionHash:TX,chainId:1,readObservation:readEvidence({...request(),txHash:TX},{txHash:TX,status:"CONFIRMED"},TX)});assert.deepEqual(calls.map(c=>c.argv[1]),["status","requests","status"]);const watch=calls[1]!;assert.deepEqual(watch.argv,["wallet","requests","watch",RID,"--wallet-timeout","1","--json"]);assert.equal(watch.timeout,6000);assert.ok(noSend());});
test("normal pending request stays pending and cannot prove fee or finality",async()=>{setup();requestQueue(request(),{status:"AWAITING_MFA"});assert.deepEqual(await readMetaMaskNativeRequest(RID,PROJECT_HASH),{disposition:"pending",requestId:RID,chainId:1,readObservation:readEvidence(request(),{status:"AWAITING_MFA"})});});
for(const [name,changed] of Object.entries({wrongRID:{...request(),pollingId:"different"},wrongNamespace:{...request(),namespace:"solana"},wrongKind:{...request(),kind:"message"},otherChain:{...request(),chainId:8453}}))test(`request ${name} is UNKNOWN`,async()=>{setup();requestQueue(changed,{txHash:TX});assert.equal((await readMetaMaskNativeRequest(RID,PROJECT_HASH)).disposition,"unknown");assert.ok(noSend());});
test("request hash conflict is UNKNOWN",async()=>{setup();requestQueue({...request(),txHash:TX},{txHash:`0x${"c".repeat(64)}`});assert.equal((await readMetaMaskNativeRequest(RID,PROJECT_HASH)).disposition,"unknown");});
test("post-read project drift preserves actual watch hash as UNKNOWN",async()=>{setup();requestQueue(request(),{txHash:TX,status:"CONFIRMED"},"different-project");const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal(v.transactionHash,TX);assert.equal(v.readObservation?.stage,"after_guard");assert.equal(v.readObservation?.guard_step,"project_after");assert.equal(v.readObservation?.before_guard_verified,true);assert.equal(v.readObservation?.after_guard_verified,false);});
test("pre-read project drift reads no request",async()=>{setup();project("different-project");const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal(v.readObservation?.guard_step,"project_before");assert.equal(v.readObservation?.watch_returned,false);assert.equal(calls.length,1);});
test("service denial never proves no effect or releases a hold",async()=>{setup();requestQueue(request(),{status:"DENIED"});const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.ok(!("actualNativeFee" in v));});
test("request invalid input refuses before any normal child",async()=>{setup();assert.equal((await readMetaMaskNativeRequest("",PROJECT_HASH)).disposition,"unknown");assert.equal(calls.length,0);});
test("malformed present request hash cannot fall back to another valid hash",async()=>{setup();requestQueue({...request(),txHash:"malformed"},{txHash:TX});assert.equal((await readMetaMaskNativeRequest(RID,PROJECT_HASH)).disposition,"unknown");});
test("EXPIRED read is a fresh validated provider projection but not no-effect proof",async()=>{setup();requestQueue(request(),{status:"EXPIRED"});const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal(v.readObservation?.provider_status,"EXPIRED");assert.equal(v.readObservation?.request_identity_verified,true);assert.equal(v.readObservation?.after_guard_verified,true);assert.equal(v.readObservation?.transaction_hash,null);assert.ok(!("actualNativeFee" in v));assert.ok(buffers.every(b=>b.every(byte=>byte===0)));});
test("unrecognized provider strings and failure descriptions cannot expose credentials or URLs",async()=>{setup();const secret="Bearer PRIVATE https://rpc.invalid/?key=PRIVATE Authorization: PRIVATE";requestQueue(request(),{status:secret,failureDescription:secret,error:{message:secret}});const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal(v.readObservation?.provider_status,"unrecognized");assert.ok(!JSON.stringify(v).includes("PRIVATE"));assert.ok(!JSON.stringify(v).includes("rpc.invalid"));assert.ok(Object.isFrozen(v.readObservation));});
test("nonzero watch retains validated hash and status without successful outcome",async()=>{setup();requestQueue(request(),{txHash:TX,status:"FAILED"},PROJECT,1);const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal(v.transactionHash,TX);assert.equal(v.readObservation?.provider_status,"FAILED");assert.equal(v.readObservation?.watch_returned,true);assert.equal(v.readObservation?.after_guard_verified,true);});
test("wrong request identity hides provider status and hash",async()=>{setup();requestQueue({...request(),pollingId:"wrong"},{txHash:TX,status:"CONFIRMED"});const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal(v.readObservation?.request_identity_verified,false);assert.equal(v.readObservation?.provider_status,null);assert.equal(v.readObservation?.transaction_hash,null);});
test("thrown process errors retain only a fixed error category, never raw messages or details",async()=>{setup();readFailure=new Error("Authorization: SECRET https://rpc.invalid/?key=SECRET raw failureDescription");const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal(v.readObservation?.stage,"before_guard");assert.equal(v.readObservation?.guard_step,"project_before");assert.equal(v.readObservation?.error_code,"unavailable");assert.equal(v.readObservation?.watch_returned,false);assert.equal(calls.length,1);assert.ok(!JSON.stringify(v).includes("SECRET"));assert.ok(!JSON.stringify(v).includes("rpc.invalid"));});
test("watch process failure is distinguishable from pre-provider refusal without exposing its message",async()=>{setup();project();readFailureAt=2;readFailure=new Error("token=PRIVATE raw provider failure");const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"unknown");assert.equal(v.readObservation?.stage,"watch");assert.equal(v.readObservation?.guard_step,null);assert.equal(v.readObservation?.before_guard_verified,true);assert.equal(v.readObservation?.watch_returned,false);assert.equal(v.readObservation?.error_code,"unavailable");assert.equal(calls.length,2);assert.ok(!JSON.stringify(v).includes("PRIVATE"));assert.ok(noSend());});
test("invalid diagnostic cannot alter a valid request hint or expose arbitrary provider fields",async()=>{setup();requestQueue(request(),{txHash:TX,status:"CONFIRMED"});Object.assign(queue[1]!,{nativeDiagnostic:{stage:"SECRET",providerCode:"token=SECRET",message:"https://rpc.invalid/?key=SECRET"}});const v=await readMetaMaskNativeRequest(RID,PROJECT_HASH);assert.equal(v.disposition,"acknowledged");assert.equal(v.transactionHash,TX);assert.equal(v.readObservation?.diagnostic,null);assert.ok(!JSON.stringify(v).includes("SECRET"));});
