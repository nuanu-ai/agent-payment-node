import { hashObject } from "../canonical.js";
import { validateGaslessOperation } from "./operation-validation.js";
import { gaslessIntentAsset } from "./registry.js";
export function gaslessNextActions(op) {
    if (op.terminal)
        return op.state === "completed" ? [] : ["apn gasless transfer prepare --help"];
    if (op.state === "awaiting_approval")
        return [`apn gasless transfer approve --operation ${op.operationId}`];
    const source = op.observation?.source;
    return [`apn operation resume --operation ${op.operationId}${source === undefined ? "" : ` --observation-rpc-env ${source.environmentName}`}`];
}
export function gaslessProofClass(op) {
    if (op.state === "abandoned_unknown")
        return "owner_acknowledgement_only";
    if (op.state === "failed_before_effect")
        return "durable_pre_effect";
    if (op.state === "completed")
        return "rpc_safe_correlated";
    if (op.state === "failed_permissions_invalidated")
        return op.observation?.permissionInvalidation?.userOperationHash === undefined
            ? "rpc_safe_permissions_invalidated" : "rpc_safe_final_permissions_invalidated";
    if (op.settlement !== null || op.observation?.settlement)
        return "rpc_safe_effects";
    if (op.bootstrap.signingAttempts === 1)
        return "effect_observation_pending";
    return "durable_pre_effect";
}
export function publicGaslessOperation(op) {
    validateGaslessOperation(op);
    const i = op.intent, proof = op.settlement ?? op.observation?.settlement ?? null, a = proof?.accounting ?? null;
    // The stored record is re-validated above; its display unit comes from the registry row it names, never a literal.
    const asset = gaslessIntentAsset(i);
    const invalidation = op.observation?.permissionInvalidation;
    const fee = a === null ? null : BigInt(a.feeAtomic), delivered = a === null ? null : BigInt(a.deliveredAtomic);
    const effects = [op.bootstrap, op.userOperation].map((e) => ({ role: e.role, phase: e.phase,
        signing_attempts: e.signingAttempts, disclosure_attempts: e.disclosureAttempts, submission_attempts: e.submissionAttempts,
        material_hash: e.materialHash, user_operation_hash: e.userOperationHash,
        estimate_hash: e.estimate === null ? null : hashObject(e.estimate), signing_started_at: e.signingStartedAt,
        sealed_at: e.sealedAt, disclosed_at: e.disclosedAt, submitted_at: e.submittedAt }));
    return {
        kind: "gasless_transfer", schema_version: op.schemaVersion, operation_id: op.operationId,
        profile: i.profile, provider: "local", custody: "local_software",
        fingerprint: op.fingerprint, state: op.state, terminal: op.terminal, proof_class: gaslessProofClass(op),
        reason: op.failure ?? (op.state === "completed" ? "gasless_delivery_correlated" : op.state),
        execution_owner: "apn", retry_owner: "apn_observation_only_after_attempt", evidence_owner: "configured_chain_rpc",
        transfer: { chain_id: i.request.chainId, token: i.token, symbol: asset.symbol, decimals: asset.decimals,
            sender: i.owner.address, recipient: i.request.recipient, gross_atomic: i.request.grossAtomic,
            user_max_fee_atomic: i.request.maxFeeAtomic, minimum_received_atomic: i.request.minReceivedAtomic,
            quoted_fee_budget_atomic: i.feeCapAtomic, recipient_atomic: i.recipientAtomic,
            actual_delivered_atomic: a?.deliveredAtomic ?? null,
            actual_sender_debit_atomic: fee === null || delivered === null ? null : (fee + delivered).toString(),
            unused_gross_atomic: fee === null || delivered === null ? null : (BigInt(i.request.grossAtomic) - fee - delivered).toString() },
        fees: { asset: i.token, prefund_atomic: a?.prefundAtomic ?? null, refund_atomic: a?.refundAtomic ?? null,
            actual_fee_atomic: a?.feeAtomic ?? null, unused_fee_budget_atomic: fee === null ? null : (BigInt(i.feeCapAtomic) - fee).toString(),
            unused_budget_remains_with_sender: true, fee_possible_on_failed_transfer: true,
            approved_sender_native_debit_wei: "0", proven_sender_native_debit_wei: proof === null ? null : "0",
            native_gas_payer: proof?.outerSender ?? null, native_paymaster: i.paymaster,
            native_paymaster_bill_capped_by_this_quote: false },
        permission: { entry_point: i.entryPoint, paymaster: i.paymaster, delegate: i.delegate,
            initial_designation: i.initialSnapshot.delegation,
            observed_designation: proof?.safeAccount.delegation ?? invalidation?.headAccount.delegation ?? null,
            delegation_persists: invalidation === undefined || invalidation.headAccount.delegation === "expected",
            permit_deadline: "MAX_UINT256", permit_amount_atomic: i.feeCapAtomic,
            initial_allowance_atomic: i.initialSnapshot.allowanceAtomic,
            residual_allowance_atomic: proof?.safeAccount.allowanceAtomic ?? invalidation?.headAccount.allowanceAtomic ?? null,
            guard_held: !op.terminal, automatic_revocation: false },
        gas: i.gas, effects, unsigned_envelope_hash: i.unsignedEnvelopeHash,
        user_operation_hash: op.userOperation.userOperationHash, transaction_hash: proof?.transactionHash ?? op.observation?.transactionHash ?? null,
        settlement: proof, scan_cursor: op.cursor,
        ...(op.observation?.source === undefined ? {} : { observation_source: op.observation.source }),
        ...(invalidation === undefined ? {} : { permission_invalidation: invalidation,
            ...(invalidation.userOperationHash === undefined ? { payment_submitted: false } : {
                payment_submitted: null, payment_submission_attempted: op.userOperation.submissionAttempts === 1,
                prior_payment_effects: "unknown", final_permissions_invalidated: true
            }) }),
        rpc_origin: i.initialSnapshot.rpcOrigin, bundler_origin: i.initialSnapshot.bundlerOrigin,
        policy: { identity: "apn.gasless.foreground-approval.v1", policy_hash: i.policyHash,
            approved_at: op.approval?.approvedAt ?? null, action_deadline: i.expiresAt,
            onchain_user_operation_expiry: false, onchain_permit_expiry: false },
        created_at: op.createdAt, updated_at: op.updatedAt, expires_at: i.expiresAt,
        next_actions: gaslessNextActions(op),
    };
}
export function gaslessReceipt(op) {
    const body = { ...publicGaslessOperation(op), schema_version: "apn.gasless-receipt.v1",
        operation_binding_hash: op.integrityHash };
    return { ...body, receipt_hash: hashObject(body) };
}
//# sourceMappingURL=receipt.js.map