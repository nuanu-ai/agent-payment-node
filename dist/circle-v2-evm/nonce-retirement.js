import { isSealedBurnRetirement, assertSealedBurnRetirement } from "./burn-retirement.js";
import { validateCircleNonceRetirementProof } from "./nonce-retirement-proof.js";
import { advanceCircle, circleBlocked, validateCircle } from "./operation-model.js";
import { executeCircleCleanupWithConsent } from "./lifecycle.js";
export function assertCircleNonceRetirementCase(op, now) {
    if (isSealedBurnRetirement(op)) {
        assertSealedBurnRetirement(op);
        if (op.terminal || op.usageFinalized || op.residualAllowanceAtomic !== "40100")
            circleBlocked("sealed_burn_holds_or_allowance_changed");
        return;
    }
    const approval = op.effects[0], burn = op.effects[1];
    if (op.destinationChain !== 143 || op.destinationProfile !== "default" || op.terminal || now < Date.parse(op.expiresAt) ||
        approval.phase !== "unknown" || approval.transactionHash === null || approval.materialHash === null || approval.proof !== null ||
        burn.phase !== "prepared" || burn.transactionHash !== null || burn.materialHash !== null || burn.proof !== null ||
        op.source !== null || op.attestation !== null || op.destination !== null || op.effects.some(x => x.role === "mint") || op.residualAllowanceAtomic !== "0" || op.usageFinalized || op.usage.length !== 5 ||
        !op.transitions.some(x => x.reason === "approval_material_sealed") || op.transitions.some(x => /^(?:approval_submission|burn_)/u.test(x.reason)))
        circleBlocked("exact_expired_unknown_approval_no_burn_required");
}
export async function retireCircleNonce(input, ports, allowFinancialStart = true) {
    let op = validateCircle(input);
    if (op.state === "nonce_retired")
        return op;
    if (!allowFinancialStart && !await ports.retirementClaimed(op))
        return op;
    assertCircleNonceRetirementCase(op, ports.now());
    if (!await ports.retirementClaimed(op))
        await ports.assertOwnerPolicyAndConflicts(op);
    await ports.assertRetirementMaterial(op);
    const intent = await ports.prepareRetirement(op);
    if (op.transitions.length < intent.prefix.length || intent.prefix.some((x, i) => op.transitions[i].snapshotHash !== x))
        circleBlocked("retirement_parent_prefix_changed");
    let effect = op.effects.find(x => x.role === "cleanup");
    if (effect === undefined) {
        const claimed = await ports.retirementClaimed(op);
        effect = { role: "cleanup", phase: claimed ? "unknown" : "prepared", envelope: intent.cleanupEnvelope, transactionHash: null, materialHash: null, proof: null };
        op = advanceCircle(op, { effects: [...op.effects, effect], state: "cleanup_required" }, "nonce_retirement_cleanup_frozen", ports.now());
        await ports.save(op);
    }
    if (effect.envelope.envelopeHash !== intent.cleanupEnvelope.envelopeHash)
        circleBlocked("retirement_envelope_changed");
    if (await ports.retirementClaimed(op))
        op = await observeRetirementCleanup(op, ports);
    else if (effect.phase === "prepared") {
        op = await executeCircleCleanupWithConsent(op, ports);
        op = await observeRetirementCleanup(op, ports);
    }
    // Only the exact cleanup gets observed here. Observing the original approval into confirmed would erase the typed race refusal.
    const cleanup = op.effects.find(x => x.role === "cleanup");
    if (cleanup.phase !== "confirmed" || cleanup.proof?.finalityTag !== "finalized")
        return op;
    const proof = await ports.retirementProof(op, intent);
    if (proof === null)
        return op;
    validateCircleNonceRetirementProof(proof, op);
    const usage = await ports.usage(op, "failed_confirmed_revert");
    const next = advanceCircle(op, { usage, usageFinalized: true, residualAllowanceAtomic: "0", state: "nonce_retired", terminal: true, nonceRetirement: proof }, "finalized_nonce_retirement_unused_holds_closed", ports.now());
    validateCircle(next);
    await ports.save(next);
    return next;
}
async function observeRetirementCleanup(input, ports, allowFinancialStart = true) {
    let op = input, effect = op.effects.find(x => x.role === "cleanup");
    if (effect.phase === "unknown" && effect.transactionHash === null) {
        const material = await ports.loadMaterial(op, effect);
        if (material === null)
            return op;
        effect = { ...effect, transactionHash: material.transactionHash, materialHash: material.materialHash };
        op = advanceCircle(op, { effects: op.effects.map(x => x.role === "cleanup" ? effect : x) }, "nonce_cleanup_material_recovered_observe_only", ports.now());
        await ports.save(op);
    }
    if (effect.transactionHash === null || effect.phase === "confirmed" || effect.phase === "reverted")
        return op;
    const proof = await ports.observeEffect(op, effect);
    if (proof === null || proof.finalityTag !== "finalized" || proof.outcome === "reverted")
        return op;
    effect = { ...effect, phase: "confirmed", proof };
    op = advanceCircle(op, { effects: op.effects.map(x => x.role === "cleanup" ? effect : x) }, "nonce_cleanup_canonical_finalized", ports.now());
    await ports.save(op);
    return op;
}
//# sourceMappingURL=nonce-retirement.js.map