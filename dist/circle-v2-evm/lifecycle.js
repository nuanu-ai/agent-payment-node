import { hashObject } from "../canonical.js";
import { advanceCircle, circleBlocked, circleCorrupt, circleSame, validateCircle } from "./operation-model.js";
import { assertCircleAttestation } from "./protocol.js";
const authorities = new WeakMap();
const effectGuards = new WeakMap();
const consentBinding = (op) => hashObject({ operationId: op.operationId, fingerprint: op.fingerprint, source: op.sourceCustody, destination: op.destinationCustody, policies: op.policies });
async function consent(op, role, ports) {
    const policyDeadline = await ports.authorizationDeadline(op);
    if (policyDeadline !== null && (!Number.isFinite(Date.parse(policyDeadline)) || new Date(policyDeadline).toISOString() !== policyDeadline))
        circleBlocked("owner_policy_window_invalid");
    const deadline = Math.min(ports.now() + 60_000, role === "source" ? Date.parse(op.expiresAt) : Infinity, policyDeadline === null ? Infinity : Date.parse(policyDeadline));
    if (ports.now() >= deadline)
        circleBlocked("consent_expired");
    await ports.approve(op, role, new Date(deadline).toISOString());
    if (ports.now() >= deadline)
        circleBlocked("consent_expired_after_tty");
    const token = () => { };
    authorities.set(token, { ports, binding: consentBinding(op), deadline, envelopes: new Map(op.effects.filter(e => role === "source" ? e.role === "approval" || e.role === "burn" : e.role === role).map(e => [e.role, e.envelope.envelopeHash])), claimed: new Set(), active: null });
    return token;
}
async function cancellationConsent(op, ports) {
    const deadline = ports.now() + 60_000, binding = consentBinding(op);
    const guard = () => { if (ports.now() >= deadline || consentBinding(op) !== binding)
        circleBlocked("cancellation_consent_expired"); };
    await ports.approve(op, "cancel", new Date(deadline).toISOString());
    guard();
    // This no-effect guard is deliberately absent from authorities: it cannot authorize signing or dispatch.
    return guard;
}
function checkConsent(token, op, ports, effect) {
    const authority = token === undefined ? undefined : authorities.get(token);
    if (authority === undefined || authority.ports !== ports || authority.binding !== consentBinding(op) || ports.now() >= authority.deadline ||
        effect !== undefined && (authority.active !== effect.role || authority.envelopes.get(effect.role) !== effect.envelope.envelopeHash))
        circleBlocked("fresh_exact_effect_consent_required");
    return authority;
}
async function persist(op, patch, reason, ports) {
    const next = advanceCircle(op, patch, reason, ports.now());
    validateCircle(next);
    await ports.save(next);
    return next;
}
const updateEffect = (op, role, patch) => op.effects.map(e => e.role === role ? { ...e, ...patch } : e);
export async function approveCircleSource(input, ports) {
    let op = validateCircle(input);
    if (op.terminal)
        return op;
    if (op.effects.some(e => e.role !== "mint" && e.role !== "cleanup" && ["signing_started", "submission_started", "submitted", "unknown"].includes(e.phase)))
        return observeCircle(op, ports);
    if (op.state === "cleanup_required")
        circleBlocked("explicit_cleanup_required");
    if (op.source !== null)
        return observeCircle(op, ports);
    if (ports.now() >= Date.parse(op.expiresAt))
        circleBlocked("source_preparation_expired");
    await ports.assertOwnerPolicyAndConflicts(op);
    const token = await consent(op, "source", ports);
    await ports.assertOwnerPolicyAndConflicts(op);
    checkConsent(token, op, ports);
    for (const role of ["approval", "burn"]) {
        const effect = op.effects.find(e => e.role === role);
        if (["confirmed", "reverted"].includes(effect.phase))
            continue;
        op = await executeCircleEffect(op, role, ports, token);
        op = await observeCircle(op, ports);
        if (op.effects.find(e => e.role === role)?.phase !== "confirmed")
            return op;
    }
    return op;
}
/** Each marker is fsynced before crossing its boundary. Marked recovery never enters signing or broadcast again. */
export async function executeCircleEffect(input, role, ports, token) {
    let op = input, effect = op.effects.find(e => e.role === role);
    if (effect === undefined)
        circleCorrupt("missing_effect");
    if (!["prepared", "sealed"].includes(effect.phase))
        return op;
    const authority = checkConsent(token, op, ports);
    if (authority.claimed.has(role) || authority.active !== null || authority.envelopes.get(role) !== effect.envelope.envelopeHash)
        circleBlocked("consent_effect_reuse_or_mismatch");
    authority.claimed.add(role);
    authority.active = role;
    const guard = () => { checkConsent(token, op, ports, effect); };
    effectGuards.set(guard, { token: token, ports, role });
    try {
        guard();
        await ports.assertOwnerPolicyAndConflicts(op, role);
        guard();
        await ports.preflight(op, effect);
        guard();
        if (effect.phase === "prepared") {
            guard();
            op = await persist(op, { effects: updateEffect(op, role, { phase: "signing_started" }), state: role === "mint" ? "mint_unknown" : role === "cleanup" ? "cleanup_required" : "source_unknown" }, `${role}_signing_fence`, ports);
            effect = op.effects.find(e => e.role === role);
            guard();
            const material = await ports.seal(op, effect, guard);
            guard();
            op = await persist(op, { effects: updateEffect(op, role, { phase: "sealed", transactionHash: material.transactionHash, materialHash: material.materialHash }) }, `${role}_material_sealed`, ports);
        }
        effect = op.effects.find(e => e.role === role);
        guard();
        const material = await ports.loadMaterial(op, effect);
        guard();
        if (material === null)
            circleCorrupt("sealed_material_missing");
        await ports.assertOwnerPolicyAndConflicts(op, role);
        guard();
        await ports.preflight(op, effect);
        guard();
        const usage = await ports.usage(op, "unknown_finality");
        guard();
        op = await persist(op, { usage, effects: updateEffect(op, role, { phase: "submission_started" }) }, `${role}_submission_fence`, ports);
        effect = op.effects.find(e => e.role === role);
        guard();
        const returned = await ports.broadcast(effect, material.rawTransaction, guard);
        guard();
        if (returned !== effect.transactionHash)
            throw new Error("transaction hash mismatch");
        return await persist(op, { effects: updateEffect(op, role, { phase: "submitted" }) }, `${role}_submitted_once`, ports);
    }
    catch (error) {
        if (op.effects.find(e => e.role === role).phase === "prepared")
            throw error;
        return await persist(op, { effects: updateEffect(op, role, { phase: "unknown" }) }, `${role}_fenced_unknown_observe_only`, ports);
    }
    finally {
        effectGuards.delete(guard);
        authority.active = null;
    }
}
export async function approveCircleMint(input, ports) {
    let op = await observeCircle(input, ports);
    if (op.terminal)
        return op;
    const existing = op.effects.find(e => e.role === "mint");
    if (existing !== undefined && existing.phase !== "prepared" && existing.phase !== "sealed")
        return op;
    if (op.source === null || op.attestation === null || op.residualAllowanceAtomic !== "0")
        circleBlocked("verified_source_attestation_and_zero_allowance_required");
    assertCircleAttestation(op.source, op.attestation);
    await ports.assertOwnerPolicyAndConflicts(op, "mint");
    if (existing === undefined) {
        const envelope = await ports.mintEnvelope(op);
        op = await persist(op, { effects: [...op.effects, { role: "mint", phase: "prepared", envelope, transactionHash: null, materialHash: null, proof: null }] }, "mint_envelope_frozen", ports);
    }
    const token = await consent(op, "mint", ports);
    await ports.assertOwnerPolicyAndConflicts(op, "mint");
    checkConsent(token, op, ports);
    op = await executeCircleEffect(op, "mint", ports, token);
    return observeCircle(op, ports);
}
export async function observeCircle(input, ports) {
    let op = validateCircle(input);
    if (op.terminal)
        return op;
    for (const initial of op.effects) {
        let effect = op.effects.find(e => e.role === initial.role);
        if (effect.phase === "signing_started" || effect.phase === "unknown" && effect.transactionHash === null) {
            const material = await ports.loadMaterial(op, effect);
            if (material !== null)
                op = await persist(op, { effects: updateEffect(op, effect.role, { phase: "unknown", transactionHash: material.transactionHash, materialHash: material.materialHash }) }, `${effect.role}_material_recovered_observe_only`, ports);
            effect = op.effects.find(e => e.role === initial.role);
        }
        if (effect.transactionHash === null || effect.phase === "prepared" || effect.phase === "sealed" || ["confirmed", "reverted"].includes(effect.phase))
            continue;
        const proof = await ports.observeEffect(op, effect);
        if (proof === null)
            continue;
        if (proof.outcome === "reverted") {
            op = await persist(op, { effects: updateEffect(op, effect.role, { phase: "reverted", proof }), state: "cleanup_required" }, `${effect.role}_finalized_revert_requires_explicit_cleanup`, ports);
            continue;
        }
        op = await persist(op, { effects: updateEffect(op, effect.role, { phase: "confirmed", proof }),
            ...(effect.role === "approval" ? { residualAllowanceAtomic: "40100" } : {}) }, `${effect.role}_canonical_receipt`, ports);
    }
    let freshSource = false, freshDestination = false;
    const burn = op.effects.find(e => e.role === "burn");
    if (burn.transactionHash !== null && ["submitted", "unknown", "confirmed", "submission_started"].includes(burn.phase)) {
        let source = await ports.observeSource(op, op.source !== null);
        // A saved INCLUDED burn remains issuer-eligible while its independent finalized head is pending.
        if (source === null && op.source?.finalityTag === "included")
            source = await ports.observeSource(op, false);
        if (source !== null) {
            freshSource = true;
            if (op.source !== null && (source.transactionHash !== op.source.transactionHash || source.blockHash !== op.source.blockHash || source.receiptHash !== op.source.receiptHash || source.sourceMessageHash !== op.source.sourceMessageHash))
                circleBlocked("source_reorg_holds_required");
            const allowance = await ports.allowance(op);
            if (allowance !== "0")
                circleBlocked("burn_residual_allowance");
            if (!circleSame(op.source, source) || op.residualAllowanceAtomic !== "0")
                op = await persist(op, { source, residualAllowanceAtomic: "0", effects: updateEffect(op, "burn", { phase: "confirmed", proof: source }), state: "awaiting_mint" }, "source_message_verified", ports);
            if (op.attestation === null) {
                const attestation = await ports.attestation(op);
                if (attestation !== null)
                    op = await persist(op, { attestation }, "issuer_attestation_verified", ports);
            }
        }
    }
    if (op.source !== null && op.attestation !== null && op.effects.some(e => e.role === "mint" && e.transactionHash !== null)) {
        const destination = await ports.observeDestination(op);
        if (destination !== null) {
            if (op.destination !== null && (destination.blockHash !== op.destination.blockHash || destination.receiptHash !== op.destination.receiptHash || destination.transactionHash !== op.destination.transactionHash))
                circleBlocked("destination_reorg_holds_required");
            freshDestination = true;
        }
        if (destination !== null && op.destination === null)
            op = await persist(op, { destination, state: "awaiting_finality", effects: updateEffect(op, "mint", { phase: "confirmed", proof: destination }) }, "canonical_destination_mint", ports);
    }
    if (freshSource && freshDestination && op.source?.finalityTag === "finalized" && op.destination?.finalityTag === "safe" && op.residualAllowanceAtomic === "0") {
        const usage = await ports.usage(op, "finalized");
        op = await persist(op, { usage, usageFinalized: true, state: "completed", terminal: true }, "independent_finality_and_usage_closed", ports);
    }
    return op;
}
export async function refreshCircleAttestation(input, ports) {
    const op = validateCircle(input);
    if (op.source === null || op.attestation === null || op.effects.some(e => e.role === "mint" && e.phase !== "prepared"))
        circleBlocked("refresh_requires_same_unminted_burn");
    const attestation = await ports.attestation(op);
    if (attestation === null)
        return op;
    if (attestation.nonce !== op.attestation.nonce || attestation.sourceMessageHash !== op.attestation.sourceMessageHash)
        circleBlocked("refresh_nonce_or_burn_changed");
    if (circleSame(attestation, op.attestation))
        return op;
    const effects = op.effects.some(e => e.role === "mint") ? updateEffect(op, "mint", { envelope: await ports.mintEnvelope({ ...op, attestation }) }) : op.effects;
    return persist(op, { attestation, effects }, "same_burn_attestation_refreshed_read_only", ports);
}
export async function cleanupCircle(input, ports) {
    let op = await observeCircle(input, ports);
    if (op.terminal)
        return op;
    const burn = op.effects.find(e => e.role === "burn"), approval = op.effects.find(e => e.role === "approval");
    if (approval.phase === "prepared" && burn.phase === "prepared" && op.effects.length === 2 && op.source === null) {
        for (const effect of op.effects)
            if (await ports.loadMaterial(op, effect) !== null)
                circleBlocked("unsubmitted_cancel_private_material_present");
        if (await ports.allowance(op) !== "0")
            circleBlocked("unsubmitted_cancel_nonzero_allowance");
        const guard = await cancellationConsent(op, ports);
        guard();
        const usage = await ports.usage(op, "failed_before_effect");
        guard();
        return persist(op, { usage, usageFinalized: true, residualAllowanceAtomic: "0", state: "cancelled_unsubmitted", terminal: true }, "explicit_no_private_entry_cancellation", ports);
    }
    if (!["prepared", "reverted"].includes(burn.phase) || !["confirmed", "reverted"].includes(approval.phase) || op.source !== null)
        circleBlocked("cleanup_requires_confirmed_approval_and_no_burn_attempt");
    if (approval.phase === "reverted" && await ports.allowance(op) === "0") {
        const token = await consent(op, "cleanup", ports);
        checkConsent(token, op, ports);
        return persist(op, { usage: await ports.usage(op, "failed_confirmed_revert"), usageFinalized: true, residualAllowanceAtomic: "0", state: "cleaned", terminal: true }, "confirmed_revert_zero_allowance_recovery", ports);
    }
    let cleanup = op.effects.find(e => e.role === "cleanup");
    if (cleanup === undefined) {
        const envelope = await ports.cleanupEnvelope(op);
        op = await persist(op, { state: "cleanup_required", effects: [...op.effects, { role: "cleanup", phase: "prepared", envelope, transactionHash: null, materialHash: null, proof: null }] }, "cleanup_envelope_frozen", ports);
    }
    cleanup = op.effects.find(e => e.role === "cleanup");
    if (["prepared", "sealed"].includes(cleanup.phase)) {
        await ports.assertOwnerPolicyAndConflicts(op);
        const token = await consent(op, "cleanup", ports);
        checkConsent(token, op, ports);
        op = await executeCircleEffect(op, "cleanup", ports, token);
    }
    op = await observeCircle(op, ports);
    cleanup = op.effects.find(e => e.role === "cleanup");
    if (cleanup.phase === "confirmed" && cleanup.proof?.finalityTag === "finalized" && await ports.allowance(op) === "0") {
        const usage = await ports.usage(op, "failed_confirmed_revert");
        op = await persist(op, { usage, usageFinalized: true, residualAllowanceAtomic: "0", state: "cleaned", terminal: true }, "explicit_zero_allowance_cleanup_finalized", ports);
    }
    return op;
}
/** Explicit fresh cleanup authority, never source authorization or expiry renewal. */
export async function executeCircleCleanupWithConsent(op, ports) {
    await ports.assertOwnerPolicyAndConflicts(op);
    const token = await consent(op, "cleanup", ports);
    try {
        return await executeCircleEffect(op, "cleanup", ports, token);
    }
    finally {
        authorities.delete(token);
    }
}
/** Production retirement custody accepts only the private controller's currently active exact guard. */
export function assertCircleEffectGuard(op, effect, guard) {
    const record = effectGuards.get(guard);
    if (record === undefined || record.role !== effect.role)
        circleBlocked("private_exact_effect_guard_required");
    checkConsent(record.token, op, record.ports, effect);
    guard();
}
//# sourceMappingURL=lifecycle.js.map