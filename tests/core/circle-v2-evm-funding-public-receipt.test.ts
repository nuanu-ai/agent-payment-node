import assert from "node:assert/strict";
import { advanceCircle, saveCircleV1 } from "./circle-v1-journal.js";
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
import { ApnCore } from "../../src/core.js";
import { CircleFundingEvmService } from "../../src/circle-v2-evm/funding-runtime.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
test("V2 generic and Circle status retain exact funding; pending receipt absent; terminal cancellation checked",async t=>{
 const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),repo=new CircleRepository(tmp.root),op=funding(tmp.root);await repo.saveFunding(op);
 let keys=0;const wrapping={load:async()=>{keys++;throw Error("private forbidden");},create:async()=>{keys++;throw Error("private forbidden");}},core=new ApnCore({state,native:new TestNative(),rpc:new TestRpc(),circleFundingEvm:new CircleFundingEvmService(state,wrapping,{})});
 const generic=await core.execute({command:"operation.status",operationId:op.operationId}),circle=await core.execute({command:"circle.evm.status",operationId:op.operationId});assert.equal(generic.ok,true);assert.deepEqual(generic.operation,circle.operation);assert.equal((generic.operation as {amount_atomic:string}).amount_atomic,"510000");assert.equal((generic.operation as {recipient:string}).recipient,params.recipient);assert.equal((generic.operation as {minimum_output_atomic:string}).minimum_output_atomic,"500000");assert.equal((generic.operation as {maximum_issuer_fee_atomic:string}).maximum_issuer_fee_atomic,"10000");
 const pending=await core.execute({command:"receipt.get",operationId:op.operationId});assert.equal(pending.ok,false);assert.equal(pending.error?.code,"APN_RECEIPT_NOT_FOUND");
 const done=advanceCircleFundingOperation(op,{state:"cancelled_unsubmitted",terminal:true,usageFinalized:true},"cancelled",at+1);await repo.saveFunding(done);const receipt=await core.execute({command:"receipt.get",operationId:op.operationId});assert.equal(receipt.ok,true);assert.deepEqual(receipt.receipt,publicKnownCircle(done));assert.equal(keys,0);
 await writeFile(join(tmp.root,"circle-v2-evm",op.operationId+".json"),JSON.stringify({...done,funding:{...done.funding,recipient:getAddress(`0x${"66".repeat(20)}`)}}));const corrupt=await core.execute({command:"receipt.get",operationId:op.operationId});assert.equal(corrupt.ok,false);assert.equal(corrupt.receipt,null);assert.equal(keys,0);
});
test("V1 generic terminal receipt keeps historical fixed fields; status and observe answer it with no runtime",async t=>{const tmp=await temporaryState();t.after(tmp.cleanup);const state=new StateStore(tmp.root),op=initial(tmp.root);await state.initialize();const done=advanceCircle(op,{state:"cancelled_unsubmitted",terminal:true,usageFinalized:true},"cancelled",at+1);await saveCircleV1(tmp.root,done);const core=new ApnCore({state,native:new TestNative(),rpc:new TestRpc()});const result=await core.execute({command:"receipt.get",operationId:op.operationId});assert.equal(result.ok,true);assert.deepEqual(result.receipt,publicKnownCircle(done));assert.equal((result.receipt as {amount_atomic:string}).amount_atomic,"40100");assert.equal(Object.hasOwn(result.receipt as object,"recipient"),false);
 for(const command of ["circle.evm.status","circle.evm.observe","operation.status"] as const){const read=await core.execute({command,operationId:op.operationId});assert.equal(read.ok,true,JSON.stringify(read));assert.deepEqual(read.operation,publicKnownCircle(done));}
 const refused=await core.execute({command:"circle.evm.approve-mint",operationId:op.operationId});assert.equal(refused.ok,false);assert.equal(refused.error?.code,"APN_OPERATION_BLOCKED");});
