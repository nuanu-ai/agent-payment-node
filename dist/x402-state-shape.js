import { stateCorrupt } from "./x402-state-validation-primitives.js";
export const STATE_SHAPE = {
    awaiting_approval: { finalityClass: "pre_effect", terminal: false, reason: "x402_awaiting_authorization", proofClass: "x402_frozen_offer", nextActions: ["x402.fetch.approve", "operation.status"] },
    authorization_material_pending: { finalityClass: "pre_effect", terminal: false, reason: "x402_authorization_material_pending", proofClass: "x402_authorization_recovery", nextActions: ["operation.resume", "operation.status"] },
    authorized_not_sent: { finalityClass: "pre_effect", terminal: false, reason: "x402_authorized_not_sent", proofClass: "x402_authorization_verified", nextActions: ["operation.resume", "operation.status"] },
    paid_request_pending: { finalityClass: "unknown_finality", terminal: false, reason: "x402_paid_request_pending", proofClass: "x402_unknown_finality", nextActions: ["operation.resume", "operation.status"] },
    settlement_pending: { finalityClass: "unknown_finality", terminal: false, reason: "x402_settlement_pending", proofClass: "x402_unknown_finality", nextActions: ["operation.resume", "operation.status"] },
    effect_unknown: { finalityClass: "unknown_finality", terminal: false, reason: "x402_effect_unknown", proofClass: "x402_unknown_finality", nextActions: ["operation.resume", "operation.status"] },
    seller_result_recovery_pending: { finalityClass: "known_settled", terminal: false, reason: "x402_seller_result_recovery_pending", proofClass: "x402_settlement_verified_result_pending", nextActions: ["operation.resume", "operation.status"] },
    completed: { finalityClass: "terminal", terminal: true, reason: "x402_completed", proofClass: "x402_safe_settlement", nextActions: ["receipt.get"] },
    failed_before_effect: { finalityClass: "terminal", terminal: true, reason: "x402_failed_before_effect", proofClass: "x402_proven_no_effect", nextActions: ["receipt.get"] },
    failed_expired_unused: { finalityClass: "terminal", terminal: true, reason: "x402_failed_expired_unused", proofClass: "x402_expired_unused_finalized", nextActions: ["receipt.get"] },
    failed_settled_without_result: { finalityClass: "terminal", terminal: true, reason: "x402_failed_settled_without_result", proofClass: "x402_settled_result_unavailable", nextActions: ["receipt.get"] },
    abandoned_unknown: { finalityClass: "terminal", terminal: true, reason: "x402_owner_abandoned_unknown", proofClass: "x402_owner_acknowledgement_only", nextActions: ["receipt.get"] },
};
// Every non-terminal state may end by the owner's foreground acknowledgement once its validity window has passed.
const LEGAL_NEXT = {
    awaiting_approval: ["authorization_material_pending", "failed_before_effect", "abandoned_unknown"],
    authorization_material_pending: ["authorization_material_pending", "authorized_not_sent", "failed_before_effect", "failed_expired_unused", "abandoned_unknown"],
    authorized_not_sent: ["authorized_not_sent", "paid_request_pending", "effect_unknown", "failed_before_effect", "failed_expired_unused", "abandoned_unknown"],
    paid_request_pending: ["settlement_pending", "effect_unknown", "seller_result_recovery_pending", "completed"],
    settlement_pending: ["settlement_pending", "effect_unknown", "seller_result_recovery_pending", "completed", "failed_expired_unused", "failed_settled_without_result", "abandoned_unknown"],
    effect_unknown: ["effect_unknown", "settlement_pending", "paid_request_pending", "seller_result_recovery_pending", "completed", "failed_expired_unused", "failed_settled_without_result", "abandoned_unknown"],
    seller_result_recovery_pending: ["seller_result_recovery_pending", "effect_unknown", "completed", "failed_settled_without_result", "abandoned_unknown"],
    completed: [], failed_before_effect: [], failed_expired_unused: [], failed_settled_without_result: [], abandoned_unknown: [],
};
export function legalNextState(from, to) { return LEGAL_NEXT[from].includes(to); }
export function validateStateTuple(state, terminal, reason, proofClass) {
    if (typeof state !== "string" || !(state in STATE_SHAPE))
        stateCorrupt("x402 state is invalid.");
    const typedState = state;
    const shape = STATE_SHAPE[typedState];
    if (terminal !== shape.terminal || reason !== shape.reason || proofClass !== shape.proofClass)
        stateCorrupt("x402 state classification is invalid.");
    return typedState;
}
//# sourceMappingURL=x402-state-shape.js.map