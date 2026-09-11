import { hashObject } from "../canonical.js";
export const SA_OPERATION_VERSION = "apn.smart-account-gasless-operation.v1";
export const SA_OPERATION_KIND = "smart_account_gasless_transfer";
export const SA_RECEIPT_VERSION = "apn.smart-account-gasless-receipt.v1";
export const SA_TERMINAL = Object.freeze(["failed_before_effect", "expired_unused", "completed"]);
export const SA_HISTORY_LIMIT = 256;
export const SA_FILE_LIMIT = 256 * 1024;
export const SA_TERMINAL_RESERVE_TRANSITIONS = 2;
export const SA_TERMINAL_RESERVE_BYTES = 32 * 1024;
export const SA_MUTABLE_KEYS = ["state", "approval", "material", "signingAttempts", "exposureAttempts", "submissionAttempts",
    "exposureStartedAt", "dispatchStartedAt", "verification", "providerSettlement", "cursor", "observation", "settlement",
    "unusedProof", "failure"];
export function saImmutable(op) {
    return { schemaVersion: SA_OPERATION_VERSION, kind: SA_OPERATION_KIND, profileHash: op.profileHash,
        operationId: op.operationId, idempotencyHash: op.idempotencyHash, requestHash: op.requestHash,
        createdAt: op.createdAt, intent: op.intent };
}
export function saMutable(op) {
    return { state: op.state, approval: op.approval, material: op.material, signingAttempts: op.signingAttempts,
        exposureAttempts: op.exposureAttempts, submissionAttempts: op.submissionAttempts, exposureStartedAt: op.exposureStartedAt,
        dispatchStartedAt: op.dispatchStartedAt, verification: op.verification, providerSettlement: op.providerSettlement,
        cursor: op.cursor, observation: op.observation, settlement: op.settlement, unusedProof: op.unusedProof, failure: op.failure };
}
export function saRequestHash(profileHash, intent) {
    return hashObject({ kind: SA_OPERATION_KIND, profileHash, providerId: "metamask-smart-account",
        token: intent.token, request: intent.request });
}
//# sourceMappingURL=operation-model.js.map