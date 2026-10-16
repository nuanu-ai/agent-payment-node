import { types } from "node:util";
import { advanceCircleFundingOperation as advanceCircle, validateCircleFundingOperation as validateCircle } from "./funding-operation.js";
import { hashObject } from "../canonical.js";
import { circleBlocked, circleCorrupt, circleSame } from "./operation-model.js";
import { assertCircleAttestation } from "./protocol.js";
/** Copy data descriptors before validation; callers cannot supply accessors, proxies or changing envelopes. */
function immutableData(value, seen = new Set(), depth = 0) {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "object" || depth > 64 || types.isProxy(value) || seen.has(value))
        circleCorrupt("funding_data_shape");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null)
        circleCorrupt("funding_data_prototype");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    seen.add(value);
    for (const d of Object.values(descriptors))
        if (!("value" in d))
            circleCorrupt("funding_data_accessor");
    let copy;
    if (array) {
        const length = descriptors.length?.value;
        if (!Number.isSafeInteger(length) || length < 0 || Object.keys(descriptors).length !== length + 1)
            circleCorrupt("funding_array_shape");
        copy = Array.from({ length }, (_, i) => { const d = descriptors[String(i)]; if (d === undefined)
            circleCorrupt("funding_array_gap"); return immutableData(d.value, seen, depth + 1); });
    }
    else
        copy = Object.fromEntries(Object.entries(descriptors).map(([key, d]) => { if (!d.enumerable)
            circleCorrupt("funding_data_property"); return [key, immutableData(d.value, seen, depth + 1)]; }));
    seen.delete(value);
    return Object.freeze(copy);
}
export function snapshotCircleFundingOperation(value) { return validateCircle(immutableData(value)); }
export function snapshotCircleFundingEffect(op, value) {
    const candidate = immutableData(value), selected = op.effects.find(e => e.role === candidate?.role);
    if (selected === undefined || !circleSame(selected, candidate))
        circleBlocked("funding_selected_effect_changed");
    return selected;
}
/** Phases whose signed bytes, if any, never crossed the submission fence: resumable with fresh consent (R3). */
const UNSENT_SIGNING = ["signing_started", "sealed"];
const authorities = new WeakMap();
const effectGuards = new WeakMap();
const consentBinding = (op, ports) => hashObject({ context: ports.consentContext?.() ?? null, operationId: op.operationId, fingerprint: op.fingerprint, funding: op.funding, feeQuote: op.feeQuote, source: op.sourceCustody, destination: op.destinationCustody, policies: op.policies });
/** The prompt gets its own answer window; the 60 s execution window starts when the owner's answer returns.
 * Only a source effect that is already signed may be resumed after the preparation window (nothing new is signed after it). */
async function consent(op, role, ports, resumeSignedSource = false) {
    const policyDeadline = await ports.authorizationDeadline(op);
    if (policyDeadline !== null && (!Number.isFinite(Date.parse(policyDeadline)) || new Date(policyDeadline).toISOString() !== policyDeadline))
        circleBlocked("owner_policy_window_invalid");
    const window = Math.min(role === "source" && !(resumeSignedSource && ports.now() >= Date.parse(op.expiresAt)) ? Date.parse(op.expiresAt) : Infinity, policyDeadline === null ? Infinity : Date.parse(policyDeadline));
    const prompt = Math.min(ports.now() + 60_000, window);
    if (ports.now() >= prompt)
        circleBlocked("consent_expired");
    await ports.approve(op, role, new Date(prompt).toISOString());
    if (ports.now() >= prompt)
        circleBlocked("consent_expired_after_tty");
    const deadline = Math.min(ports.now() + 60_000, window);
    const token = () => { };
    authorities.set(token, { ports, binding: consentBinding(op, ports), deadline, envelopes: new Map(op.effects.filter(e => role === "source" ? e.role === "approval" || e.role === "burn" : e.role === role).map(e => [e.role, hashObject(e.envelope)])), claimed: new Set(), active: null, admitted: false });
    return token;
}
async function cancellationConsent(op, ports) {
    const prompt = ports.now() + 60_000, binding = consentBinding(op, ports);
    await ports.approve(op, "cancel", new Date(prompt).toISOString());
    if (ports.now() >= prompt)
        circleBlocked("cancellation_consent_expired");
    const deadline = ports.now() + 60_000;
    const guard = () => { if (ports.now() >= deadline || consentBinding(op, ports) !== binding)
        circleBlocked("cancellation_consent_expired"); };
    guard();
    // This no-effect guard is deliberately absent from authorities: it cannot authorize signing or dispatch.
    return guard;
}
function checkConsent(token, op, ports, effect) {
    const authority = token === undefined ? undefined : authorities.get(token);
    if (authority === undefined || authority.ports !== ports || authority.binding !== consentBinding(op, ports) || ports.now() >= authority.deadline ||
        effect !== undefined && (authority.active !== effect.role || authority.envelopes.get(effect.role) !== hashObject(snapshotCircleFundingEffect(op, effect).envelope)))
        circleBlocked("fresh_exact_effect_consent_required");
    return authority;
}
/** Consent, then the single owner, policy and conflict admission under the run's held profile, operation, address
 * and policy locks (BRDG-11). Nothing between it and signing can change those facts, and the consent deadline already
 * bounds the policy window, so an effect run under this consent does not repeat the admission. */
async function admittedConsent(op, role, ports, resumeSignedSource = false) {
    const token = await consent(op, role, ports, resumeSignedSource);
    await ports.assertOwnerPolicyAndConflicts(op, role === "mint" ? "mint" : undefined);
    checkConsent(token, op, ports).admitted = true;
    return token;
}
async function persist(op, patch, reason, ports) {
    const next = snapshotCircleFundingOperation(advanceCircle(op, patch, reason, ports.now()));
    await ports.save(next);
    return next;
}
const updateEffect = (op, role, patch) => op.effects.map(e => e.role === role ? { ...e, ...patch } : e);
export async function approveCircleFundingSource(input, ports) {
    let op = snapshotCircleFundingOperation(input);
    if (op.terminal)
        return op;
    if (op.effects.some(e => e.role !== "mint" && e.role !== "cleanup" && ["submission_started", "submitted", "unknown"].includes(e.phase)))
        return observeCircleFunding(op, ports);
    if (op.state === "cleanup_required")
        circleBlocked("explicit_cleanup_required");
    if (op.source !== null)
        return observeCircleFunding(op, ports);
    // A signed source effect that never reached its submission fence stays resumable with fresh consent (R3).
    if (op.effects.some(e => e.phase === "signing_started" || e.phase === "sealed")) {
        op = await observeCircleFunding(op, ports);
        if (op.terminal || op.state === "cleanup_required" || op.effects.some(e => (e.role === "approval" || e.role === "burn") && ["submission_started", "submitted", "unknown"].includes(e.phase)))
            return op;
    }
    const resumeSigned = op.effects.some(e => (e.role === "approval" || e.role === "burn") && UNSENT_SIGNING.includes(e.phase));
    if (!resumeSigned && ports.now() >= Date.parse(op.expiresAt))
        circleBlocked("source_preparation_expired");
    await ports.assertOwnerPolicyAndConflicts(op);
    const token = await admittedConsent(op, "source", ports, resumeSigned);
    for (const role of ["approval", "burn"]) {
        const effect = op.effects.find(e => e.role === role);
        if (["confirmed", "reverted"].includes(effect.phase))
            continue;
        if (effect.phase === "prepared" && ports.now() >= Date.parse(op.expiresAt))
            circleBlocked("source_preparation_expired");
        op = await executeCircleFundingEffect(op, role, ports, token);
        op = await observeCircleFunding(op, ports);
        if (op.effects.find(e => e.role === role)?.phase !== "confirmed")
            return op;
    }
    return op;
}
/** Each marker is fsynced before crossing its boundary. Every refusable check runs before signing; after the
 * submission fence the effect is observed only, never signed or broadcast again. A failure before that fence
 * keeps the effect signed-but-unsent and resumable instead of turning it into a permanent unknown. */
export async function executeCircleFundingEffect(input, role, ports, token) {
    let op = snapshotCircleFundingOperation(input), effect = op.effects.find(e => e.role === role);
    if (effect === undefined)
        circleCorrupt("missing_effect");
    if (!["prepared", ...UNSENT_SIGNING].includes(effect.phase))
        return op;
    const authority = checkConsent(token, op, ports);
    if (authority.claimed.has(role) || authority.active !== null || authority.envelopes.get(role) !== hashObject(effect.envelope))
        circleBlocked("consent_effect_reuse_or_mismatch");
    authority.claimed.add(role);
    authority.active = role;
    const guard = () => { checkConsent(token, op, ports, effect); ports.effectAuthorityGuard?.(op); };
    effectGuards.set(guard, { token: token, ports, role });
    try {
        // The owner, policy and conflict admission runs once per consent under the run's held locks; the chain preflight
        // runs once per effect, immediately before signing.
        guard();
        if (!authority.admitted) {
            await ports.assertOwnerPolicyAndConflicts(op, role);
            guard();
        }
        await ports.preflight(op, effect);
        guard();
        if (effect.phase === "prepared") {
            guard();
            op = await persist(op, { effects: updateEffect(op, role, { phase: "signing_started" }), state: role === "mint" ? "mint_unknown" : role === "cleanup" ? "cleanup_required" : "source_unknown" }, `${role}_signing_fence`, ports);
            effect = op.effects.find(e => e.role === role);
            guard();
        }
        if (effect.phase === "signing_started") {
            // Custody returns already-saved material for this exact envelope; its permanent sign claim refuses a second signature.
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
        const phase = op.effects.find(e => e.role === role).phase;
        if (phase === "prepared" || UNSENT_SIGNING.includes(phase))
            throw error;
        await ports.recordEffectFailure?.(op, role, error);
        return await persist(op, { effects: updateEffect(op, role, { phase: "unknown" }) }, `${role}_fenced_unknown_observe_only`, ports);
    }
    finally {
        effectGuards.delete(guard);
        authority.active = null;
    }
}
export async function approveCircleFundingMint(input, ports) {
    let op = await observeCircleFunding(input, ports);
    if (op.terminal)
        return op;
    const existing = op.effects.find(e => e.role === "mint");
    if (existing !== undefined && existing.phase !== "prepared" && !UNSENT_SIGNING.includes(existing.phase))
        return op;
    if (op.source === null || op.attestation === null || op.residualAllowanceAtomic !== "0")
        circleBlocked("verified_source_attestation_and_zero_allowance_required");
    assertCircleAttestation(op.source, op.attestation, op.funding);
    await ports.assertOwnerPolicyAndConflicts(op, "mint");
    if (existing === undefined) {
        const envelope = await ports.mintEnvelope(op);
        op = await persist(op, { effects: [...op.effects, { role: "mint", phase: "prepared", envelope, transactionHash: null, materialHash: null, proof: null }] }, "mint_envelope_frozen", ports);
    }
    const token = await admittedConsent(op, "mint", ports);
    op = await executeCircleFundingEffect(op, "mint", ports, token);
    return observeCircleFunding(op, ports);
}
export async function observeCircleFunding(input, ports) {
    let op = snapshotCircleFundingOperation(input);
    if (op.terminal)
        return op;
    op = await abandonNeverLanding(op, ports);
    if (op.terminal)
        return op;
    let burnJustObserved = null;
    for (const initial of op.effects) {
        let effect = op.effects.find(e => e.role === initial.role);
        if (effect.phase === "signing_started" || effect.phase === "unknown" && effect.transactionHash === null) {
            const material = await ports.loadMaterial(op, effect);
            // Material saved under a signing fence was never broadcast (no submission fence): recover it as resumable sealed bytes.
            if (material !== null)
                op = await persist(op, { effects: updateEffect(op, effect.role, { phase: effect.phase === "signing_started" ? "sealed" : "unknown", transactionHash: material.transactionHash, materialHash: material.materialHash }) }, effect.phase === "signing_started" ? `${effect.role}_material_recovered_unsent` : `${effect.role}_material_recovered_observe_only`, ports);
            effect = op.effects.find(e => e.role === initial.role);
        }
        if (effect.transactionHash === null || ["prepared", "sealed", "abandoned_unsent", "confirmed", "reverted"].includes(effect.phase))
            continue;
        const proof = await ports.observeEffect(op, effect);
        if (proof === null) {
            if (effect.role === "approval" || effect.role === "burn") {
                op = await sentNeverLanded(op, effect.role, ports);
                if (op.terminal)
                    return op;
            }
            continue;
        }
        if (proof.outcome === "reverted") {
            op = await persist(op, { effects: updateEffect(op, effect.role, { phase: "reverted", proof }), state: "cleanup_required" }, `${effect.role}_finalized_revert_requires_explicit_cleanup`, ports);
            continue;
        }
        if (effect.role === "burn")
            burnJustObserved = proof;
        op = await persist(op, { effects: updateEffect(op, effect.role, { phase: "confirmed", proof }),
            ...(effect.role === "approval" ? { residualAllowanceAtomic: op.funding.amountAtomic } : {}) }, `${effect.role}_canonical_receipt`, ports);
    }
    let freshSource = false, freshDestination = false;
    const burn = op.effects.find(e => e.role === "burn");
    if (burn.transactionHash !== null && ["submitted", "unknown", "confirmed", "submission_started"].includes(burn.phase)) {
        // P2: a burn receipt this pass just proved at inclusion is the same included source proof; it is not re-read.
        let source = op.source === null && burnJustObserved !== null ? burnJustObserved : await ports.observeSource(op, op.source !== null);
        // A saved INCLUDED burn remains issuer-eligible while its independent finalized head is pending.
        if (source === null && op.source?.finalityTag === "included")
            source = await ports.observeSource(op, false);
        if (source !== null) {
            freshSource = true;
            if (op.source !== null && (source.transactionHash !== op.source.transactionHash || source.blockHash !== op.source.blockHash || source.receiptHash !== op.source.receiptHash || source.sourceMessageHash !== op.source.sourceMessageHash))
                circleBlocked("source_reorg_holds_required");
            // The allowance at the burn block, from receipts (OWNR-14, P1): the confirmed approval at nonce n set it to exactly the
            // burn amount (its Approval event), and the burn at nonce n+1 moved that amount (its DepositForBurn event). No owner
            // transaction lies between consecutive nonces, so the burn left zero. A later, unrelated approval cannot change that.
            if (op.effects[0].phase !== "confirmed")
                circleBlocked("burn_residual_allowance");
            if (!circleSame(op.source, source) || op.residualAllowanceAtomic !== "0")
                op = await persist(op, { source, residualAllowanceAtomic: "0", effects: updateEffect(op, "burn", { phase: "confirmed", proof: source }), state: op.destination === null ? "awaiting_mint" : "awaiting_finality" }, "source_message_verified", ports);
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
export async function refreshCircleFundingAttestation(input, ports) {
    const op = snapshotCircleFundingOperation(input);
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
export async function cleanupCircleFunding(input, ports) {
    let op = await observeCircleFunding(input, ports);
    if (op.terminal)
        return op;
    const burn = op.effects.find(e => e.role === "burn"), approval = op.effects.find(e => e.role === "approval");
    // An effect whose signing never saved material holds no signed bytes: it is as cancellable as a prepared one.
    if (["prepared", "signing_started"].includes(approval.phase) && ["prepared", "signing_started"].includes(burn.phase) && op.effects.length === 2 && op.source === null) {
        for (const effect of op.effects)
            if (await ports.loadMaterial(op, effect) !== null)
                circleBlocked("unsubmitted_cancel_private_material_present");
        if (await ports.allowance(op) !== "0")
            circleBlocked("unsubmitted_cancel_nonzero_allowance");
        const guard = await cancellationConsent(op, ports);
        guard();
        for (const effect of op.effects)
            if (effect.phase === "signing_started")
                op = await persist(op, { effects: updateEffect(op, effect.role, { phase: "abandoned_unsent" }) }, `${effect.role}_signing_fence_without_bytes_abandoned`, ports);
        guard();
        const usage = await ports.usage(op, "failed_before_effect");
        guard();
        return persist(op, { usage, usageFinalized: true, residualAllowanceAtomic: "0", state: "cancelled_unsubmitted", terminal: true }, "explicit_no_private_entry_cancellation", ports);
    }
    // A signed-but-unsent burn never crossed its submission fence; the approve-zero cleanup takes the same pending nonce, so it can never land after it.
    if (!["prepared", "reverted", "abandoned_unsent", ...UNSENT_SIGNING].includes(burn.phase) || !["confirmed", "reverted"].includes(approval.phase) || op.source !== null)
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
    if (["prepared", ...UNSENT_SIGNING].includes(cleanup.phase)) {
        await ports.assertOwnerPolicyAndConflicts(op);
        const token = await consent(op, "cleanup", ports);
        checkConsent(token, op, ports);
        op = await executeCircleFundingEffect(op, "cleanup", ports, token);
    }
    op = await observeCircleFunding(op, ports);
    cleanup = op.effects.find(e => e.role === "cleanup");
    // The finalized cleanup receipt's Approval event proves the zero it set; a later approval is a different allowance.
    if (cleanup.phase === "confirmed" && cleanup.proof?.finalityTag === "finalized") {
        const usage = await ports.usage(op, "failed_confirmed_revert");
        op = await persist(op, { usage, usageFinalized: true, residualAllowanceAtomic: "0", state: "cleaned", terminal: true }, "explicit_zero_allowance_cleanup_finalized", ports);
    }
    return op;
}
/** Explicit fresh cleanup authority, never source authorization or expiry renewal. */
export async function executeCircleFundingCleanupWithConsent(op, ports) {
    await ports.assertOwnerPolicyAndConflicts(op);
    const token = await consent(op, "cleanup", ports);
    try {
        return await executeCircleFundingEffect(op, "cleanup", ports, token);
    }
    finally {
        authorities.delete(token);
    }
}
/** Production retirement custody accepts only the private controller's currently active exact guard. */
export function assertCircleFundingEffectGuard(input, effectInput, guard) {
    const op = snapshotCircleFundingOperation(input), effect = snapshotCircleFundingEffect(op, effectInput);
    const record = effectGuards.get(guard);
    if (record === undefined || record.role !== effect.role)
        circleBlocked("private_exact_effect_guard_required");
    checkConsent(record.token, op, record.ports, effect);
    guard();
}
/** R4: a signed source effect that never crossed its submission fence, whose nonce another transaction consumed at
 * safe depth while its own hash stays unknown, can never land. Its bytes are discarded. A never-landing approval
 * ends the route as never sent and releases every hold; a never-landing burn leaves the confirmed approval to the
 * explicit approve-zero cleanup. Bytes the node already knows are fenced as possibly sent and only observed. A nonce
 * not yet consumed keeps the effect resumable. */
async function abandonNeverLanding(input, ports) {
    let op = input;
    if (op.terminal || op.source !== null || ports.unsent === undefined)
        return op;
    for (const role of ["approval", "burn"]) {
        let effect = op.effects.find(e => e.role === role);
        const outcome = effect.phase === "sealed" ? await ports.unsent.outcome(op, effect) : null;
        if (outcome === "never_lands")
            op = await persist(op, { effects: updateEffect(op, role, { phase: "abandoned_unsent" }) }, `${role}_signed_bytes_never_land`, ports);
        // The node already knows these exact bytes: never send them again; fence them as possibly sent and only observe.
        if (outcome === "own_transaction_known")
            op = await persist(op, { usage: await ports.usage(op, "unknown_finality"), effects: updateEffect(op, role, { phase: "submission_started" }) }, `${role}_signed_bytes_known_on_chain_observe_only`, ports);
        effect = op.effects.find(e => e.role === role);
        if (effect.phase !== "abandoned_unsent")
            continue;
        if (effect.materialHash !== null)
            await ports.unsent.discard(op, effect);
        if (role === "approval") {
            const usage = await ports.usage(op, "failed_before_effect");
            return persist(op, { usage, usageFinalized: true, residualAllowanceAtomic: "0", state: "cancelled_unsubmitted", terminal: true }, "approval_never_landed_holds_released", ports);
        }
        if (op.state !== "cleanup_required")
            op = await persist(op, { state: "cleanup_required" }, "burn_never_landed_explicit_cleanup_required", ports);
    }
    return op;
}
/** R4 for an ambiguous send: an approval or burn whose bytes may have been broadcast (submission fence crossed) and which
 * no receipt proves. When another transaction consumed its nonce at safe depth and the node knows neither its
 * transaction nor a receipt, it can never land: the approval ends the route (every hold released, nothing counted),
 * the burn leaves the confirmed approval to the explicit approve-zero cleanup. A known hash keeps observing; an
 * unconsumed nonce keeps the effect as it is. */
async function sentNeverLanded(input, role, ports) {
    let op = input;
    const effect = op.effects.find(e => e.role === role);
    if (op.terminal || op.source !== null || ports.unsent?.sentOutcome === undefined || effect.transactionHash === null ||
        !["submission_started", "submitted", "unknown"].includes(effect.phase) || await ports.unsent.sentOutcome(op, effect) !== "never_lands")
        return op;
    op = await persist(op, { effects: updateEffect(op, role, { phase: "abandoned_unsent" }) }, `${role}_sent_bytes_never_land`, ports);
    if (effect.materialHash !== null)
        await ports.unsent.discard(op, op.effects.find(e => e.role === role));
    if (role === "burn")
        return op.state === "cleanup_required" ? op : persist(op, { state: "cleanup_required" }, "burn_never_landed_explicit_cleanup_required", ports);
    // The submission fence exposed every hold (`unknown_finality`); released, not counted, is the ledger's terminal for them.
    const usage = await ports.usage(op, "released_unsubmitted");
    return persist(op, { usage, usageFinalized: true, residualAllowanceAtomic: "0", state: "cancelled_unsubmitted", terminal: true }, "approval_never_landed_holds_released", ports);
}
//# sourceMappingURL=funding-lifecycle.js.map