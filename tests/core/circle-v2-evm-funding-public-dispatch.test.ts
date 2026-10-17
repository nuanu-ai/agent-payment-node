import { runCli, parseArgv } from "../../src/cli.js";
import { saveCircleV1 } from "./circle-v1-journal.js";
import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { temporaryState, TestNative, TestRpc } from "./helpers.js";
import { StateStore } from "../../src/state.js";
import { CircleRepository } from "../../src/circle-v2-evm/repository.js";
import { circleFundingBinding, quoteCircleFundingFee } from "../../src/circle-v2-evm/funding-binding.js";
import { advanceCircleFundingOperation, sealCircleFundingOperation, circleFundingFingerprint, publicKnownCircle } from "../../src/circle-v2-evm/funding-operation.js";
import { circleEnvelope } from "../../src/circle-v2-evm/operation-model.js";
import { encodeCircleApproval, encodeCircleBurn } from "../../src/circle-v2-evm/protocol.js";
import { initial, at, fundingIdentity } from "./circle-v2-evm-nonce-runtime-fixtures.js";
const params = { recipient: getAddress(`0x${"55".repeat(20)}`), amountAtomic: "510000", maxFeeAtomic: "10000", minMintAtomic: "500000" };
function funding(root: string) {
  const legacy = initial(root), b = circleFundingBinding(143, fundingIdentity(legacy), params), feeQuote = quoteCircleFundingFee(b, [{ finalityThreshold: 1000, minimumFee: 1 }], at, at);
  const { schemaVersion: _v, integrityHash: _h, transitions: _t, externalFulfillment: _e, nonceRetirement: _n, ...rest } = legacy;
  const effects = rest.effects.map(e => { const { envelopeHash: _old, ...envelope } = e.envelope; return { ...e, envelope: circleEnvelope({ ...envelope, data: e.role === "burn" ? encodeCircleBurn(143, b) : encodeCircleApproval(false, b) }) }; });
  let op = sealCircleFundingOperation({ ...rest, schemaVersion: "apn.circle-v2-evm-operation.v2", funding: b, feeQuote, feeQuoteAtomic: feeQuote.quotedFeeAtomic, state: "awaiting_source", policies: rest.policies.map(p => ({ ...p, activationDigest: "a".repeat(64) })), expiresAt: new Date(at + 900000).toISOString(), effects, transitions: [] });
  op = sealCircleFundingOperation({ ...op, fingerprint: circleFundingFingerprint(op) });
  return advanceCircleFundingOperation(op, {}, "prepared", at);
}
import { executeCircleCommand } from "../../src/circle-command-service.js";
import type { RuntimeContext } from "../../src/runtime.js";
import type { CommandRequest } from "../../src/commands.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const actions = ["approve-source", "approve-mint", "observe", "refresh-attestation", "cleanup", "status"] as const;
test("v2 ordinary public commands select the funding service only",async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=funding(tmp.root);await new CircleRepository(tmp.root).saveFunding(op);
 const calls:string[]=[];const service=Object.fromEntries(["approveSource","approveMint","observe","refreshAttestation","cleanup","status"].map(method=>[method,async()=>{calls.push(method);return method==="status"?publicKnownCircle(op):{operation:op,externalMint:null};}]));
 const context={state,circleFundingEvm:service} as unknown as RuntimeContext;
 for(const action of actions)await executeCircleCommand({command:`circle.evm.${action}`,operationId:op.operationId} as Extract<CommandRequest,{command:`circle.${string}`}>,context);
 assert.equal(calls.length,actions.length);
});
test("a v1 journal is read-only: status answers from the journal; every effect command refuses before any runtime; cleanup-nonce is gone",async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=initial(tmp.root);await state.initialize();await saveCircleV1(tmp.root,op);let entries=0;
 const trap=new Proxy({}, {get:()=>async()=>{entries++;throw Error("entry");}});const context={state,circleFundingEvm:trap} as unknown as RuntimeContext;
 const status=await executeCircleCommand({command:"circle.evm.status",operationId:op.operationId},context) as { operation?: { operation_id?: string; state?: string } };
 assert.equal(status.operation?.operation_id,op.operationId);assert.equal(status.operation?.state,"awaiting_source");
 // Observe answers only a terminal v1 journal; this one is not terminal.
 for(const action of ["approve-source","approve-mint","observe","refresh-attestation","cleanup"] as const)await assert.rejects(executeCircleCommand({command:`circle.evm.${action}`,operationId:op.operationId},context),{code:"APN_OPERATION_BLOCKED",message:/read-only/});
 await assert.rejects(executeCircleCommand({command:"circle.evm.adopt-external-mint",operationId:op.operationId,transactionHash:`0x${"a".repeat(64)}`},context),{code:"APN_OPERATION_BLOCKED"});
 assert.equal(entries,0);assert.throws(()=>parseArgv(["circle","evm","cleanup-nonce","--operation",op.operationId]));
});
test("v2 missing funding runtime has no fallback",async t=>{const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=funding(tmp.root),repo=new CircleRepository(tmp.root);await repo.saveFunding(op);let entries=0;const context={state} as unknown as RuntimeContext;await assert.rejects(executeCircleCommand({command:"circle.evm.approve-source",operationId:op.operationId},context),{code:"APN_PROVIDER_CAPABILITY_UNAVAILABLE"});assert.equal(entries,0);});
test("corrupt and unknown durable schemas refuse before service entry",async t=>{const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=funding(tmp.root);await state.initialize();await mkdir(join(tmp.root,"circle-v2-evm"),{mode:0o700});let entries=0;const trap={approveSource:async()=>{entries++;}};for(const changed of [{...op,schemaVersion:"future"},{...op,funding:{...op.funding,amountAtomic:"1"}}]){await writeFile(join(tmp.root,"circle-v2-evm",op.operationId+".json"),JSON.stringify(changed),{mode:0o600});await assert.rejects(executeCircleCommand({command:"circle.evm.approve-source",operationId:op.operationId},{state,circleFundingEvm:trap} as unknown as RuntimeContext));}assert.equal(entries,0);});
test("direct prepare rejects missing or malformed funding before runtime selection; the v1 shape is read-only",async t=>{const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root);let calls:string[]=[];const context={state,circleFundingEvm:{prepare:async(input:{funding:unknown})=>{calls.push("v2");assert.deepEqual(input.funding,params);return funding(tmp.root);}}} as unknown as RuntimeContext;const base={command:"circle.evm.prepare",profile:"evm-live-buyer",destinationProfile:"default",destinationChain:143,idempotencyKey:"funding-example-1"} as const;for(const bad of [{},{recipient:params.recipient},{...params,minMintAtomic:"500001"},undefined])await assert.rejects(executeCircleCommand({...base,funding:bad} as never,context),{code:"APN_INVALID_INPUT"});await assert.rejects(executeCircleCommand(base as never,context),{code:"APN_INVALID_INPUT"});assert.deepEqual(calls,[]);await executeCircleCommand({...base,funding:params},context);assert.deepEqual(calls,["v2"]);});

test("normal source CLI refuses the fixed V1 prepare and reaches V2 through full tuple runtime wiring",async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);let keys=0;const calls:string[]=[];
 const options={stateRoot:tmp.root,native:new TestNative(),rpc:new TestRpc(),wrappingSecret:{load:async()=>{keys++;throw Error("private forbidden");},create:async()=>{keys++;throw Error("private forbidden");}},circleFundingEvm:{prepare:async(input:{funding:unknown})=>{calls.push("v2");assert.deepEqual(input.funding,params);return funding(tmp.root);}} as never};
 const base=["circle","evm","prepare","--profile","evm-live-buyer","--destination-profile","default","--destination-chain","143","--idempotency-key","funding-example-1"];
 const old=await runCli(base,{},options);assert.equal(old.ok,false);assert.equal(old.error?.code,"APN_INVALID_INPUT");
 const result=await runCli([...base,"--beneficiary",params.recipient,"--gross-atomic",params.amountAtomic,"--max-issuer-fee-atomic",params.maxFeeAtomic,"--min-mint-atomic",params.minMintAtomic],{},options);assert.equal(result.ok,true);assert.equal((result.operation as {amount_atomic:string}).amount_atomic,params.amountAtomic);assert.equal((result.operation as {recipient:string}).recipient,params.recipient);assert.deepEqual(calls,["v2"]);assert.equal(keys,0);
});

test("V2 explicit external adoption selects only funding service and exact transaction",async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=funding(tmp.root);await new CircleRepository(tmp.root).saveFunding(op);let selected=0;const hash=`0x${"a".repeat(64)}`;
 const context={state,circleFundingEvm:{adoptExternalMint:async(id:string,tx:string)=>{assert.equal(id,op.operationId);assert.equal(tx,hash);selected++;return op;}}} as unknown as RuntimeContext;
 await executeCircleCommand({command:"circle.evm.adopt-external-mint",operationId:op.operationId,transactionHash:hash} as never,context);assert.equal(selected,1);
});
