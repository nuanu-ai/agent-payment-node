import { hashObject } from "../canonical.js";
import { FACILITATOR_KIND, FACILITATOR_POLICY, FACILITATOR_RECEIPT_VERSION } from "./operation-model.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
import { validateFacilitatorOperation } from "./transitions.js";
export function facilitatorNextActions(op) {
    if (op.terminal)
        return op.state === "completed" ? [] : ["apn gasless transfer prepare --help"];
    if (op.state === "awaiting_approval")
        return [`apn gasless transfer approve --operation ${op.operationId}`];
    return [`apn operation resume --operation ${op.operationId}`];
}
export function facilitatorProofClass(op) {
    if (op.state === "completed")
        return "rpc_finalized_correlated";
    if (op.state === "expired_unused")
        return "rpc_finalized_unused";
    if (op.state === "abandoned_unknown")
        return "owner_acknowledgement_only";
    return op.verify === null ? "durable_pre_effect" : "effect_observation_pending";
}
export function publicFacilitatorOperation(op) {
    validateFacilitatorOperation(op);
    const i = op.intent, signed = op.signed, settlement = op.settlement, a = signed?.authorization ?? null;
    return {
        kind: FACILITATOR_KIND, schema_version: op.schemaVersion, operation_id: op.operationId, profile: i.profile,
        provider: "local", custody: "local_software", route: "x402_exact_eip3009_public_facilitator",
        fingerprint: op.fingerprint, state: op.state, terminal: op.terminal, proof_class: facilitatorProofClass(op),
        reason: op.failure ?? (op.state === "completed" ? "facilitator_gasless_delivery_correlated" : op.state),
        execution_owner: "public_facilitator", retry_owner: "apn_observation_only_after_exposure",
        evidence_owner: "configured_chain_rpc",
        transfer: { chain_id: R.chainId, network: R.network, token: i.requirement.asset, symbol: "USDC", decimals: R.decimals,
            sender: i.owner.address, recipient: i.request.recipient, gross_atomic: i.request.grossAtomic,
            user_max_fee_atomic: i.request.maxFeeAtomic, minimum_received_atomic: i.request.minReceivedAtomic,
            recipient_atomic: i.request.grossAtomic, frozen_fee_atomic: "0",
            actual_delivered_atomic: settlement?.deliveredAtomic ?? null, actual_sender_debit_atomic: settlement?.deliveredAtomic ?? null,
            unused_gross_atomic: op.state === "expired_unused" ? i.request.grossAtomic : settlement === null ? null : "0" },
        fees: { token_fee_atomic: "0", approved_sender_native_debit_wei: "0",
            native_gas_payer: "public_facilitator", paid_facilitator_tier: false },
        authorization: signed === null || a === null ? null : { standard: "EIP-3009", method: "transferWithAuthorization",
            from: a.from, to: a.to, value_atomic: a.value, valid_after: a.validAfter, valid_before: a.validBefore, nonce: a.nonce,
            digest: signed.digest, signature_hash: signed.signatureHash, start_block: signed.startBlock, onchain_expiry: true },
        facilitator: { origin: i.facilitator.origin, endpoint_hash: i.facilitator.endpointHash, approved_signers: i.facilitator.signers,
            supported_response_hash: i.facilitator.supportedResponseHash, requirement_hash: i.requirementHash,
            verify: exchange(op.verify), settle: exchange(op.settle) },
        transaction_hash: settlement?.transactionHash ?? op.settle?.transactionHash ?? op.observation?.transactionHash ?? null,
        settlement, observation: op.observation,
        rpc_origin: i.initial.rpcOrigin, initial_block: i.initial.block, initial_balance_atomic: i.initial.balanceAtomic,
        policy: { identity: FACILITATOR_POLICY, policy_hash: i.policyHash, approved_at: op.approval?.approvedAt ?? null,
            action_deadline: i.expiresAt, onchain_authorization_expiry: true },
        created_at: op.createdAt, updated_at: op.updatedAt, expires_at: i.expiresAt, next_actions: facilitatorNextActions(op),
    };
}
export function facilitatorReceipt(op) {
    const body = { ...publicFacilitatorOperation(op), schema_version: FACILITATOR_RECEIPT_VERSION, operation_binding_hash: op.integrityHash };
    return { ...body, receipt_hash: hashObject(body) };
}
function exchange(value) {
    return value === null ? null : { started_at: value.startedAt, outcome: value.outcome, response_hash: value.responseHash,
        transaction_hash: value.transactionHash };
}
//# sourceMappingURL=receipt.js.map