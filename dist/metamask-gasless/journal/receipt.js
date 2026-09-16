import { hashObject } from "../../canonical.js";
import { mmDispatchIntent } from "../dispatch.js";
import { mmPrivateHash } from "../identity.js";
import { MM_RECEIPT_VERSION } from "../operation-model.js";
import { mmFail } from "../reasons.js";
import { mmRegistry } from "../registry.js";
import { mmExact, mmHash, mmSame } from "../validation.js";
import { metaMaskGaslessAtTransition } from "./transitions.js";
import { validateMetaMaskGaslessOperation } from "./validation.js";
const RECEIPT_KEYS = ["schema_version", "kind", "operation_id", "profile", "profile_hash", "provider", "custody",
    "execution_owner", "retry_owner", "evidence_owner", "fingerprint", "state", "terminal", "reason", "proof_class",
    "transfer", "fees", "permission", "provider_binding", "provider_request_id_hash", "submission_attempts",
    "transaction_hash", "settlement", "scan_cursor", "endpoint_origin", "endpoint_hash", "approved_at", "created_at",
    "updated_at", "expires_at", "next_actions", "operation_binding_hash", "transition_hash", "receipt_hash"];
function corrupt() { return mmFail("mm_gasless_state_corrupt"); }
export function metaMaskGaslessNextActions(operation) {
    const op = validateMetaMaskGaslessOperation(operation);
    if (op.state === "awaiting_approval")
        return [`apn gasless transfer approve --operation ${op.operationId}`];
    if (op.terminal)
        return [`apn receipt get --operation ${op.operationId}`];
    if (op.failure?.reason === "mm_gasless_provider_approval")
        return [
            "Confirm this existing transaction in MetaMask Mobile or the email registered to your MetaMask dashboard.",
            `apn operation resume --operation ${op.operationId}`,
        ];
    return [`apn operation resume --operation ${op.operationId}`];
}
export function metaMaskGaslessProofClass(operation) {
    const op = validateMetaMaskGaslessOperation(operation);
    if (op.state === "abandoned_unknown")
        return "owner_acknowledgement_only";
    if (op.state === "completed")
        return mmRegistry(op.intent.request.chainId).row.finalityTag === "finalized"
            ? "rpc_finalized_correlated" : "rpc_safe_correlated";
    return op.submissionAttempts === 1 ? "effect_observation_pending" : "durable_pre_effect";
}
export function publicMetaMaskGaslessOperation(operation) {
    const op = validateMetaMaskGaslessOperation(operation), settlement = op.settlement;
    // The prepared intent stays immutable; the price, batch and delegation reported are the ones dispatched.
    const intent = mmDispatchIntent(op);
    const transactionHash = settlement?.txHash ?? op.observation?.candidateTxHash ?? null;
    return {
        schema_version: op.schemaVersion, kind: op.kind, operation_id: op.operationId, profile: intent.profile,
        profile_hash: op.profileHash, provider: "metamask-agent-wallet", custody: "provider_managed_server_wallet",
        execution_owner: "provider", retry_owner: "apn_observation_only_after_attempt", evidence_owner: "configured_chain_rpc",
        fingerprint: op.fingerprint, state: op.state, terminal: op.terminal,
        reason: op.failure?.reason ?? (op.state === "completed" ? "mm_gasless_success" :
            op.state === "awaiting_approval" ? "mm_gasless_approval" : "mm_gasless_pending"),
        proof_class: metaMaskGaslessProofClass(op),
        transfer: { chain_id: intent.request.chainId, token: intent.token, symbol: "USDC", decimals: 6,
            sender: intent.binding.address, recipient: intent.request.recipient, fee_recipient: intent.quote.feeRecipient,
            gross_atomic: intent.request.grossAtomic, user_max_fee_atomic: intent.request.maxFeeAtomic,
            minimum_received_atomic: intent.request.minReceivedAtomic, frozen_net_atomic: intent.quote.netAtomic,
            frozen_fee_atomic: intent.quote.feeAtomic, actual_delivered_atomic: settlement?.deliveredAtomic ?? null,
            actual_sender_debit_atomic: settlement?.debitAtomic ?? null },
        fees: { token: intent.token, actual_fee_atomic: settlement?.feeAtomic ?? null,
            refund_atomic: settlement?.refundAtomic ?? null, unused_gross_atomic: settlement?.unusedGrossAtomic ?? null,
            approved_sender_native_debit_wei: "0", proven_sender_native_debit_wei: settlement === null ? null : "0",
            native_gas_payer: settlement?.outerSender ?? null },
        permission: { initial_designation: intent.initialSnapshot.safeState.designation,
            observed_designation: settlement?.designation ?? null, designation_persists: true,
            delegation_hash: intent.delegationHash, signing_digest: intent.signingDigest,
            one_use_status: settlement !== null ? "consumed" : op.submissionAttempts === 1 ? "possibly_live" : "not_dispatched",
            onchain_expiry: false, guard_held: !op.terminal },
        provider_binding: intent.binding, provider_request_id_hash: mmPrivateHash("request-id", intent.requestId),
        submission_attempts: op.submissionAttempts, transaction_hash: transactionHash, settlement,
        scan_cursor: op.cursor, endpoint_origin: intent.initialSnapshot.endpointOrigin,
        endpoint_hash: intent.initialSnapshot.endpointHash, approved_at: op.approval?.approvedAt ?? null,
        created_at: op.createdAt, updated_at: op.updatedAt, expires_at: intent.expiresAt,
        next_actions: metaMaskGaslessNextActions(op),
    };
}
export function metaMaskGaslessReceipt(operation) {
    const op = validateMetaMaskGaslessOperation(operation), body = {
        ...publicMetaMaskGaslessOperation(op), schema_version: MM_RECEIPT_VERSION,
        operation_binding_hash: op.integrityHash, transition_hash: op.transitions.at(-1).transitionHash,
    };
    return { ...body, receipt_hash: hashObject(body) };
}
/** Accept the current receipt or an exact historical derivative, never an unrelated stale sidecar. */
export function validateMetaMaskGaslessReceipt(value, operation) {
    const op = validateMetaMaskGaslessOperation(operation), receipt = mmExact(value, RECEIPT_KEYS);
    const binding = mmHash(receipt.operation_binding_hash), transitionHash = mmHash(receipt.transition_hash);
    mmHash(receipt.receipt_hash);
    for (let index = 0; index < op.transitions.length; index += 1) {
        const historical = metaMaskGaslessAtTransition(op, index);
        if (historical.integrityHash === binding && historical.transitions.at(-1).transitionHash === transitionHash &&
            mmSame(receipt, metaMaskGaslessReceipt(historical)))
            return receipt;
    }
    return corrupt();
}
//# sourceMappingURL=receipt.js.map