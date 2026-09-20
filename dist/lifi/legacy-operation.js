import { validateLegacyBridgeOperation } from "./operation-validation.js";
export function isLegacyBridgeOperation(op) {
    return op.schemaVersion === "apn.bridge-operation.legacy-view.v1";
}
export function adaptLegacyBridgeOperation(value) {
    const raw = validateLegacyBridgeOperation(value);
    const destination = raw.destinationProof;
    return {
        schemaVersion: "apn.bridge-operation.legacy-view.v1",
        durableSchemaVersion: "apn.bridge-operation.v1",
        profileHash: raw.profileHash,
        operationId: raw.operationId,
        idempotencyHash: raw.idempotencyHash,
        requestHash: raw.requestHash,
        fingerprint: raw.fingerprint,
        state: raw.state,
        terminal: raw.terminal,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        intent: raw.intent,
        raw,
        compatibility: {
            resumable: false,
            allowlistBinding: "legacy_unknown",
            usageLease: "legacy_unknown",
            nativeBalanceProof: destination !== null && Object.hasOwn(destination, "nativeBalance") ? "recorded" : "legacy_unknown",
            nativeTransferProof: "legacy_unknown",
        },
    };
}
//# sourceMappingURL=legacy-operation.js.map