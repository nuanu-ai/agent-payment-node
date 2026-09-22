import { isPlainRecord } from "./canonical.js";
export function dataOutcome(data, fallbackProofClass) {
    const artifact = artifactMetadata(data);
    return {
        proofClass: artifact.proofClass ?? fallbackProofClass,
        data,
        operation: null,
        receipt: null,
        nextActions: artifact.nextActions,
    };
}
export function operationOutcome(operation) {
    const artifact = artifactMetadata(operation);
    return {
        proofClass: artifact.proofClass ?? "durable_public_state",
        data: null,
        operation,
        receipt: null,
        nextActions: artifact.nextActions,
    };
}
export function receiptOutcome(receipt) {
    const artifact = artifactMetadata(receipt);
    return {
        proofClass: artifact.proofClass ?? "durable_public_state",
        data: null,
        operation: null,
        receipt,
        nextActions: artifact.nextActions,
    };
}
function artifactMetadata(value) {
    const record = isPlainRecord(value) ? value : {};
    const proofClass = typeof record.proof_class === "string"
        ? record.proof_class
        : typeof record.proofClass === "string" ? record.proofClass : undefined;
    const actions = record.next_actions ?? record.nextActions;
    return {
        ...(proofClass === undefined ? {} : { proofClass }),
        nextActions: Array.isArray(actions) ? actions.filter((item) => typeof item === "string") : [],
    };
}
//# sourceMappingURL=core-outcome.js.map