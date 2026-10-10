import { canonicalJson, hashObject } from "./canonical.js";
import { cleanup85OperationEnvelope } from "./circle-cleanup85-native-binding.js";
import { assetUsageReservationId } from "./asset-usage-ledger-record.js";
import { CLEANUP85_OWNER, cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
import { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage } from "./circle-cleanup85-unsigned-retirement.js";
/** Only the source-owned private resolver can select the one immutable lineage. */
export async function cleanup85NativeLineage(state, request) {
    return verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(state, request), state, request);
}
export function cleanup85NativeSlotKind(lineage) { return lineage.retirementProofHash === null ? "slot" : "successor-slot"; }
export function cleanup85NativeRequestHash(request, lineage) {
    return lineage.retirementProofHash === null ? hashObject({ method: "apn.cleanup85-native.v1", request }) : hashObject({ method: "apn.cleanup85-native-successor.v1", request, retirementProofHash: lineage.retirementProofHash });
}
export function cleanup85NativeSlotBody(o, lineage) {
    const b = o.evm?.cleanup85Cancellation;
    if (b === undefined)
        cleanup85Blocked("lineage_native_binding");
    const original = { version: "apn.cleanup85-single-cancellation.v1", parentOperationId: b.request.parentOperationId, oldCleanupMaterialHash: b.request.oldCleanupMaterialHash, requestBinding: hashObject(b.request), operationId: o.operationId, fingerprint: o.fingerprint };
    return lineage.retirementProofHash === null ? original : { ...original, version: "apn.cleanup85-successor-cancellation.v1", originalOperationId: lineage.originalOperationId, retirementProofHash: lineage.retirementProofHash };
}
/** Pure comparison is not a grant; callers first resolve private durable lineage. */
export function assertCleanup85NativeLineageOperation(state, o, lineage) {
    cleanup85OperationEnvelope(o);
    const b = o.evm.cleanup85Cancellation;
    if (b.nativeReservationId !== assetUsageReservationId({ account: CLEANUP85_OWNER, chain: "eip155:42161", asset: { kind: "native", identifier: null } }, `apn.cleanup85-native:${o.operationId}`))
        cleanup85Blocked("native_lineage_reservation_identity");
    if (o.operationId !== lineage.operationId || o.operationId !== state.operationId("evm-live-buyer", lineage.namespace) || o.idempotencyHash !== state.idempotencyHash(lineage.namespace) || o.requestHash !== cleanup85NativeRequestHash(b.request, lineage))
        cleanup85Blocked("native_lineage_operation_identity");
    if (lineage.retirementProofHash === null) {
        if (b.version !== "apn.circle-cleanup85-native-binding.v1" || b.successor !== undefined)
            cleanup85Blocked("original_lineage_binding");
    }
    else if (b.version !== "apn.circle-cleanup85-native-binding.v2" || canonicalJson(b.successor) !== canonicalJson({ originalOperationId: lineage.originalOperationId, retirementProofHash: lineage.retirementProofHash }))
        cleanup85Blocked("successor_lineage_binding");
}
//# sourceMappingURL=circle-cleanup85-native-lineage.js.map