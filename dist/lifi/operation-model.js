import { hashObject } from "../canonical.js";
export const BRIDGE_TERMINAL = ["completed", "failed_before_effect", "failed_after_approval", "failed_confirmed_revert"];
export function bridgeIntentBinding(operation) {
    return { schemaVersion: operation.schemaVersion, kind: operation.kind, profileHash: operation.profileHash,
        operationId: operation.operationId, idempotencyHash: operation.idempotencyHash, requestHash: operation.requestHash,
        intent: operation.intent, envelopes: operation.effects.map(({ envelope }) => envelope) };
}
export function newBridgeEffect(envelope) {
    return { role: envelope.role, envelope, phase: "unsealed", transactionHash: null,
        sealedMaterialHash: null, submittedAt: null, submissionAttempts: 0, includedProof: null, safeProof: null };
}
export function bridgeSnapshot(value) {
    return { state: value.state, approval: value.approval,
        effects: value.effects.map(({ envelope, ...effect }) => ({ ...effect, envelopeHash: envelope.envelopeHash })),
        sourceProof: value.sourceProof, destinationProof: value.destinationProof,
        providerObservation: value.providerObservation, destinationScan: value.destinationScan, failure: value.failure, usageLease: value.usageLease };
}
export function sealBridgeOperation(value) {
    return { ...value, integrityHash: hashObject(value) };
}
//# sourceMappingURL=operation-model.js.map