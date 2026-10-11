/** Synthetic CPU-only public observations and owner policies; no current-chain or financial proof. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, encodeFunctionResult, getAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, canonicalJson } from "../../src/canonical.js";
import { StateStore } from "../../src/state.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { OperationService } from "../../src/operation-service.js";
import { CircleUsage, circleMechanism } from "../../src/circle-v2-evm/usage.js";
import { CircleRepository, validateCircleFundingAdvance } from "../../src/circle-v2-evm/repository.js";
import { circleFundingBinding, quoteCircleFundingFee } from "../../src/circle-v2-evm/funding-binding.js";
import { circleFundingFingerprint, sealCircleFundingOperation, advanceCircleFundingOperation, validateCircleFundingOperation, validateKnownCircle, type CircleFundingOperationV2 } from "../../src/circle-v2-evm/funding-operation.js";
import { advanceCircle, circleEnvelope, validateCircle } from "../../src/circle-v2-evm/operation-model.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { bindCircleAttestation, circleWord, decodeCircleMessage, decodeCircleSource, decodeCircleDestination, encodeCircleApproval, encodeCircleBurn, encodeCircleMint, verifyCircleApproval, CIRCLE_ZERO } from "../../src/circle-v2-evm/protocol.js";
import { verifyCircleMintPreflight, verifyCircleClosureFinality } from "../../src/circle-v2-evm/preflight.js";
import { initial, at } from "./circle-v2-evm-nonce-runtime-fixtures.js";
import { event, observation, message, snapshot } from "./circle-v2-evm-runtime-fixtures.js";
const recipient = getAddress(`0x${"55".repeat(20)}`), feeRecipient = getAddress(`0x${"44".repeat(20)}`);
const params = { recipient, amountAtomic: "1000000", maxFeeAtomic: "1000", minMintAtomic: "999000" };
function funding(root: string, chain: 143 | 1329 | 59144, profile = circleRoute(chain).gasPayerProfile): CircleFundingOperationV2 {
  const legacy = initial(root, chain, profile), b = circleFundingBinding(chain, profile, params), feeQuote = quoteCircleFundingFee(b, [{ finalityThreshold: 1000, minimumFee: 1 }], at, at);
  const { schemaVersion: _v, integrityHash: _h, transitions: _t, externalFulfillment: _e, nonceRetirement: _n, ...rest } = legacy;
  const effects = rest.effects.map(e => { const { envelopeHash: _oldHash, ...envelope } = e.envelope;
    return { ...e, envelope: circleEnvelope({ ...envelope, data: e.role === "burn" ? encodeCircleBurn(chain, b) : encodeCircleApproval(false, b) }) }; });
  let op = sealCircleFundingOperation({ ...rest, schemaVersion: "apn.circle-v2-evm-operation.v2", funding: b, feeQuote, feeQuoteAtomic: feeQuote.quotedFeeAtomic,
    state: "awaiting_source", policies: rest.policies.map(p => ({ ...p, activationDigest: "a".repeat(64) })), expiresAt: new Date(at + 900000).toISOString(), effects, transitions: [] });
  op = sealCircleFundingOperation({ ...op, fingerprint: circleFundingFingerprint(op) });
  return advanceCircleFundingOperation(op, {}, "prepared", at);
}
function fundingMessage(op: CircleFundingOperationV2, attested = false, fee = 100n): Hex {
  let bytes = message(op.destinationChain, attested, fee);
  const put = (offset: number, word: string) => { bytes = `${bytes.slice(0, 2 + offset * 2)}${word}${bytes.slice(2 + (offset + 32) * 2)}` as Hex; };
  put(184, circleWord(op.funding.recipient).slice(2)); put(216, BigInt(op.funding.amountAtomic).toString(16).padStart(64, "0")); put(280, BigInt(op.funding.maxFeeAtomic).toString(16).padStart(64, "0")); return bytes;
}
function source(op: CircleFundingOperationV2) {
  const b = op.funding;
  return observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER, encodeCircleBurn(op.destinationChain, b), [
    event("MessageSent", CIRCLE_TRANSMITTER, { message: fundingMessage(op) }, 0),
    event("DepositForBurn", CIRCLE_MESSENGER, { burnToken: CIRCLE_SOURCE_TOKEN, amount: BigInt(b.amountAtomic), depositor: CIRCLE_SOURCE_OWNER,
      mintRecipient: circleWord(b.recipient), destinationDomain: b.destinationDomain, destinationTokenMessenger: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, maxFee: BigInt(b.maxFeeAtomic), minFinalityThreshold: 1000, hookData: "0x" }, 1) ]);
}
async function issuer(op: CircleFundingOperationV2, proof: ReturnType<typeof decodeCircleSource>, fee = 100n) {
  const bytes = fundingMessage(op, true, fee), m = decodeCircleMessage(bytes, op.destinationChain, true, op.funding);
  const signers = [1n, 2n].map(n => privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`)).sort((a,b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1);
  const sigs = await Promise.all(signers.map(s => s.sign({ hash: keccak256(bytes) })));
  return { sourceTxHash: proof.transactionHash, messages: [{ cctpVersion: 2, status: "complete", eventNonce: m.nonce, message: bytes, attestation: `0x${sigs.map(s => s.slice(2)).join("")}`,
    decodedMessage: { sourceDomain: "3", destinationDomain: String(op.funding.destinationDomain), nonce: m.nonce, sender: circleWord(CIRCLE_MESSENGER), recipient: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO,
      messageBody: m.body, minFinalityThreshold: "1000", finalityThresholdExecuted: "1000", decodedMessageBody: { burnToken: circleWord(CIRCLE_SOURCE_TOKEN), mintRecipient: circleWord(recipient), amount: params.amountAtomic,
        messageSender: circleWord(CIRCLE_SOURCE_OWNER), maxFee: params.maxFeeAtomic, feeExecuted: m.feeExecutedAtomic, expirationBlock: m.expirationBlock, hookData: "0x" } } }] };
}

import { seal as sealUsage, reservationIdFor, idempotency } from "../../src/asset-usage-ledger-record.js";
import { approveCircleFundingSource, approveCircleFundingMint, executeCircleFundingEffect, observeCircleFunding, cleanupCircleFunding, assertCircleFundingEffectGuard, type CircleFundingLifecyclePorts } from "../../src/circle-v2-evm/funding-lifecycle.js";
import { type CircleEffect, type CircleRole } from "../../src/circle-v2-evm/operation-model.js";
import { type CircleFundingMaterial } from "../../src/circle-v2-evm/funding-custody.js";
const tx = `0x${"11".repeat(32)}` as Hex;
function holds(op: CircleFundingOperationV2, target: "reserved" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" = "reserved") {
  return ["usdc", "approval", "burn", "cleanup", "mint"].map((key,i) => {
    const identity = { account:i===4?op.funding.gasPayer:CIRCLE_SOURCE_OWNER, chain:i===4?`eip155:${op.destinationChain}`:"eip155:42161",asset:i===0?{kind:"token" as const,identifier:CIRCLE_SOURCE_TOKEN}:{kind:"native" as const,identifier:null}}, ih=idempotency(`${op.operationId}:${key}`);
    const actual=target==="finalized"&&i===3?"failed_confirmed_revert":target;
    return sealUsage({schemaVersion:"apn.asset-usage-reservation.v1",reservationId:reservationIdFor(identity,ih),idempotencyHash:ih,policyDigest:op.policies.find(x=>x.profileHash===(i===4?op.destinationProfileHash:op.profileHash))!.policyDigest,registryVersion:"synthetic-b2",...identity,rail:"bridge",amountAtomic:i===0?op.funding.amountAtomic:i===4?circleRoute(op.destinationChain,op.destinationProfile).destinationNativeCap:i===3?"15000000000000":"30000000000000",state:actual,reservedAt:new Date(at).toISOString(),updatedAt:new Date(at).toISOString(),effectAt:["finalized","failed_confirmed_revert"].includes(actual)?new Date(at).toISOString():null,outcomeDigest:["finalized","failed_confirmed_revert","failed_before_effect"].includes(actual)?"8".repeat(64):null,...(actual==="failed_confirmed_revert"?{consumedAtomic:"0"}:{})});
  });
}
function reserved(chain:143|59144|1329=143,profile?: "default" | "evm-live-buyer" | "evm-live-seller") {const op=funding(join(tmpdir(),"b2-synthetic"),chain,profile);return advanceCircleFundingOperation(op,{usage:holds(op)},"reserved",at);}
function controller(start:CircleFundingOperationV2,overrides:Partial<CircleFundingLifecyclePorts>={}) {
 let current=start,clock=at+1,signs=0,sends=0,consents=0;const saved:CircleFundingOperationV2[]=[];
 const material=(o:CircleFundingOperationV2,e:CircleEffect):CircleFundingMaterial=>({schemaVersion:"apn.circle-v2-evm-effect.v2",operationId:o.operationId,role:e.role,fingerprint:o.fingerprint,envelopeHash:e.envelope.envelopeHash,rawTransaction:"0x02",transactionHash:tx,materialHash:"9".repeat(64)});
 const ports:CircleFundingLifecyclePorts={now:()=>clock,save:async o=>{validateCircleFundingAdvance(current,o);current=o;saved.push(o);},assertOwnerPolicyAndConflicts:async()=>{},authorizationDeadline:async()=>new Date(at+900000).toISOString(),approve:async()=>{consents++;},preflight:async()=>{},seal:async(o,e,g)=>{assertCircleFundingEffectGuard(o,e,g);signs++;return material(o,e);},loadMaterial:async(o,e)=>material(o,e),broadcast:async(e,_raw,g)=>{g();assert.equal(current.effects.find(x=>x.role===e.role)!.phase,"submission_started");sends++;return tx;},observeEffect:async()=>null,observeSource:async()=>null,observeDestination:async()=>null,allowance:async()=>"0",attestation:async()=>null,mintEnvelope:async o=>circleEnvelope({chainId:o.destinationChain,from:o.funding.gasPayer,to:CIRCLE_TRANSMITTER,data:encodeCircleMint(o.attestation!),valueAtomic:"0",nonceAtomic:"10",gasLimitAtomic:"500000",maxFeePerGasAtomic:o.destinationChain===143?"102000000000":"20000000",maxPriorityFeePerGasAtomic:"0"}),cleanupEnvelope:async o=>circleEnvelope({chainId:42161,from:CIRCLE_SOURCE_OWNER,to:CIRCLE_SOURCE_TOKEN,data:encodeCircleApproval(true,o.funding),valueAtomic:"0",nonceAtomic:"3",gasLimitAtomic:"50000",maxFeePerGasAtomic:"20000000",maxPriorityFeePerGasAtomic:"0"}),usage:async(o,t)=>holds(o,t),...overrides};
 return {ports,current:()=>current,saved,signs:()=>signs,sends:()=>sends,consents:()=>consents,setClock:(n:number)=>{clock=n;}};
}

import { CircleFundingEvmService } from "../../src/circle-v2-evm/funding-runtime.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
for(const [chain,profile] of [[143,"default"],[59144,"evm-live-buyer"],[1329,"evm-live-buyer"],[1329,"evm-live-seller"]] as const)test(`V2 controller ${chain}/${profile} full cryptographic issuer and canonical recipient settlement`,async()=>{let op=reserved(chain,profile);const raw=source(op),included=decodeCircleSource(raw,chain,op.funding),finalized=decodeCircleSource({...raw,finalityTag:"finalized"},chain,op.funding),attested=await bindCircleAttestation(included,await issuer(op,included),snapshot(chain),op.funding);const proof={transactionHash:tx,blockHash:tx,blockNumberAtomic:"10",receiptHash:"a".repeat(64),actualFeeAtomic:"1",finalityBlockHash:tx,finalityBlockNumberAtomic:"10",transactionHashBinding:"a".repeat(64),logsHash:"b".repeat(64),finalityTag:"included" as const};let sourceFinal=false;
const dest=observation(chain,op.funding.gasPayer,CIRCLE_TRANSMITTER,encodeCircleMint(attested),[event("MessageReceived",CIRCLE_TRANSMITTER,{caller:op.funding.gasPayer,sourceDomain:3,nonce:attested.nonce,sender:circleWord(CIRCLE_MESSENGER),finalityThresholdExecuted:1000,messageBody:attested.body},0),event("Transfer",op.funding.destinationToken,{from:getAddress(`0x${"0".repeat(40)}`),to:recipient,value:999900n},1),event("Transfer",op.funding.destinationToken,{from:getAddress(`0x${"0".repeat(40)}`),to:feeRecipient,value:100n},2),event("MintAndWithdraw",CIRCLE_MESSENGER,{mintRecipient:recipient,amount:999900n,mintToken:op.funding.destinationToken,feeCollected:100n},3)]);
const delivered=decodeCircleDestination(included,attested,dest,"1",profile,feeRecipient,op.funding);const c=controller(op,{observeEffect:async(o,e)=>e.phase==="submitted"?e.role==="burn"?included:e.role==="mint"?delivered:proof:null,observeSource:async o=>o.effects[1]!.phase==="confirmed"||o.effects[1]!.phase==="submitted"?(sourceFinal?finalized:included):null,attestation:async()=>attested,observeDestination:async o=>o.effects.some(e=>e.role==="mint"&&e.phase!=="prepared")?delivered:null});
op=await approveCircleFundingSource(op,c.ports);assert.equal(op.residualAllowanceAtomic,"0");assert.equal(c.signs(),2);assert.equal(c.sends(),2);op=await approveCircleFundingMint(op,c.ports);assert.equal(op.terminal,false);assert.equal(c.signs(),3);assert.equal(c.sends(),3);sourceFinal=true;op=await observeCircleFunding(op,c.ports);assert.equal(op.state,"completed");assert.equal(op.destination!.recipient,recipient);assert.notEqual(recipient,op.destinationCustody.walletAddress);assert.equal(op.usage.length,5);assert.ok(op.usage.every(r=>["finalized","failed_confirmed_revert"].includes(r.state)));await approveCircleFundingMint(op,c.ports);assert.equal(c.signs(),3);assert.equal(c.sends(),3);
});
test("public legacy service rejects V2 before any signing or transport",async t=>{const root=await realpath(await mkdtemp(join(tmpdir(),"b2-public-closed-")));t.after(()=>rm(root,{recursive:true,force:true}));const op=funding(root,1329);await new CircleRepository(root).saveFunding(op);let calls=0;const service=new CircleEvmService(new StateStore(root),{create:async()=>{throw Error("CREATE_FORBIDDEN");},load:async()=>{calls++;throw Error("NO_KEY");}},{},()=>at,{}, {request:async()=>{calls++;throw Error("NO_HTTP");}});for(const method of ["approveSource","approveMint","observe","cleanup","refreshAttestation"] as const)await assert.rejects(service[method](op.operationId),/legacy_operation_schema_required/);assert.equal(calls,0);});
test("internal funding service refuses V1 and malformed identity before production ports",async t=>{const root=await realpath(await mkdtemp(join(tmpdir(),"b2-internal-closed-")));t.after(()=>rm(root,{recursive:true,force:true}));const old=initial(root,143);await new CircleRepository(root).save(old);let calls=0;const service=new CircleFundingEvmService(new StateStore(root),{create:async()=>{throw Error("CREATE_FORBIDDEN");},load:async()=>{calls++;throw Error("NO_KEY");}},{},()=>at,{}, {request:async()=>{calls++;throw Error("NO_HTTP");}});await assert.rejects(service.approveSource(old.operationId),/funding_operation_schema_required/);assert.equal(calls,0);});
test("fresh production fee port binds ceil fee and refuses over-cap response",async()=>{const op=reserved();let calls=0;const service=new CircleFundingEvmService(new StateStore(join(tmpdir(),"b2-fee-no-effects")),{create:async()=>{throw Error("CREATE_FORBIDDEN");},load:async()=>{throw Error("NO_KEY");}},{},()=>at,{}, {request:async(url,method,body)=>{calls++;assert.equal(url,"https://iris-api.circle.com/v2/burn/USDC/fees/3/15");assert.equal(method,"GET");assert.equal(body,null);return {status:200,body:JSON.stringify([{finalityThreshold:1000,minimumFee:calls===1?0.000001:100}])};}});const internal=service as unknown as {fee(b:CircleFundingOperationV2["funding"]):Promise<{quotedFeeAtomic:string}>};assert.equal((await internal.fee(op.funding)).quotedFeeAtomic,"1");await assert.rejects(internal.fee(op.funding));assert.equal(calls,2);});
for(const bad of ["none","principal","native","allowance","pending","chain"] as const)test(`production gross-aware source admission ${bad} retains full finite checks`,()=>{const op=reserved(),service=new CircleFundingEvmService(new StateStore(join(tmpdir(),"b2-admission-no-io")),{create:async()=>{throw Error("NO_CREATE");},load:async()=>{throw Error("NO_KEY");}}, {},()=>at);const internal=service as unknown as {sourceAccount(a:import("../../src/circle-v2-evm/preflight.js").CircleAccountPreflight,amount:string):{nonceAtomic:string}};const account={chainId:bad==="chain"?1:42161,address:CIRCLE_SOURCE_OWNER,usdcBalanceAtomic:bad==="principal"?"999999":"1000000",nativeBalanceAtomic:bad==="native"?"74999999999999":"75000000000000",allowanceAtomic:bad==="allowance"?"1":"0",latestNonceAtomic:"1",pendingNonceAtomic:bad==="pending"?"2":"1"};if(bad==="none")assert.equal(internal.sourceAccount(account,op.funding.amountAtomic).nonceAtomic,"1");else assert.throws(()=>internal.sourceAccount(account,op.funding.amountAtomic));});
for(const bad of ["none","nonce","native","allowance","principal","simulation","fee"] as const)test(`fresh production approval preflight ${bad} uses bound economics before effects`,async t=>{const root=await realpath(await mkdtemp(join(tmpdir(),"b2-fresh-ports-")));t.after(()=>rm(root,{recursive:true,force:true}));const op=funding(root,143);let deploy=0,identity=0,fee=0,call=0;const service=new CircleFundingEvmService(new StateStore(root),{create:async()=>{throw Error("NO_CREATE");},load:async()=>{throw Error("NO_KEY");}}, {},()=>at,{}, {request:async()=>{fee++;return {status:200,body:JSON.stringify([{finalityThreshold:1000,minimumFee:bad==="fee"?100:1}])};}});const remote={identity:async()=>{identity++;},call:async(method:string,params:readonly unknown[])=>{call++;if(method==="eth_getTransactionCount")return bad==="nonce"?"0x2":"0x1";if(method==="eth_getBalance")return bad==="native"?"0x0":"0x10000000000000";if(method==="eth_estimateGas")return "0x10000";if(method==="eth_call")return bad==="simulation"?"not_hex":"0x";throw Error(method);},read:async(_to:unknown,name:string)=>name==="allowance"?bad==="allowance"?"1":"0":bad==="principal"?"999999":"1000000"};const internal=service as unknown as {remotes(chain:number):unknown;preflightDeployments(...args:unknown[]):Promise<unknown>;ports(o:CircleFundingOperationV2):CircleFundingLifecyclePorts};t.mock.method(internal,"remotes",()=>({source:remote,destination:remote}));t.mock.method(internal,"preflightDeployments",async()=>{deploy++;return {digest:op.deploymentDigest};});const ports=internal.ports(op);if(bad==="none")await ports.preflight(op,op.effects[0]!);else await assert.rejects(ports.preflight(op,op.effects[0]!));assert.equal(deploy,1);assert.equal(identity,1);assert.ok(call>=3);assert.equal(fee,["none","principal","simulation","fee"].includes(bad)?1:0);});
test("production preflight rejects counterfeit full envelope before deployment or RPC reads",async t=>{const op=reserved();let reads=0;const service=new CircleFundingEvmService(new StateStore(join(tmpdir(),"b2-effect-no-rpc")),{create:async()=>{throw Error("NO_CREATE");},load:async()=>{throw Error("NO_KEY");}}, {},()=>at);const internal=service as unknown as {preflightDeployments(...args:unknown[]):Promise<unknown>;ports(o:CircleFundingOperationV2):CircleFundingLifecyclePorts};t.mock.method(internal,"preflightDeployments",async()=>{reads++;throw Error("NO_RPC");});const p=internal.ports(op),e=op.effects[0]!;await assert.rejects(p.preflight(op,{...e,envelope:{...e.envelope,nonceAtomic:"2"}}),/funding_selected_effect_changed/);assert.equal(reads,0);});

test("production funding constructor rejects injected terminal authority before key or RPC access", () => {
  let calls = 0, getters = 0; const wrapping = { create: async () => { calls++; throw Error("NO_KEY"); }, load: async () => { calls++; throw Error("NO_KEY"); } };
  const http = { request: async () => { calls++; throw Error("NO_RPC"); } };
  const accessor = Object.defineProperty({}, "deadlineMs", { enumerable: true, get: () => { getters++; return 60_000; } });
  const options: unknown[] = [{ openTerminal: () => { calls++; } }, { isTerminal: () => true }, { unknown: 1 }, accessor, Object.create({ deadlineMs: 60_000 }), new Proxy({}, { ownKeys: () => { getters++; return []; } }), { deadlineMs: 14_999 }, { deadlineMs: 300_001 }, { signal: Object.create(AbortSignal.prototype) }];
  for (const value of options) assert.throws(() => new CircleFundingEvmService(new StateStore(join(tmpdir(), "b2-fake-tty-constructor")), wrapping, {}, Date.now, value as never, http), /funding_tty_options/);
  assert.equal(calls, 0); assert.equal(getters, 0);
  new CircleFundingEvmService(new StateStore(join(tmpdir(), "b2-closed-tty-constructor")), wrapping, {}, Date.now, { deadlineMs: 15_000, signal: new AbortController().signal }, http);
  assert.equal(calls, 0);
});

import { readdir } from "node:fs/promises";
import { CircleRpc, CIRCLE_RPC_ABI } from "../../src/circle-v2-evm/rpc.js";
import { circleUint } from "../../src/circle-v2-evm/protocol.js";

for (const role of ["approval", "burn"] as const) for (const bad of ["none", "principal", "native", "allowance", "nonce"] as const)
test(`production ABI uint256 ${role} preflight ${bad} preserves finite checks`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "b2-abi-uint-preflight-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const op = funding(root, 143), effect = op.effects.find(e => e.role === role)!; let keys = 0, sends = 0, principalReads = 0;
  const service = new CircleFundingEvmService(new StateStore(root), { create: async () => { keys++; throw Error("NO_KEY"); }, load: async () => { keys++; throw Error("NO_KEY"); } }, {}, () => at, {},
    { request: async () => ({ status: 200, body: JSON.stringify([{ finalityThreshold: 1000, minimumFee: 1 }]) }) });
  const remote = new CircleRpc("https://abi-test.example", 42161);
  t.mock.method(remote, "call", async (method: string, args: readonly unknown[]) => {
    if (method === "eth_sendRawTransaction") { sends++; throw Error("NO_SEND"); }
    if (method === "eth_chainId") return "0xa4b1";
    if (method === "eth_getTransactionCount") return `0x${(BigInt(effect.envelope.nonceAtomic) + (bad === "nonce" ? 1n : 0n)).toString(16)}`;
    if (method === "eth_getBalance") return `0x${(bad === "native" ? 1n : 100_000_000_000_000n).toString(16)}`;
    if (method === "eth_estimateGas") return "0x10000";
    if (method === "eth_call") {
      const tx = args[0] as { to: string; data: Hex };
      if (tx.to === CIRCLE_SOURCE_TOKEN && args[1] === "latest") {
        const decoded = decodeFunctionData({ abi: CIRCLE_RPC_ABI, data: tx.data }); assert.equal(decoded.functionName, "allowance");
        const expected = role === "approval" ? 0n : BigInt(op.funding.amountAtomic);
        return encodeFunctionResult({ abi: CIRCLE_RPC_ABI, functionName: "allowance", result: bad === "allowance" ? expected + 1n : expected });
      }
      if (tx.to === CIRCLE_SOURCE_TOKEN && args[1] === "pending" && tx.data !== effect.envelope.data) {
        const decoded = decodeFunctionData({ abi: CIRCLE_RPC_ABI, data: tx.data }); assert.equal(decoded.functionName, "balanceOf"); principalReads++;
        return encodeFunctionResult({ abi: CIRCLE_RPC_ABI, functionName: "balanceOf", result: bad === "principal" ? 999999n : 1000000n });
      }
      return "0x";
    }
    throw Error(method);
  });
  // Keep CircleRpc.read and its real uint256 ABI decoder; only the TEST physical transport result is synthetic.
  const decoded = await remote.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], "pending");
  assert.equal(typeof decoded, "bigint"); assert.throws(() => circleUint(decoded)); principalReads = 0;
  const internal = service as unknown as { remotes(chain: number): unknown; preflightDeployments(...args: unknown[]): Promise<unknown>; ports(o: CircleFundingOperationV2): CircleFundingLifecyclePorts };
  t.mock.method(internal, "remotes", () => ({ source: remote, destination: remote })); t.mock.method(internal, "preflightDeployments", async () => ({ digest: op.deploymentDigest }));
  const ports = internal.ports(op);
  if (bad === "none") { await ports.preflight(op, effect); assert.equal(principalReads, 1); }
  else await assert.rejects(ports.preflight(op, effect), new RegExp(bad === "principal" ? "funding_source_principal_changed" : bad === "allowance" ? "exact_source_allowance_changed" : "nonce_or_native_balance_changed"));
  assert.equal(keys, 0); assert.equal(sends, 0); assert.deepEqual(await readdir(root), []);
});
/** Production mint-preflight regression: public TEST observations and TEST issuer keys, no authority/custody seam. */
async function finiteMintPreflight(root: string, chain: 143 | 59144 | 1329) {
  const original = funding(root, chain), secondRecipient = getAddress(`0x${"66".repeat(20)}`);
  const b = circleFundingBinding(chain, original.destinationProfile, { recipient: secondRecipient, amountAtomic: "510000", maxFeeAtomic: "10000", minMintAtomic: "500000" });
  const feeQuote = quoteCircleFundingFee(b, [{ finalityThreshold: 1000, minimumFee: 1 }], at, at);
  const effects = original.effects.map(e => { const { envelopeHash: _h, ...body } = e.envelope; return { ...e, envelope: circleEnvelope({ ...body, data: e.role === "burn" ? encodeCircleBurn(chain, b) : encodeCircleApproval(false, b) }) }; });
  let op = sealCircleFundingOperation({ ...original, funding: b, feeQuote, feeQuoteAtomic: feeQuote.quotedFeeAtomic, effects, transitions: [] });
  op = sealCircleFundingOperation({ ...op, fingerprint: circleFundingFingerprint(op) }); op = advanceCircleFundingOperation(op, {}, "synthetic_generic_prepared", at);
  const bytesFor = (attested: boolean) => { let bytes = message(chain, attested, 10000n); const put = (offset: number, word: string) => { bytes = `${bytes.slice(0, 2 + offset * 2)}${word}${bytes.slice(2 + (offset + 32) * 2)}` as Hex; };
    put(184, circleWord(b.recipient).slice(2)); put(216, BigInt(b.amountAtomic).toString(16).padStart(64, "0")); put(280, BigInt(b.maxFeeAtomic).toString(16).padStart(64, "0")); return bytes; };
  const burn = effects[1]!, e = burn.envelope;
  const seen = observation(42161, CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER, e.data, [event("MessageSent", CIRCLE_TRANSMITTER, { message: bytesFor(false) }, 0), event("DepositForBurn", CIRCLE_MESSENGER, { burnToken: CIRCLE_SOURCE_TOKEN, amount: 510000n, depositor: CIRCLE_SOURCE_OWNER, mintRecipient: circleWord(b.recipient), destinationDomain: b.destinationDomain, destinationTokenMessenger: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, maxFee: 10000n, minFinalityThreshold: 1000, hookData: "0x" }, 1)]);
  const observed = { ...seen, transaction: { ...seen.transaction as Record<string, unknown>, nonce: `0x${BigInt(e.nonceAtomic).toString(16)}`, gas: `0x${BigInt(e.gasLimitAtomic).toString(16)}`, maxFeePerGas: `0x${BigInt(e.maxFeePerGasAtomic).toString(16)}`, maxPriorityFeePerGas: `0x${BigInt(e.maxPriorityFeePerGasAtomic).toString(16)}` } };
  const proof = decodeCircleSource(observed, chain, b), bytes = bytesFor(true), m = decodeCircleMessage(bytes, chain, true, b);
  const issuerKeys = [1n, 2n].map(n => privateKeyToAccount(`0x${n.toString(16).padStart(64, "0")}`)).sort((a,c) => BigInt(a.address) < BigInt(c.address) ? -1 : 1), signatures = await Promise.all(issuerKeys.map(k => k.sign({ hash: m.hash })));
  const response = { sourceTxHash: proof.transactionHash, messages: [{ cctpVersion: 2, status: "complete", eventNonce: m.nonce, message: bytes, attestation: `0x${signatures.map(z => z.slice(2)).join("")}`, decodedMessage: { sourceDomain: "3", destinationDomain: String(b.destinationDomain), nonce: m.nonce, sender: circleWord(CIRCLE_MESSENGER), recipient: circleWord(CIRCLE_MESSENGER), destinationCaller: CIRCLE_ZERO, messageBody: m.body, decodedMessageBody: { burnToken: circleWord(CIRCLE_SOURCE_TOKEN), mintRecipient: circleWord(b.recipient), amount: b.amountAtomic, messageSender: circleWord(CIRCLE_SOURCE_OWNER) } } }] };
  const attestation = await bindCircleAttestation(proof, response, snapshot(chain), b), route = circleRoute(chain, op.destinationProfile);
  const mint: CircleEffect = { role: "mint", phase: "prepared", envelope: circleEnvelope({ chainId: chain, from: route.gasPayer, to: CIRCLE_TRANSMITTER, data: encodeCircleMint(attestation), valueAtomic: "0", nonceAtomic: "1", gasLimitAtomic: "500000", maxFeePerGasAtomic: chain === 143 ? "100000000000" : "20000000", maxPriorityFeePerGasAtomic: "1" }), transactionHash: null, materialHash: null, proof: null };
  op = advanceCircleFundingOperation(op, { state: "awaiting_mint", source: proof, attestation, effects: [effects[0]!, { ...burn, phase: "submitted", transactionHash: proof.transactionHash, materialHash: "b".repeat(64) }, mint] }, "synthetic_authenticated_source", at);
  validateCircleFundingOperation(op); assert.equal(op.attestation!.receivedAtomic, "500000"); return { op, observed };
}
for (const chain of [143, 59144, 1329] as const) for (const bad of ["none", "beneficiary", "fee", "caller", "signer", "nonce", "expiry"] as const) test(`actual production mint preflight ${chain}/${bad} verifies generic finite binding before custody`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "b2-mint-actual-preflight-"))); t.after(() => rm(root, { recursive: true, force: true })); const fixture = await finiteMintPreflight(root, chain); let op = fixture.op, keys = 0, sends = 0, attesterReads = 0, usedReads = 0;
  if (["beneficiary", "fee", "caller", "signer"].includes(bad)) { const a = op.attestation!; let bytes = a.bytes, signatures = a.attestation;
    const put = (offset: number, word: string) => { bytes = `${bytes.slice(0, 2 + offset * 2)}${word}${bytes.slice(2 + (offset + 32) * 2)}` as Hex; };
    if (bad === "beneficiary") put(184, circleWord(recipient).slice(2)); if (bad === "fee") put(312, (10001n).toString(16).padStart(64, "0")); if (bad === "caller") put(108, circleWord(recipient).slice(2));
    if (bad === "signer") signatures = `${signatures.slice(0, -130)}${(await privateKeyToAccount(`0x${3n.toString(16).padStart(64, "0")}`).sign({ hash: a.hash })).slice(2)}` as Hex;
    const { integrityHash: _h, ...body } = a; const modified = { ...body, bytes, body: `0x${bytes.slice(2 + 148 * 2)}` as Hex, hash: keccak256(bytes), attestation: signatures }, attestation = { ...modified, integrityHash: hashObject(modified) };
    const oldMint = op.effects[2]!, { envelopeHash: _e, ...envelope } = oldMint.envelope;
    op = advanceCircleFundingOperation(op, { attestation, effects: [...op.effects.slice(0, 2), { ...oldMint, envelope: circleEnvelope({ ...envelope, data: encodeCircleMint(attestation) }) }] }, "synthetic_tamper", at);
  }
  const service = new CircleFundingEvmService(new StateStore(root), { create: async () => { keys++; throw Error("NO_KEY"); }, load: async () => { keys++; throw Error("NO_KEY"); } }, {}, () => at);
  const source = { observation: async () => fixture.observed, read: async () => "0" }, destination = { identity: async () => {}, call: async (method: string) => { if (method === "eth_sendRawTransaction") { sends++; throw Error("NO_SEND"); } if (method === "eth_getTransactionCount") return "0x1"; if (method === "eth_getBalance") return "0x100000000000000000"; if (method === "eth_estimateGas") return "0x10000"; if (method === "eth_call") return `0x${"0".repeat(63)}1`; throw Error(method); }, block: async () => ({ number: bad === "expiry" ? "0x3e8" : "0xa" }), read: async () => { usedReads++; return bad === "nonce" ? "1" : "0"; } };
  const internal = service as unknown as { remotes(chain: number): unknown; preflightDeployments(...args: unknown[]): Promise<unknown>; preflightAttesters(...args: unknown[]): Promise<unknown>; ports(o: CircleFundingOperationV2): CircleFundingLifecyclePorts };
  t.mock.method(internal, "remotes", () => ({ source, destination })); t.mock.method(internal, "preflightDeployments", async () => ({ digest: op.deploymentDigest })); t.mock.method(internal, "preflightAttesters", async () => { attesterReads++; return snapshot(chain); });
  const ports = internal.ports(op), mint = op.effects[2]!; if (bad === "none") { await ports.preflight(op, mint); assert.equal(attesterReads, 1); assert.equal(usedReads, 1); } else { await assert.rejects(ports.preflight(op, mint)); if (bad === "signer") assert.equal(attesterReads, 1); if (bad === "nonce" || bad === "expiry") assert.equal(usedReads, 1); }
  assert.deepEqual(await readdir(root), []); assert.equal(keys, 0); assert.equal(sends, 0);
});
