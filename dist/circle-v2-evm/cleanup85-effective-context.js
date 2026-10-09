import { canonicalJson, hashObject } from "../canonical.js";
import { resolveCleanup85NativeLineage, verifiedCleanup85NativeLineage } from "../circle-cleanup85-unsigned-retirement.js";
import { CircleRepository } from "./repository.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest } from "./cleanup85-recovery-store.js";
import { circleBlocked } from "./operation-model.js";
const contexts = new WeakMap();
export async function verifyCleanup86RecoveryContext(state, op, original) {
    const saved = await new CircleRepository(state.root).load(op.operationId);
    if (saved === null || canonicalJson(saved) !== canonicalJson(op))
        circleBlocked("cleanup86_context_durable_parent");
    const parent = await new CircleNonceRetirementStore(state.root).intent(saved);
    if (parent === null)
        circleBlocked("cleanup86_context_original_intent");
    const frame = await new Cleanup85RecoveryStore(state.root).load(saved, parent);
    if (frame === null || canonicalJson(frame) !== canonicalJson(original))
        circleBlocked("cleanup86_context_frozen_original");
    const request = cleanup85CancellationRequest(frame), lineage = verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(state, request), state, request), readmission = lineage.readmission ?? frame;
    const body = { original: frame, readmission, retirementProofHash: lineage.retirementProofHash, readmissionHash: hashObject(readmission) };
    const retained = structuredClone(body), freeze = (v) => { if (v !== null && typeof v === "object") {
        for (const x of Object.values(v))
            freeze(x);
        Object.freeze(v);
    } };
    freeze(retained);
    const token = Object.freeze({ kind: "verified-cleanup86-recovery-context" });
    contexts.set(token, { state, parentHash: op.integrityHash, originalHash: hashObject(original), body: retained });
    return token;
}
export function verifiedCleanup86RecoveryContext(token, state, op, original) {
    const value = contexts.get(token);
    if (value === undefined || value.state !== state || value.parentHash !== op.integrityHash || value.originalHash !== hashObject(original))
        circleBlocked("cleanup86_private_recovery_context_required");
    return value.body;
}
//# sourceMappingURL=cleanup85-effective-context.js.map