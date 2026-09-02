import { ApnError } from "./errors.js";
import { parseAtomic } from "./money.js";
import { appendTransition, sealOperation, sealReceipt } from "./state-integrity.js";
import { hasExactTransfer } from "./transfer-policy.js";
const DURABLE_PRE_EFFECT_REASONS = new Set([
    "approval_window_expired",
    "frozen_policy_or_rpc_binding_changed",
    "rpc_origin_changed",
    "provider_profile_changed",
    "provider_sender_changed",
]);
const CHILD_NOT_CREATED_REASONS = new Set([
    "provider_binary_unavailable",
    "provider_child_not_created",
]);
const PROVIDER_REJECTION_REASONS = new Set(["provider_denied", "provider_expired"]);
export function providerDirectReceipt(operation, rpcReceipt) {
    const transition = operation.transitions.at(-1);
    if (transition === undefined)
        stateCorrupt("Provider direct operation has no receipt transition.");
    return sealReceipt({
        schemaVersion: operation.schemaVersion,
        operationId: operation.operationId,
        state: operation.state,
        terminal: operation.terminal,
        reason: operation.reason,
        proofClass: operation.proofClass,
        ...(operation.transactionHash === undefined ? {} : { transactionHash: operation.transactionHash }),
        ...(rpcReceipt === undefined ? {} : {
            blockNumberAtomic: rpcReceipt.blockNumberAtomic,
            exactTransferLog: rpcReceipt.status === "success" && hasExactTransfer(rpcReceipt, operation),
        }),
        createdAt: transition.at,
        operationIntegrityHash: operation.integrityHash,
    });
}
export function recoverProviderTerminalOperation(operation, receipt) {
    if (receipt === null || receipt.operationIntegrityHash === operation.integrityHash)
        return null;
    if (!receipt.terminal)
        return null;
    if (operation.terminal || receipt.operationId !== operation.operationId) {
        stateCorrupt("Provider direct terminal receipt conflicts with its operation.");
    }
    assertTerminalReceipt(receipt, operation);
    const { integrityHash: _previousIntegrityHash, ...base } = operation;
    const recovered = sealOperation({
        ...base,
        state: receipt.state,
        terminal: true,
        reason: receipt.reason,
        proofClass: receipt.proofClass,
        transitions: appendTransition(operation.transitions, {
            at: receipt.createdAt,
            state: receipt.state,
            terminal: true,
            reason: receipt.reason,
            proofClass: receipt.proofClass,
        }),
    });
    if (recovered.integrityHash !== receipt.operationIntegrityHash) {
        stateCorrupt("Provider direct orphan receipt does not bind the recoverable terminal transition.");
    }
    return recovered;
}
export function assertProviderTerminalReceiptAuthority(operation, receipt) {
    if (receipt === null || !operation.terminal || !receipt.terminal ||
        receipt.operationId !== operation.operationId || receipt.operationIntegrityHash !== operation.integrityHash ||
        receipt.state !== operation.state || receipt.reason !== operation.reason || receipt.proofClass !== operation.proofClass ||
        receipt.createdAt !== operation.transitions.at(-1)?.at)
        stateCorrupt("Provider direct terminal operation has no authoritative receipt.");
    assertTerminalReceipt(receipt, operation);
}
function assertTerminalReceipt(receipt, operation) {
    if (receipt.transactionHash !== operation.transactionHash) {
        stateCorrupt("Provider direct terminal receipt transaction identity is inconsistent.");
    }
    if (receipt.state === "completed") {
        if (receipt.reason !== "confirmed_exact_usdc_transfer" ||
            receipt.proofClass !== "confirmed_receipt_and_exact_transfer_log" ||
            receipt.blockNumberAtomic === undefined || receipt.exactTransferLog !== true)
            stateCorrupt("Provider direct completion receipt lacks exact settlement evidence.");
        parseAtomic(receipt.blockNumberAtomic);
        return;
    }
    if (receipt.state === "failed_confirmed_revert") {
        if (receipt.reason !== "confirmed_receipt_revert" || receipt.proofClass !== "confirmed_receipt" ||
            receipt.blockNumberAtomic === undefined || receipt.exactTransferLog !== false)
            stateCorrupt("Provider direct revert receipt lacks exact receipt evidence.");
        parseAtomic(receipt.blockNumberAtomic);
        return;
    }
    if (receipt.state === "failed_provider_rejected") {
        if (receipt.blockNumberAtomic !== undefined || receipt.exactTransferLog !== undefined || receipt.transactionHash !== undefined ||
            !PROVIDER_REJECTION_REASONS.has(receipt.reason) || receipt.proofClass !== "provider_terminal_no_transaction")
            stateCorrupt("Provider direct rejection receipt is invalid.");
        return;
    }
    if (receipt.state !== "failed_before_effect" || receipt.blockNumberAtomic !== undefined ||
        receipt.exactTransferLog !== undefined || receipt.transactionHash !== undefined) {
        stateCorrupt("Provider direct orphan receipt has an unsupported terminal classification.");
    }
    const valid = receipt.reason === "provider_amount_encoding_incompatible"
        ? receipt.proofClass === "provider_pre_effect_compatibility_failure"
        : CHILD_NOT_CREATED_REASONS.has(receipt.reason)
            ? receipt.proofClass === "provider_child_not_created"
            : DURABLE_PRE_EFFECT_REASONS.has(receipt.reason) && receipt.proofClass === "durable_pre_effect_failure";
    if (!valid)
        stateCorrupt("Provider direct pre-effect receipt classification is invalid.");
}
function stateCorrupt(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
//# sourceMappingURL=provider-direct-receipt.js.map