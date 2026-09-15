import { hashObject } from "../canonical.js";
export const MM_OPERATION_VERSION = "apn.metamask-gasless-operation.v1";
export const MM_OPERATION_KIND = "metamask_gasless_transfer";
export const MM_RECEIPT_VERSION = "apn.metamask-gasless-receipt.v1";
export const MM_TERMINAL = ["completed", "failed_before_effect", "abandoned_unknown"];
export const MM_HISTORY_LIMIT = 96;
export const MM_FILE_LIMIT = 1024 * 1024;
export const MM_DISPATCH_RESERVE_TRANSITIONS = 8;
export const MM_DISPATCH_RESERVE_BYTES = 64 * 1024;
export function mmImmutable(op) {
    return { schemaVersion: op.schemaVersion, kind: op.kind, profileHash: op.profileHash,
        operationId: op.operationId, idempotencyHash: op.idempotencyHash, requestHash: op.requestHash,
        createdAt: op.createdAt, intent: op.intent };
}
export function mmMutable(op) {
    return { state: op.state, approval: op.approval, submissionAttempts: op.submissionAttempts,
        dispatchStartedAt: op.dispatchStartedAt, providerObservation: op.providerObservation, cursor: op.cursor,
        observation: op.observation, settlement: op.settlement, failure: op.failure };
}
export function mmRequestHash(profileHash, intent) {
    const r = intent.request;
    return hashObject({ kind: MM_OPERATION_KIND, profileHash, providerId: "metamask-agent-wallet",
        chainId: r.chainId, token: intent.token, recipient: r.recipient, grossAtomic: r.grossAtomic,
        maxFeeAtomic: r.maxFeeAtomic, minReceivedAtomic: r.minReceivedAtomic });
}
//# sourceMappingURL=operation-model.js.map