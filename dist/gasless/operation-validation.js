import { hashObject } from "../canonical.js";
import { validateGaslessMutable } from "./effect-validation.js";
import { validateGaslessIntent } from "./intent-validation.js";
import { GASLESS_TERMINAL, gaslessIntentBinding, gaslessSnapshot, newGaslessEffect } from "./operation-model.js";
import { operationSchema } from "./schema.js";
import { assertGaslessSettlementContinuation } from "./settlement-validation.js";
import { gaslessFailure, gaslessSame } from "./validation.js";
const EDGES = {
    awaiting_approval: ["execution_pending", "failed_before_effect"],
    execution_pending: ["bootstrap_pending", "failed_before_effect", "unknown_finality"],
    bootstrap_pending: ["user_operation_pending", "unknown_finality", "failed_permissions_invalidated", "failed_before_effect"],
    user_operation_pending: ["submitted_pending", "unknown_finality", "included_success", "included_revert", "failed_effects_pending", "completed", "failed_confirmed_revert", "failed_permissions_invalidated"],
    submitted_pending: ["unknown_finality", "included_success", "included_revert", "failed_effects_pending", "completed", "failed_confirmed_revert", "failed_permissions_invalidated", "abandoned_unknown"],
    included_success: ["unknown_finality", "completed"],
    included_revert: ["unknown_finality", "failed_effects_pending", "failed_confirmed_revert"],
    unknown_finality: ["bootstrap_pending", "user_operation_pending", "submitted_pending", "included_success", "included_revert", "failed_effects_pending", "completed", "failed_confirmed_revert", "failed_permissions_invalidated", "failed_before_effect", "abandoned_unknown"],
    failed_effects_pending: ["failed_confirmed_revert"],
    completed: [], failed_before_effect: [], failed_confirmed_revert: [], failed_permissions_invalidated: [], abandoned_unknown: [],
};
const PHASE_EDGES = {
    unsealed: ["signing_started"], signing_started: ["sealed", "unknown_finality"],
    sealed: ["disclosure_started", "submitting", "unknown_finality"],
    disclosure_started: ["checked", "unknown_finality"], checked: [],
    submitting: ["submitted_pending", "unknown_finality", "included_success", "included_revert", "safe_success", "safe_revert"],
    submitted_pending: ["unknown_finality", "included_success", "included_revert", "safe_success", "safe_revert"],
    unknown_finality: ["sealed", "included_success", "included_revert", "safe_success", "safe_revert"],
    included_success: ["unknown_finality", "safe_success"], included_revert: ["unknown_finality", "safe_revert"],
    safe_success: [], safe_revert: [],
};
export function gaslessCorrupt() { return gaslessFailure("APN_STATE_CORRUPT", "gasless_durable_binding"); }
export function validateGaslessOperation(value) {
    if (!operationSchema.safeParse(value).success)
        gaslessCorrupt();
    const op = value, { integrityHash, ...body } = op;
    if (integrityHash !== hashObject(body) || op.fingerprint !== hashObject(gaslessIntentBinding(op)))
        gaslessCorrupt();
    try {
        validateGaslessIntent(op.intent);
    }
    catch {
        gaslessCorrupt();
    }
    if (op.profileHash !== op.intent.owner.profileHash || op.createdAt !== op.intent.preparedAt ||
        op.requestHash !== hashObject({ profile: op.intent.profile, request: op.intent.request }))
        gaslessCorrupt();
    let previous;
    for (const entry of op.transitions) {
        const { transitionHash, ...entryBody } = entry;
        if (hashObject(entryBody) !== transitionHash || entry.previousHash !== (previous?.transitionHash ?? op.fingerprint))
            gaslessCorrupt();
        if (previous === undefined) {
            if (entry.state !== "awaiting_approval" || entry.at !== op.createdAt || entry.approval !== null ||
                !gaslessSame(entry.bootstrap, newGaslessEffect("bootstrap")) || !gaslessSame(entry.userOperation, newGaslessEffect("user_operation")) ||
                entry.observation !== null || entry.settlement !== null || entry.failure !== null || !gaslessSame(entry.cursor, { startBlock: op.intent.initialSnapshot.block, nextBlockAtomic: op.intent.initialSnapshot.block.numberAtomic, previousEndBlock: null }))
                gaslessCorrupt();
        }
        else
            validateTransition(previous, entry);
        try {
            validateGaslessMutable(op, entry, entry.at);
        }
        catch {
            gaslessCorrupt();
        }
        previous = entry;
    }
    if (previous === undefined || previous.at !== op.updatedAt || op.terminal !== GASLESS_TERMINAL.includes(op.state))
        gaslessCorrupt();
    const { at: _at, previousHash: _previous, transitionHash: _transition, ...last } = previous;
    if (!gaslessSame(last, gaslessSnapshot(op)))
        gaslessCorrupt();
    return op;
}
function validateTransition(p, n) {
    if (GASLESS_TERMINAL.includes(p.state) || (p.state !== n.state && !EDGES[p.state].includes(n.state)) || n.at < p.at)
        gaslessCorrupt();
    if (p.approval !== null && !gaslessSame(p.approval, n.approval))
        gaslessCorrupt();
    validateEffectStep(p.bootstrap, n.bootstrap);
    validateEffectStep(p.userOperation, n.userOperation);
    if (p.settlement !== null && !gaslessSame(p.settlement, n.settlement))
        gaslessCorrupt();
    const proven = p.observation?.settlement;
    if (proven !== null && proven !== undefined) {
        const next = n.observation?.settlement;
        if (next === null || next === undefined)
            gaslessCorrupt();
        assertGaslessSettlementContinuation(proven, next);
    }
}
function validateEffectStep(p, n) {
    if (p.role !== n.role || (p.phase !== n.phase && !PHASE_EDGES[p.phase].includes(n.phase)) ||
        p.signingAttempts > n.signingAttempts || p.disclosureAttempts > n.disclosureAttempts || p.submissionAttempts > n.submissionAttempts)
        gaslessCorrupt();
    for (const key of ["materialHash", "userOperationHash", "signingStartedAt", "sealedAt", "disclosedAt", "submittedAt", "estimate"]) {
        if (p[key] !== null && !gaslessSame(p[key], n[key]))
            gaslessCorrupt();
    }
    if (p.materialHash === null && n.materialHash !== null && n.phase !== "sealed")
        gaslessCorrupt();
    if (p.phase === "unknown_finality" && n.phase === "sealed" && (p.disclosureAttempts !== 0 || p.submissionAttempts !== 0))
        gaslessCorrupt();
}
export function validateGaslessContinuity(previous, next) {
    validateGaslessOperation(previous);
    validateGaslessOperation(next);
    if (gaslessSame(previous, next))
        return;
    if (previous.terminal || previous.fingerprint !== next.fingerprint || next.transitions.length !== previous.transitions.length + 1 ||
        !gaslessSame(previous.transitions, next.transitions.slice(0, -1)))
        gaslessCorrupt();
}
//# sourceMappingURL=operation-validation.js.map