import { canonicalJson } from "./canonical.js";
import { SecureStateStore } from "./secure-state-store.js";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
export class Cleanup85NativePublicRecords extends SecureStateStore {
  async load(id: string, kind: "material" | "proof" | "slot" | "failure" | "canonical"): Promise<unknown> { if(!/^[a-f0-9]{64}$/u.test(id))cleanup85Blocked("public_record_id");return this.readJson(`circle-cleanup85-native/${id}-${kind}.json`); }
  async publish(id: string, kind: "material" | "proof" | "slot" | "failure" | "canonical", body: unknown): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(id)) cleanup85Blocked("public_record_id");
    const old = await this.load(id,kind);
    if (old !== null) { if (canonicalJson(old) !== canonicalJson(body)) cleanup85Blocked("public_record_replacement"); return; }
    await this.initialize(); await this.ensureDirectory("circle-cleanup85-native"); await this.writeJson(`circle-cleanup85-native/${id}-${kind}.json`,body,true);
  }
}
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { CLEANUP85_REQUEST } from "./circle-cleanup85-native-codec.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import type { StateStore } from "./state.js";
/** Public deny/reconciliation lookup only. It never grants reservation, settlement or dispatch.
 * The one fixed create-only slot permits exact lookup without profile scans or chain requests. */
export async function loadCleanup85NativeReservationIdentity(state:StateStore):Promise<{readonly operationId:string;readonly fingerprint:string;readonly nativeReservationId:string}|null>{
 const slot=await new Cleanup85NativePublicRecords(state.root).load(CLEANUP85_REQUEST.parentOperationId,"slot");if(slot===null)return null;
 if(!isPlainRecord(slot)||!exactKeys(slot,["version","parentOperationId","oldCleanupMaterialHash","requestBinding","operationId","fingerprint"])||slot.version!=="apn.cleanup85-single-cancellation.v1"||slot.parentOperationId!==CLEANUP85_REQUEST.parentOperationId||slot.oldCleanupMaterialHash!==CLEANUP85_REQUEST.oldCleanupMaterialHash||![slot.requestBinding,slot.operationId,slot.fingerprint].every(x=>typeof x==="string"&&/^[a-f0-9]{64}$/u.test(x)))cleanup85Blocked("reservation_slot_public_binding");
 const operationId=slot.operationId as string,o=await state.findOperation(operationId);if(o===null||o.fingerprint!==slot.fingerprint)cleanup85Blocked("reservation_slot_durable_operation");
 cleanup85OperationEnvelope(o);const b=o.evm!.cleanup85Cancellation!;
 if(hashObject(b.request)!==slot.requestBinding||operationId!==state.operationId("evm-live-buyer",`cleanup85-native:${b.request.recoveryBinding}`)||o.requestHash!==hashObject({method:"apn.cleanup85-native.v1",request:b.request}))cleanup85Blocked("reservation_slot_request_identity");
 return Object.freeze({operationId,fingerprint:o.fingerprint,nativeReservationId:b.nativeReservationId});
}
