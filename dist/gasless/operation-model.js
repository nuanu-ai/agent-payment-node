import { hashObject } from "../canonical.js";
export const GASLESS_TERMINAL = ["completed", "failed_before_effect", "failed_confirmed_revert"];
export function gaslessIntentBinding(op) {
    return { schemaVersion: op.schemaVersion, kind: op.kind, profileHash: op.profileHash,
        operationId: op.operationId, idempotencyHash: op.idempotencyHash, requestHash: op.requestHash, intent: op.intent };
}
export function newGaslessEffect(role) {
    return { role, phase: "unsealed", signingAttempts: 0, materialHash: null, disclosureAttempts: 0,
        submissionAttempts: 0, userOperationHash: null, estimate: null, signingStartedAt: null,
        sealedAt: null, disclosedAt: null, submittedAt: null };
}
export function gaslessSnapshot(op) {
    return { state: op.state, approval: op.approval, bootstrap: op.bootstrap, userOperation: op.userOperation,
        cursor: op.cursor, observation: op.observation, settlement: op.settlement, failure: op.failure };
}
export function sealGaslessOperation(op) {
    return { ...op, integrityHash: hashObject(op) };
}
//# sourceMappingURL=operation-model.js.map