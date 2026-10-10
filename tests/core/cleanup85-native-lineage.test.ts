import test from "node:test";
import assert from "node:assert/strict";
import { readFile,mkdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Cleanup85NativeCancellation } from "../../src/circle-cleanup85-native-cancellation.js";
import { assertCleanup85NativeSlot } from "../../src/circle-cleanup85-native-ledger-authority.js";
import { assetUsageReservationId } from "../../src/asset-usage-ledger-record.js";
import { CLEANUP85_OWNER } from "../../src/circle-cleanup85-native-codec.js";
import { hashObject } from "../../src/canonical.js";
import { sealOperation } from "../../src/state.js";
import { evmDirectFingerprint } from "../../src/evm-direct.js";
import { validateCleanup85NativeBinding } from "../../src/circle-cleanup85-native-binding.js";
import { assertCleanup85NativeLineageOperation,cleanup85NativeRequestHash,cleanup85NativeSlotBody,cleanup85NativeSlotKind } from "../../src/circle-cleanup85-native-lineage.js";
import { Cleanup85NativePublicRecords,loadCleanup85NativeReservationIdentity } from "../../src/circle-cleanup85-native-records.js";
import { verifiedCleanup85NativeLineage,verifiedCleanup85SuccessorFinancialAdmission } from "../../src/circle-cleanup85-unsigned-retirement.js";
import type { OperationRecord } from "../../src/model.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
async function captured(){return JSON.parse(await readFile(new URL("../fixtures/cleanup85-native/original-unsigned.json",import.meta.url),"utf8")) as {operation:OperationRecord;slot:unknown;prepared:unknown};}
test("actual original unsigned metadata retains original binding and C denial lookup identity",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root);await state.initialize();const c=await captured(),r=c.operation.evm!.cleanup85Cancellation!.request,namespace=`cleanup85-native:${r.recoveryBinding}`,lineage={originalOperationId:c.operation.operationId,operationId:c.operation.operationId,namespace,retirementProofHash:null,readmission:null};
 assertCleanup85NativeLineageOperation(state,c.operation,lineage);assert.equal(cleanup85NativeRequestHash(r,lineage),c.operation.requestHash);assert.deepEqual(cleanup85NativeSlotBody(c.operation,lineage),c.slot);assert.equal(cleanup85NativeSlotKind(lineage),"slot");
 await state.writeOperation(c.operation);await new Cleanup85NativePublicRecords(temp.root).publish(r.parentOperationId,"slot",c.slot);
 assert.deepEqual(await loadCleanup85NativeReservationIdentity(state),{operationId:c.operation.operationId,fingerprint:c.operation.fingerprint,nativeReservationId:c.operation.evm!.cleanup85Cancellation!.nativeReservationId});
});
// Synthetic successor DTO exercises pure body comparison only: it is NEVER admission or signing authority.
async function syntheticSuccessor(state:StateStore){
 const c=await captured(),r=c.operation.evm!.cleanup85Cancellation!.request,retirementProofHash="a".repeat(64),namespace=`cleanup85-native-successor:${r.recoveryBinding}:${retirementProofHash}`,lineage={originalOperationId:c.operation.operationId,operationId:state.operationId("evm-live-buyer",namespace),namespace,retirementProofHash,readmission:null};
 const {integrityHash:_,...body}=structuredClone(c.operation);body.operationId=lineage.operationId;body.idempotencyHash=state.idempotencyHash(namespace);body.requestHash=cleanup85NativeRequestHash(r,lineage);body.evm={...body.evm!,cleanup85Cancellation:{...body.evm!.cleanup85Cancellation!,version:"apn.circle-cleanup85-native-binding.v2",nativeReservationId:assetUsageReservationId({account:CLEANUP85_OWNER,chain:"eip155:42161",asset:{kind:"native",identifier:null}},`apn.cleanup85-native:${lineage.operationId}`),successor:{originalOperationId:lineage.originalOperationId,retirementProofHash}}};body.fingerprint=evmDirectFingerprint(body);
 return {op:sealOperation(body),r,lineage};
}
test("versioned successor comparator preserves public request/wire and requires separate identity/slot",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root),{op,r,lineage}=await syntheticSuccessor(state),c=await captured();assertCleanup85NativeLineageOperation(state,op,lineage);assert.equal(cleanup85NativeSlotKind(lineage),"successor-slot");assert.notEqual(op.operationId,c.operation.operationId);assert.notEqual(op.requestHash,c.operation.requestHash);assert.deepEqual(op.evm!.cleanup85Cancellation!.request,c.operation.evm!.cleanup85Cancellation!.request);assert.deepEqual(op.economics,c.operation.economics);assert.equal(op.transactionData,"0x");assert.equal(op.amountAtomic,"1");assert.equal(op.evm!.maxFeeWei,"2000000000000");assert.equal((cleanup85NativeSlotBody(op,lineage) as {retirementProofHash:string}).retirementProofHash,lineage.retirementProofHash);assert.equal(hashObject(r),hashObject(c.operation.evm!.cleanup85Cancellation!.request));
});
for(const kind of ["operationId","idempotencyHash","requestHash","originalOperationId","retirementProofHash","nativeReservationId","version"] as const)test(`pure successor ${kind} mutation cannot retain lineage binding`,async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root),{op,lineage}=await syntheticSuccessor(state),changed=structuredClone(op);
 if(kind==="operationId"||kind==="idempotencyHash"||kind==="requestHash")(changed as unknown as Record<string,unknown>)[kind]="b".repeat(64);else {const binding=changed.evm!.cleanup85Cancellation! as unknown as Record<string,unknown>;if(kind==="nativeReservationId")binding.nativeReservationId="b".repeat(64);else if(kind==="version")binding.version="apn.circle-cleanup85-native-binding.v1";else binding.successor={...changed.evm!.cleanup85Cancellation!.successor!,[kind]:"b".repeat(64)};}
 assert.throws(()=>assertCleanup85NativeLineageOperation(state,changed,lineage));
});
test("v1 absence bytes remain compatible and v1 cannot smuggle successor fields",async()=>{const c=await captured(),b=c.operation.evm!.cleanup85Cancellation!;assert.deepEqual(validateCleanup85NativeBinding(structuredClone(b)),b);assert.throws(()=>validateCleanup85NativeBinding({...b,successor:{originalOperationId:"a".repeat(64),retirementProofHash:"b".repeat(64)}}));});
test("plain or cloned source lineage/admission DTOs grant no private capability",async t=>{const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root),{r,lineage}=await syntheticSuccessor(state);for(const fake of [{kind:"verified-cleanup85-native-lineage"},structuredClone(lineage),{}])assert.throws(()=>verifiedCleanup85NativeLineage(fake as never,state,r));for(const fake of [{kind:"verified-cleanup85-successor-financial-admission"},{lineage},{}])assert.throws(()=>verifiedCleanup85SuccessorFinancialAdmission(fake as never,state,r));});

test("successor cannot present legacy v1 to bypass its private lineage",async t=>{const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root),{op}=await syntheticSuccessor(state),changed=structuredClone(op);const {successor:_,...body}=changed.evm!.cleanup85Cancellation!;(changed as unknown as {evm:OperationRecord["evm"]}).evm={...changed.evm!,cleanup85Cancellation:{...body,version:"apn.circle-cleanup85-native-binding.v1"}};await assert.rejects(assertCleanup85NativeSlot(state,changed),/native_lineage_operation_identity/);});

for(const kind of ["original_slot","successor_slot","retirement_proof","orphan_v2","overflow"] as const)test(`readonly absent audit refuses ${kind} without private or network effects`,async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root);await state.initialize();const {op,r}=await syntheticSuccessor(state),records=new Cleanup85NativePublicRecords(temp.root);let keys=0,rpc=0;
 if(kind==="original_slot"||kind==="successor_slot")await records.publish(r.parentOperationId,kind==="original_slot"?"slot":"successor-slot",{});
 else if(kind==="retirement_proof"){await mkdir(join(temp.root,"circle-cleanup85-recovery"),{mode:0o700});await writeFile(join(temp.root,"circle-cleanup85-recovery","4b5fc09e077b6c171083edb6c89ce31b5f8e881e1db4f279a866548aade0aef1-unsigned-retirement.json"),"{}\n",{mode:0o600});}
 else if(kind==="orphan_v2")await state.writeOperation(op);
 else {const directory=join(temp.root,"operations",state.profileHash("evm-live-buyer"));await mkdir(directory,{recursive:true,mode:0o700});for(let index=0;index<257;index++)await writeFile(join(directory,`${index.toString(16).padStart(64,"0")}.json`),"{}\n",{mode:0o600});}
 const service=new Cleanup85NativeCancellation(state,{load:async()=>{keys++;throw Error("private forbidden");},create:async()=>{throw Error("private forbidden");}},{APN_ARBITRUM_RPC_URL:"https://arb1.arbitrum.io/rpc"},{https:{request:async()=>{rpc++;throw Error("network forbidden");}}});if(kind==="overflow")await assert.rejects(service.inspect(r),/absent_roster_overflow/);else await assert.rejects(service.inspect(r));assert.equal(keys,0);assert.equal(rpc,0);
});

for(const kind of ["slot_only","operation_only","original_operation_only","malformed_proof","overflow"] as const)test(`generic native denial protects or refuses missing-original-slot ${kind} orphan`,async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root);await state.initialize();const {op,r}=await syntheticSuccessor(state),records=new Cleanup85NativePublicRecords(temp.root);
 if(kind==="slot_only")await records.publish(r.parentOperationId,"successor-slot",{});
 else if(kind==="operation_only")await state.writeOperation(op);
 else if(kind==="original_operation_only")await state.writeOperation((await captured()).operation);
 else if(kind==="malformed_proof"){await mkdir(join(temp.root,"circle-cleanup85-recovery"),{mode:0o700});await writeFile(join(temp.root,"circle-cleanup85-recovery","4b5fc09e077b6c171083edb6c89ce31b5f8e881e1db4f279a866548aade0aef1-unsigned-retirement.json"),"{}\n",{mode:0o600});}
 else {const directory=join(temp.root,"operations",state.profileHash("evm-live-buyer"));await mkdir(directory,{recursive:true,mode:0o700});for(let index=0;index<257;index++)await writeFile(join(directory,`${index.toString(16).padStart(64,"0")}.json`),"{}\n",{mode:0o600});}
 if(kind==="operation_only"||kind==="original_operation_only")assert.equal((await loadCleanup85NativeReservationIdentity(state))!.nativeReservationId,(kind==="operation_only"?op:(await captured()).operation).evm!.cleanup85Cancellation!.nativeReservationId);else await assert.rejects(loadCleanup85NativeReservationIdentity(state));
});
test("generic native denial complete family absence is existing-only and returns null",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(join(temp.root,"uninitialized"));assert.equal(await loadCleanup85NativeReservationIdentity(state),null);await assert.rejects(readFile(join(state.root,"state.json")));
});

test("orphan denial rejects self-rehashed foreign original namespace instead of losing fixed RID protection",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const state=new StateStore(temp.root);await state.initialize();const {op}=await syntheticSuccessor(state);const {integrityHash:_,...body}=structuredClone(op),binding=body.evm!.cleanup85Cancellation!,request={...binding.request,recoveryBinding:"b".repeat(64)},namespace=`cleanup85-native-successor:${request.recoveryBinding}:${binding.successor!.retirementProofHash}`,originalOperationId=state.operationId("evm-live-buyer",`cleanup85-native:${request.recoveryBinding}`),lineage={originalOperationId,operationId:state.operationId("evm-live-buyer",namespace),namespace,retirementProofHash:binding.successor!.retirementProofHash,readmission:null};
 body.operationId=lineage.operationId;body.idempotencyHash=state.idempotencyHash(namespace);body.requestHash=cleanup85NativeRequestHash(request,lineage);body.evm={...body.evm!,cleanup85Cancellation:{...binding,request,successor:{...binding.successor!,originalOperationId},nativeReservationId:assetUsageReservationId({account:CLEANUP85_OWNER,chain:"eip155:42161",asset:{kind:"native",identifier:null}},`apn.cleanup85-native:${body.operationId}`)}};body.fingerprint=evmDirectFingerprint(body);await state.writeOperation(sealOperation(body));await assert.rejects(loadCleanup85NativeReservationIdentity(state),/reservation_orphan_original_identity/);
});
