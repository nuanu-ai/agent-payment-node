import { isPlainRecord } from "./canonical.js";
import { OUTPUT_VERSION } from "./constants.js";
import { asApnError } from "./errors.js";
export function successEnvelope(request, requestId, result) {
    const record = isPlainRecord(result) ? result : {};
    const operation = isOperationCommand(request.command) ? result : null;
    const receipt = request.command === "receipt.get" ? result : null;
    return {
        version: OUTPUT_VERSION,
        request_id: requestId,
        command: request.command,
        ok: true,
        proof_class: typeof record.proof_class === "string" ? record.proof_class : proofClassFor(request.command),
        data: operation === null && receipt === null ? result : null,
        operation,
        receipt,
        error: null,
        next_actions: stringActions(record.next_actions),
    };
}
export function failureEnvelope(command, requestId, error) {
    const safe = asApnError(error);
    return {
        version: OUTPUT_VERSION,
        request_id: requestId,
        command,
        ok: false,
        proof_class: "classified_failure",
        data: null,
        operation: null,
        receipt: null,
        error: {
            code: safe.code,
            message: safe.message,
            ...(safe.details === undefined ? {} : { details: safe.details }),
        },
        next_actions: nextActions(safe.code),
    };
}
function stringActions(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function nextActions(code) {
    switch (code) {
        case "APN_NATIVE_CHANNEL_REQUIRED": return ["Run the command through APNKeychainAgent.app."];
        case "APN_RPC_CONFIG": return ["Provide --rpc-url with an explicit HTTPS Base endpoint."];
        case "APN_REPREPARE_REQUIRED": return ["Prepare a new transfer with a new idempotency key."];
        case "APN_STATE_BUSY": return ["Retry after the active APN operation exits."];
        default: return [];
    }
}
function isOperationCommand(command) {
    return ["transfer.prepare", "transfer.approve", "operation.status", "operation.resume"].includes(command);
}
function proofClassFor(command) {
    if (command === "version")
        return "local_build_metadata";
    if (command === "wallet.balance")
        return "chain_verified_public_read";
    if (["wallet.ensure", "wallet.status", "doctor.keychain"].includes(command))
        return "native_keychain_status";
    return "durable_public_state";
}
//# sourceMappingURL=output.js.map