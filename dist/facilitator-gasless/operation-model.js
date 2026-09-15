import { hashObject } from "../canonical.js";
export const FACILITATOR_OPERATION_VERSION = "apn.facilitator-gasless-operation.v1";
export const FACILITATOR_RECEIPT_VERSION = "apn.facilitator-gasless-receipt.v1";
export const FACILITATOR_KIND = "facilitator_gasless_transfer";
export const FACILITATOR_POLICY = "apn.facilitator-gasless.foreground-approval.v1";
export const FACILITATOR_STATES = ["awaiting_approval", "approved", "verify_started", "settle_started", "settle_submitted",
    "completed", "expired_unused", "failed_before_effect"];
export const FACILITATOR_TERMINAL = Object.freeze(["completed", "expired_unused", "failed_before_effect"]);
/** After the exposure marker the signature may be outside APN; only finalized chain evidence closes the operation. */
export const FACILITATOR_EXPOSED = Object.freeze(["verify_started", "settle_started", "settle_submitted"]);
export const FACILITATOR_HISTORY_LIMIT = 64;
export const FACILITATOR_FILE_LIMIT = 1024 * 1024;
export const FACILITATOR_INITIAL = Object.freeze({ state: "awaiting_approval", approval: null, signed: null,
    verify: null, settle: null, observation: null, settlement: null, failure: null });
export function facilitatorMutable(op) {
    return { state: op.state, approval: op.approval, signed: op.signed, verify: op.verify, settle: op.settle,
        observation: op.observation, settlement: op.settlement, failure: op.failure };
}
export function facilitatorBinding(op) {
    return { schemaVersion: op.schemaVersion, kind: op.kind, profileHash: op.profileHash, operationId: op.operationId,
        idempotencyHash: op.idempotencyHash, requestHash: op.requestHash, intent: op.intent };
}
export function sealFacilitatorOperation(op) {
    return { ...op, integrityHash: hashObject(op) };
}
//# sourceMappingURL=operation-model.js.map