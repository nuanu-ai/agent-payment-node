import { canonicalJson, hashObject } from "../canonical.js";
import { SA_FILE_LIMIT, SA_RECEIPT_VERSION } from "./operation-model.js";
import { saSame } from "./integrity.js";
import { saFail } from "./reasons.js";
import { saExact, saHash } from "./schema.js";
import { smartAccountGaslessAtTransition, validateSmartAccountGaslessOperation } from "./transitions.js";
export function publicSmartAccountGaslessOperation(operation) {
    const op = validateSmartAccountGaslessOperation(operation), i = op.intent, s = op.settlement;
    const zero = op.terminal && s === null ? "0" : null;
    const status = op.state === "completed" ? "consumed" :
        op.state === "expired_unused" ? "expired_unused" : op.exposureAttempts === 1 ? "possibly_live" :
            op.material !== null ? "sealed_local" : op.state === "failed_before_effect" ? "failed_before_effect" : "not_signed";
    return {
        schema_version: op.schemaVersion, kind: op.kind, operation_id: op.operationId, profile: i.profile,
        profile_hash: op.profileHash, provider: "metamask-smart-account", custody: "external_owner_delegated_local_session",
        execution_owner: "public_facilitator", retry_owner: "apn_observation_only_after_exposure", evidence_owner: "configured_chain_rpc",
        fingerprint: op.fingerprint, state: op.state, terminal: op.terminal,
        reason: op.failure?.reason ?? op.observation?.reason ?? (op.state === "awaiting_approval" ? "sa_gasless_approval" : null),
        proof_class: op.state === "completed" ? "rpc_safe_correlated" : op.state === "expired_unused" ? "rpc_finalized_unused" :
            op.exposureAttempts === 1 ? "effect_observation_pending" : "durable_pre_effect",
        transfer: { chain_id: 8453, token: i.token, symbol: "USDC", decimals: 6, sender: i.binding.ownerAddress,
            recipient: i.request.recipient, gross_atomic: i.request.grossAtomic, user_max_fee_atomic: i.request.maxFeeAtomic,
            minimum_received_atomic: i.request.minReceivedAtomic, frozen_net_atomic: i.request.grossAtomic, frozen_fee_atomic: "0",
            actual_delivered_atomic: s?.deliveredAtomic ?? zero, actual_sender_debit_atomic: s?.debitAtomic ?? zero },
        fees: { token: i.token, actual_fee_atomic: s?.feeAtomic ?? zero, refund_atomic: s?.refundAtomic ?? zero,
            unused_gross_atomic: s?.unusedGrossAtomic ?? (op.terminal ? i.request.grossAtomic : null),
            approved_sender_native_debit_wei: "0", proven_sender_native_debit_wei: s?.ownerNativeDebitWei ?? zero,
            proven_session_native_debit_wei: s?.sessionNativeDebitWei ?? zero, native_gas_payer: s?.outerSender ?? null },
        permission: { owner: i.binding.ownerAddress, session: i.binding.sessionAddress,
            root_delegation_hash: i.binding.rootDelegationHash, child_delegation_hash: op.material?.childDelegationHash ?? null,
            root_nonce_atomic: i.binding.rootNonceAtomic, material_hash: op.material?.materialHash ?? null,
            permission_context_hash: op.material?.permissionContextHash ?? null, onchain_expiry: true, guard_held: !op.terminal, status },
        signing_attempts: op.signingAttempts, exposure_attempts: op.exposureAttempts, submission_attempts: op.submissionAttempts,
        transaction_hash: s?.txHash ?? op.observation?.candidateTxHash ?? op.providerSettlement?.transactionHash ?? null,
        settlement: s, unused_proof: op.unusedProof, scan_cursor: op.cursor,
        endpoint_origin: i.initialSnapshot.endpointOrigin, endpoint_hash: i.initialSnapshot.endpointHash,
        approved_at: op.approval?.approvedAt ?? null, created_at: op.createdAt, updated_at: op.updatedAt, expires_at: i.expiresAt,
        next_actions: [op.state === "awaiting_approval" ? `apn gasless transfer approve --operation ${op.operationId}` :
                op.terminal ? `apn receipt get --operation ${op.operationId}` : `apn operation resume --operation ${op.operationId}`],
    };
}
export function smartAccountGaslessReceipt(operation) {
    const op = validateSmartAccountGaslessOperation(operation), body = {
        ...publicSmartAccountGaslessOperation(op), schema_version: SA_RECEIPT_VERSION,
        operation_binding_hash: op.integrityHash, transition_hash: op.transitions.at(-1).transitionHash,
    };
    return { ...body, receipt_hash: hashObject(body) };
}
/** A stale sidecar is repairable only if it is an exact derivative of an authenticated history prefix. */
export function validateSmartAccountGaslessReceipt(value, operation) {
    try {
        const op = validateSmartAccountGaslessOperation(operation);
        if (Buffer.byteLength(canonicalJson(value), "utf8") + 1 > SA_FILE_LIMIT)
            saFail("sa_gasless_state_corrupt");
        const receipt = saExact(value, Object.keys(smartAccountGaslessReceipt(op)));
        const binding = saHash(receipt.operation_binding_hash), transitionHash = saHash(receipt.transition_hash);
        saHash(receipt.receipt_hash);
        const index = op.transitions.findIndex(t => t.transitionHash === transitionHash);
        if (index < 0)
            saFail("sa_gasless_state_corrupt");
        const historical = smartAccountGaslessAtTransition(op, index);
        if (historical.integrityHash !== binding || !saSame(receipt, smartAccountGaslessReceipt(historical)))
            saFail("sa_gasless_state_corrupt");
        return receipt;
    }
    catch {
        return saFail("sa_gasless_state_corrupt");
    }
}
//# sourceMappingURL=receipt.js.map