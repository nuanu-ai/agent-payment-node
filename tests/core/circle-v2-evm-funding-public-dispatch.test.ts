import { runCli } from "../../src/cli.js";
import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { temporaryState, TestNative, TestRpc } from "./helpers.js";
import { StateStore } from "../../src/state.js";
import { CircleRepository } from "../../src/circle-v2-evm/repository.js";
import { circleFundingBinding, quoteCircleFundingFee } from "../../src/circle-v2-evm/funding-binding.js";
import { advanceCircleFundingOperation, sealCircleFundingOperation, circleFundingFingerprint, publicKnownCircle } from "../../src/circle-v2-evm/funding-operation.js";
import { circleEnvelope, advanceCircle } from "../../src/circle-v2-evm/operation-model.js";
import { encodeCircleApproval, encodeCircleBurn } from "../../src/circle-v2-evm/protocol.js";
import { initial, at } from "./circle-v2-evm-nonce-runtime-fixtures.js";
const params = { recipient: getAddress(`0x${"55".repeat(20)}`), amountAtomic: "510000", maxFeeAtomic: "10000", minMintAtomic: "500000" };
function funding(root: string) {
  const legacy = initial(root), b = circleFundingBinding(143, "default", params), feeQuote = quoteCircleFundingFee(b, [{ finalityThreshold: 1000, minimumFee: 1 }], at, at);
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
for (const schema of ["v1","v2"] as const) test(`${schema} ordinary public commands select exclusively matching service`,async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),repo=new CircleRepository(tmp.root),op=schema==="v1"?initial(tmp.root):funding(tmp.root);if(schema==="v1")await repo.save(op as ReturnType<typeof initial>);else await repo.saveFunding(op as ReturnType<typeof funding>);
 const calls:string[]=[];const service=(label:string)=>Object.fromEntries(["approveSource","approveMint","observe","refreshAttestation","cleanup","status"].map(method=>[method,async()=>{calls.push(label+":"+method);return method==="status"?publicKnownCircle(op):op;}]));
 const context={state,circleEvm:service("v1"),circleFundingEvm:service("v2")} as unknown as RuntimeContext;
 for(const action of actions)await executeCircleCommand({command:`circle.evm.${action}`,operationId:op.operationId} as Extract<CommandRequest,{command:`circle.${string}`}>,context);
 assert.equal(calls.length,actions.length);assert.ok(calls.every(x=>x.startsWith(schema+":")));
});
test("V2 historical commands refuse before all service entry",async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=funding(tmp.root);await new CircleRepository(tmp.root).saveFunding(op);let entries=0;const trap=new Proxy({}, {get:()=>async()=>{entries++;throw Error("entry");}});const context={state,circleEvm:trap,circleFundingEvm:trap} as unknown as RuntimeContext;
 for(const action of ["cleanup-nonce","cleanup85-prepare","cleanup85-cancel","cleanup86-approve","adopt-external-mint"])await assert.rejects(executeCircleCommand({command:`circle.evm.${action}`,operationId:op.operationId,transactionHash:`0x${"a".repeat(64)}`} as never,context),{code:"APN_OPERATION_BLOCKED"});assert.equal(entries,0);
});
for(const schema of ["v1","v2"] as const)test(`${schema} missing selected runtime has no fallback`,async t=>{const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=schema==="v1"?initial(tmp.root):funding(tmp.root),repo=new CircleRepository(tmp.root);if(schema==="v1")await repo.save(op as ReturnType<typeof initial>);else await repo.saveFunding(op as ReturnType<typeof funding>);let entries=0;const context={state,[schema==="v1"?"circleFundingEvm":"circleEvm"]:{approveSource:async()=>{entries++;}}} as unknown as RuntimeContext;await assert.rejects(executeCircleCommand({command:"circle.evm.approve-source",operationId:op.operationId},context),{code:"APN_PROVIDER_CAPABILITY_UNAVAILABLE"});assert.equal(entries,0);});
test("corrupt and unknown durable schemas refuse before service entry",async t=>{const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=funding(tmp.root);await state.initialize();await mkdir(join(tmp.root,"circle-v2-evm"),{mode:0o700});let entries=0;const trap={approveSource:async()=>{entries++;}};for(const changed of [{...op,schemaVersion:"future"},{...op,funding:{...op.funding,amountAtomic:"1"}}]){await writeFile(join(tmp.root,"circle-v2-evm",op.operationId+".json"),JSON.stringify(changed),{mode:0o600});await assert.rejects(executeCircleCommand({command:"circle.evm.approve-source",operationId:op.operationId},{state,circleEvm:trap,circleFundingEvm:trap} as unknown as RuntimeContext));}assert.equal(entries,0);});
test("direct prepare rejects malformed funding before runtime selection; valid V1/V2 select separately",async t=>{const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root);let calls:string[]=[];const context={state,circleEvm:{prepare:async(input:unknown)=>{calls.push("v1");assert.deepEqual(input,base);return initial(tmp.root);}},circleFundingEvm:{prepare:async(input:{funding:unknown})=>{calls.push("v2");assert.deepEqual(input.funding,params);return funding(tmp.root);}}} as unknown as RuntimeContext;const base={command:"circle.evm.prepare",profile:"evm-live-buyer",destinationProfile:"default",destinationChain:143,idempotencyKey:"funding-example-1"} as const;for(const bad of [{},{recipient:params.recipient},{...params,minMintAtomic:"500001"},undefined])await assert.rejects(executeCircleCommand({...base,funding:bad} as never,context),{code:"APN_INVALID_INPUT"});assert.deepEqual(calls,[]);await executeCircleCommand(base,context);await executeCircleCommand({...base,funding:params},context);assert.deepEqual(calls,["v1","v2"]);});

test("normal source CLI preserves V1 prepare and reaches V2 through full tuple runtime wiring",async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);let keys=0;const calls:string[]=[];
 const options={stateRoot:tmp.root,native:new TestNative(),rpc:new TestRpc(),wrappingSecret:{load:async()=>{keys++;throw Error("private forbidden");},create:async()=>{keys++;throw Error("private forbidden");}},circleEvm:{prepare:async()=>{calls.push("v1");return initial(tmp.root);}} as never,circleFundingEvm:{prepare:async(input:{funding:unknown})=>{calls.push("v2");assert.deepEqual(input.funding,params);return funding(tmp.root);}} as never};
 const base=["circle","evm","prepare","--profile","evm-live-buyer","--destination-profile","default","--destination-chain","143","--idempotency-key","funding-example-1"];
 const old=await runCli(base,{},options);assert.equal(old.ok,true);assert.equal((old.operation as {amount_atomic:string}).amount_atomic,"40100");
 const result=await runCli([...base,"--beneficiary",params.recipient,"--gross-atomic",params.amountAtomic,"--max-issuer-fee-atomic",params.maxFeeAtomic,"--min-mint-atomic",params.minMintAtomic],{},options);assert.equal(result.ok,true);assert.equal((result.operation as {amount_atomic:string}).amount_atomic,params.amountAtomic);assert.equal((result.operation as {recipient:string}).recipient,params.recipient);assert.deepEqual(calls,["v1","v2"]);assert.equal(keys,0);
});
