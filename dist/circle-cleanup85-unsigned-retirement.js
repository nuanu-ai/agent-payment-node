import { STATE_VERSION } from "./constants.js";
import { sealReceipt } from "./state-integrity.js";
import { assertHeldCleanup85Scope } from "./circle-cleanup85-financial-scope.js";
import { canonicalJson, hashObject } from "./canonical.js";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
import { Cleanup85NativePublicRecords } from "./circle-cleanup85-native-records.js";
import { cleanup85UnsignedResumeExclusion } from "./circle-cleanup85-unsigned-resume.js";
import { Cleanup85UnsignedRetirementStore, cleanup85UnsignedTerminal, CLEANUP85_UNSIGNED_ORIGINAL, CLEANUP85_UNSIGNED_FINGERPRINT } from "./circle-cleanup85-unsigned-retirement-store.js";
import { CircleRepository } from "./circle-v2-evm/repository.js";
import { CircleNonceRetirementStore } from "./circle-v2-evm/nonce-retirement-store.js";
import { Cleanup85RecoveryStore, cleanup85CancellationRequest, validateCleanup85RecoveryIntent, assertCleanup85Window } from "./circle-v2-evm/cleanup85-recovery-store.js";
import { verifyCleanup85RecoveryAdmission, verifiedCleanup85RecoveryAdmission } from "./circle-v2-evm/cleanup85-recovery-admission.js";
import { CircleUsage } from "./circle-v2-evm/usage.js";
const lineages = new WeakMap();
const admissions = new WeakMap();
const retirements = new WeakMap();
function frozen(value) { const detached = structuredClone(value); const freeze = (v) => { if (v !== null && typeof v === "object") {
    for (const x of Object.values(v))
        freeze(x);
    Object.freeze(v);
} }; freeze(detached); return detached; }
async function context(state, request) {
    const parent = await new CircleRepository(state.root).load(request.parentOperationId);
    if (parent === null)
        cleanup85Blocked("unsigned_retirement_parent");
    const old = new CircleNonceRetirementStore(state.root), intent = await old.intent(parent);
    if (intent === null || !await old.hasClaim(parent, "sign") || await old.hasClaim(parent, "send"))
        cleanup85Blocked("unsigned_retirement_original_claims");
    const store = new Cleanup85RecoveryStore(state.root), frame = await store.load(parent, intent);
    if (frame === null || canonicalJson(cleanup85CancellationRequest(frame)) !== canonicalJson(request))
        cleanup85Blocked("unsigned_retirement_request");
    await store.assertRetainedMaterialHeaders(parent);
    return { parent, intent, frame };
}
export async function resolveCleanup85NativeLineage(state, request) {
    const c = await context(state, request), store = new Cleanup85UnsignedRetirementStore(state.root), p = await store.load();
    const originalNamespace = `cleanup85-native:${request.recoveryBinding}`, originalOperationId = state.operationId("evm-live-buyer", originalNamespace);
    let body = { originalOperationId, operationId: originalOperationId, namespace: originalNamespace, retirementProofHash: null, readmission: null };
    if (p !== null) {
        if (originalOperationId !== CLEANUP85_UNSIGNED_ORIGINAL || canonicalJson(p.original.evm.cleanup85Cancellation.request) !== canonicalJson(request))
            cleanup85Blocked("unsigned_retirement_lineage_request");
        validateCleanup85RecoveryIntent(p.readmission, c.parent, c.intent);
        await store.verifyRetained(state, p);
        const namespace = `cleanup85-native-successor:${request.recoveryBinding}:${p.proofHash}`;
        body = { originalOperationId, operationId: state.operationId("evm-live-buyer", namespace), namespace, retirementProofHash: p.proofHash, readmission: p.readmission };
    }
    const token = Object.freeze({ kind: "verified-cleanup85-native-lineage" });
    lineages.set(token, { state, requestHash: hashObject(request), body: frozen(body) });
    return token;
}
export function verifiedCleanup85NativeLineage(token, state, request) { const v = lineages.get(token); if (v === undefined || v.state !== state || v.requestHash !== hashObject(request))
    cleanup85Blocked("unsigned_retirement_private_lineage_required"); return v.body; }
/** Revalidates the full canonical original public admission and both current policies. No DTO can issue this token. */
export async function verifyCleanup85SuccessorFinancialAdmission(state, source, destination, request, now, scope) {
    const lineage = verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(state, request), state, request);
    if (lineage.readmission === null)
        cleanup85Blocked("unsigned_retirement_successor_required");
    assertHeldCleanup85Scope(scope, state, request, lineage.operationId);
    const publicProof = verifiedCleanup85RecoveryAdmission(await verifyCleanup85RecoveryAdmission(state, source, destination, request), request), usage = new CircleUsage(state, now);
    await usage.withCleanup85HeldPolicyScope(scope, request, lineage.operationId, async () => { await usage.confirm(publicProof.parent, lineage.readmission.policies); assertCleanup85Window(lineage.readmission, now()); const deadline = await usage.authorizationDeadline(publicProof.parent, lineage.readmission.policies); if (deadline !== lineage.readmission.windowEndsAt)
        cleanup85Blocked("unsigned_retirement_policy_window_changed"); });
    assertHeldCleanup85Scope(scope, state, request, lineage.operationId);
    if ((await new CircleRepository(state.root).load(request.parentOperationId))?.integrityHash !== publicProof.parent.integrityHash)
        cleanup85Blocked("unsigned_retirement_parent_changed");
    const token = Object.freeze({ kind: "verified-cleanup85-successor-financial-admission" });
    admissions.set(token, { state, requestHash: hashObject(request), scope, body: frozen({ lineage, readmission: lineage.readmission }) });
    return token;
}
export function verifiedCleanup85SuccessorFinancialAdmission(token, state, request) { const v = admissions.get(token); if (v === undefined || v.state !== state || v.requestHash !== hashObject(request))
    cleanup85Blocked("unsigned_retirement_private_admission_required"); assertHeldCleanup85Scope(v.scope, state, request, v.body.lineage.operationId); return v.body; }
/** A invokes under its complete canonical owner/address/operation and both true policy locks. */
export async function prepareCleanup85UnsignedRetirement(state, source, destination, parent, frame, now, scope) {
    const request = cleanup85CancellationRequest(frame), ctx = await context(state, request);
    if (canonicalJson(ctx.parent) !== canonicalJson(parent) || canonicalJson(ctx.frame) !== canonicalJson(frame))
        cleanup85Blocked("unsigned_retirement_durable_input");
    const originalId = state.operationId("evm-live-buyer", `cleanup85-native:${request.recoveryBinding}`), o = await state.findOperation(originalId), scopeId = o?.state === "failed_before_effect" ? verifiedCleanup85NativeLineage(await resolveCleanup85NativeLineage(state, request), state, request).operationId : originalId;
    assertHeldCleanup85Scope(scope, state, request, scopeId);
    const usage = new CircleUsage(state, now);
    return usage.withCleanup85HeldPolicyScope(scope, request, scopeId, () => prepareRetirementUnderScope(state, source, destination, parent, frame, usage, now));
}
async function prepareRetirementUnderScope(state, source, destination, parent, frame, usage, now) {
    const request = cleanup85CancellationRequest(frame), store = new Cleanup85UnsignedRetirementStore(state.root), existing = await store.load();
    let p = existing;
    if (p === null) {
        const id = await cleanup85UnsignedResumeExclusion(state, parent, now());
        if (id === null)
            return false;
        const o = await state.findOperation(id);
        if (o === null || now() < Date.parse(o.expiresAt))
            return false;
        if (id !== CLEANUP85_UNSIGNED_ORIGINAL || o.fingerprint !== CLEANUP85_UNSIGNED_FINGERPRINT)
            cleanup85Blocked("unsigned_retirement_exact_expired_original");
        const originalPublic = verifiedCleanup85RecoveryAdmission(await verifyCleanup85RecoveryAdmission(state, source, destination, request), request);
        const policies = await usage.retirementPolicies(parent);
        await usage.confirm(parent, policies);
        const windowEndsAt = await usage.authorizationDeadline(parent, policies), capturedAt = new Date(now()).toISOString();
        const { recoveryBinding: _, ...oldBody } = frame, body = { ...oldBody, policies, windowEndsAt, capturedAt, evidence: originalPublic.evidence };
        const oldIntent = await new CircleNonceRetirementStore(state.root).intent(parent);
        if (oldIntent === null)
            cleanup85Blocked("unsigned_retirement_parent_intent");
        const readmission = validateCleanup85RecoveryIntent({ ...body, recoveryBinding: hashObject(body) }, parent, oldIntent);
        const proofBody = { version: "apn.cleanup85-expired-unsigned-retirement.v1", original: o, slot: await new Cleanup85NativePublicRecords(state.root).load(parent.operationId, "slot"), prepared: await store.prepared(o), readmission, retiredAt: capturedAt };
        p = store.validate({ ...proofBody, proofHash: hashObject(proofBody) });
    }
    else {
        await store.verifyRetained(state, p, true);
        await verifyCleanup85RecoveryAdmission(state, source, destination, request);
        const c = await context(state, request);
        validateCleanup85RecoveryIntent(p.readmission, c.parent, c.intent);
        await usage.confirm(parent, p.readmission.policies);
        assertCleanup85Window(p.readmission, now());
    }
    const token = Object.freeze({});
    retirements.set(token, { state, parentHash: parent.integrityHash, proof: frozen(p) });
    const claim = retirements.get(token);
    retirements.delete(token);
    if (claim === undefined || claim.state !== state || (await new CircleRepository(state.root).load(parent.operationId))?.integrityHash !== claim.parentHash)
        cleanup85Blocked("unsigned_retirement_private_certificate");
    await store.verifyRetained(state, claim.proof, true);
    assertCleanup85Window(claim.proof.readmission, now());
    await store.publish(claim.proof); // create-only proof precedes the legitimate terminal append
    const terminal = cleanup85UnsignedTerminal(claim.proof), saved = await state.findOperation(terminal.operationId);
    if (saved?.integrityHash !== terminal.integrityHash) {
        await store.assertAbsence(state, claim.proof.original);
        await state.writeReceipt(terminal.profileHash, sealReceipt({ schemaVersion: STATE_VERSION, operationId: terminal.operationId, state: terminal.state, terminal: true, reason: terminal.reason, proofClass: terminal.proofClass, evm: terminal.evm, amountAtomic: terminal.amountAtomic, createdAt: claim.proof.retiredAt, operationIntegrityHash: terminal.integrityHash }));
        await state.writeOperation(terminal);
    }
    await store.verifyRetained(state, claim.proof);
    return true;
}
//# sourceMappingURL=circle-cleanup85-unsigned-retirement.js.map