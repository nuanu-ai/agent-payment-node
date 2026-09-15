import { hashObject } from "../canonical.js";
import { FACILITATOR_KIND, FACILITATOR_POLICY, FACILITATOR_RECEIPT_VERSION, type FacilitatorExchange,
  type FacilitatorOperationRecord } from "./operation-model.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
import { validateFacilitatorOperation } from "./transitions.js";

export function facilitatorNextActions(op: FacilitatorOperationRecord): readonly string[] {
  if (op.terminal) return op.state === "completed" ? [] : ["apn gasless transfer prepare --help"];
  if (op.state === "awaiting_approval") return [`apn gasless transfer approve --operation ${op.operationId}`];
  return [`apn operation resume --operation ${op.operationId}`];
}

export function facilitatorProofClass(op: FacilitatorOperationRecord): string {
  if (op.state === "completed") return "rpc_finalized_correlated";
  if (op.state === "expired_unused") return "rpc_finalized_unused";
  if (op.state === "abandoned_unknown") return "owner_acknowledgement_only";
  return op.verify === null ? "durable_pre_effect" : "effect_observation_pending";
}

export function publicFacilitatorOperation(op: FacilitatorOperationRecord) {
  validateFacilitatorOperation(op);
  const i = op.intent, signed = op.signed, settlement = op.settlement, a = signed?.authorization ?? null;
  return {
    kind: FACILITATOR_KIND, schema_version: op.schemaVersion, operation_id: op.operationId, profile: i.profile,
    provider: "local" as const, custody: "local_software" as const, route: "x402_exact_eip3009_public_facilitator" as const,
    fingerprint: op.fingerprint, state: op.state, terminal: op.terminal, proof_class: facilitatorProofClass(op),
    reason: op.failure ?? (op.state === "completed" ? "facilitator_gasless_delivery_correlated" : op.state),
    execution_owner: "public_facilitator" as const, retry_owner: "apn_observation_only_after_exposure" as const,
    evidence_owner: "configured_chain_rpc" as const,
    transfer: { chain_id: R.chainId, network: R.network, token: i.requirement.asset, symbol: "USDC" as const, decimals: R.decimals,
      sender: i.owner.address, recipient: i.request.recipient, gross_atomic: i.request.grossAtomic,
      user_max_fee_atomic: i.request.maxFeeAtomic, minimum_received_atomic: i.request.minReceivedAtomic,
      recipient_atomic: i.request.grossAtomic, frozen_fee_atomic: "0" as const,
      actual_delivered_atomic: settlement?.deliveredAtomic ?? null, actual_sender_debit_atomic: settlement?.deliveredAtomic ?? null,
      unused_gross_atomic: op.state === "expired_unused" ? i.request.grossAtomic : settlement === null ? null : "0" },
    fees: { token_fee_atomic: "0" as const, approved_sender_native_debit_wei: "0" as const,
      native_gas_payer: "public_facilitator" as const, paid_facilitator_tier: false },
    authorization: signed === null || a === null ? null : { standard: "EIP-3009" as const, method: "transferWithAuthorization" as const,
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

export function facilitatorReceipt(op: FacilitatorOperationRecord) {
  const body = { ...publicFacilitatorOperation(op), schema_version: FACILITATOR_RECEIPT_VERSION, operation_binding_hash: op.integrityHash };
  return { ...body, receipt_hash: hashObject(body) };
}
export type FacilitatorReceipt = ReturnType<typeof facilitatorReceipt>;

function exchange(value: FacilitatorExchange | null) {
  return value === null ? null : { started_at: value.startedAt, outcome: value.outcome, response_hash: value.responseHash,
    transaction_hash: value.transactionHash };
}
