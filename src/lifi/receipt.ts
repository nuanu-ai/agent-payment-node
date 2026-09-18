import { hashObject } from "../canonical.js";
import { BRIDGE_ASSET_REGISTRY, bridgeAssetRow, bridgeNativePrincipal } from "./asset-registry.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import { validateBridgeOperation } from "./operation-validation.js";
import { BRIDGE_FEE_HEADROOM_BPS, BRIDGE_FEE_HEADROOM_POLICY } from "./validation.js";

export function bridgeNextActions(op: BridgeOperationRecord): readonly string[] {
  if (op.terminal) return op.state === "completed" ? [] : ["apn bridge prepare --help"];
  if (op.state === "awaiting_approval") return [`apn bridge approve --operation ${op.operationId}`];
  return [`apn operation resume --operation ${op.operationId}`, `apn operation status --operation ${op.operationId}`];
}
export function bridgeProofClass(op: BridgeOperationRecord): string {
  if (op.state === "completed") return "rpc_safe_correlated";
  if (op.state === "failed_confirmed_revert" || op.state === "failed_after_approval") return "rpc_safe_source";
  if (op.effects.some((e) => e.submissionAttempts === 1)) return "effect_observation_pending";
  return "durable_pre_effect";
}
export function publicBridgeOperation(op: BridgeOperationRecord) {
  validateBridgeOperation(op);
  const i = op.intent, m = i.materialization;
  const effects = op.effects.map((e) => ({
    role: e.role, phase: e.phase, envelope_hash: e.envelope.envelopeHash, transaction_hash: e.transactionHash,
    submission_attempts: e.submissionAttempts, submitted_at: e.submittedAt,
    to: e.envelope.to, value_atomic: e.envelope.valueAtomic, economics: e.envelope.economics,
    fee_quote: e.envelope.feeQuote, gas_ceiling_provisional_at_consent: e.envelope.provisionalGas,
    fee_ceiling: e.envelope.feeCeiling,
    included_proof: e.includedProof, safe_proof: e.safeProof,
  }));
  const knownFees = effects.reduce((sum, e) => sum + BigInt((e.safe_proof ?? e.included_proof)?.actualTotalFeeWei ?? "0"), 0n).toString();
  const unresolvedFees = effects.filter((e) => e.submission_attempts === 1 && e.safe_proof === null);
  return {
    kind: "bridge_route" as const, schema_version: op.schemaVersion, operation_id: op.operationId,
    profile: i.profile, provider: "local" as const, custody: "local_software" as const,
    execution_owner: "apn", retry_owner: "apn_observation_only_after_first_send", evidence_owner: "configured_chain_rpc",
    fingerprint: op.fingerprint, state: op.state, terminal: op.terminal, proof_class: bridgeProofClass(op),
    reason: op.failure?.reason ?? (op.state === "completed" ? "delivery_correlated" : op.state),
    route: { route_id: m.routeId, step_id: m.stepId, tool: m.tool, quote_hash: i.quoteHash,
      request_hash: m.requestHash, response_hash: m.responseHash, route_hash: m.routeHash, step_hash: m.stepHash,
      materialized_step_hash: m.materializedStepHash, transaction_digest: m.transactionDigest,
      lifi_transaction_id: i.decoded.transactionId, included_step_identities: m.includedStepIdentities },
    asset: { from: assetProjection(m.request.fromChainId, m.request.fromToken),
      to: assetProjection(m.request.toChainId, m.request.toToken), native_principal_admitted: bridgeNativePrincipal(m.request) },
    transfer: { ...m.request, sender: m.sender, quoted_output_atomic: m.quotedOutputAtomic,
      minimum_output_atomic: m.minimumOutputAtomic, actual_source_atomic: op.sourceProof?.sourceAmountAtomic ?? null,
      actual_output_atomic: op.destinationProof?.amountAtomic ?? null, allowance_atomic_at_prepare: i.sourceAccount.allowanceAtomic,
      spender: m.approvalAddress },
    fees: { declared: m.feeCosts, implicit_protocol_token_fee_atomic: i.implicitProtocolFeeAtomic,
      fee_headroom: { policy: BRIDGE_FEE_HEADROOM_POLICY, headroom_bps: BRIDGE_FEE_HEADROOM_BPS,
        approved_maximum_execution_fee_wei: effects.reduce((sum, e) => sum + BigInt(e.economics.maximumGasCostAtomic), 0n).toString(),
        quoted_execution_fee_wei: effects.reduce((sum, e) => sum + BigInt(e.economics.gasLimitAtomic) * BigInt(e.fee_ceiling.quotedMaxFeePerGasAtomic), 0n).toString(),
        statement: "Prices are quoted at preparation and raised by this stated headroom. You approve the maximum, not the quote: the signed envelope, the native debit cap and the pre-send check all use the maximum, and a fresh estimate above it refuses the send instead of repricing it." },
      token_loss_bound_atomic: (BigInt(m.request.amountAtomic) - BigInt(m.minimumOutputAtomic)).toString(),
      native_debit_cap_wei: m.request.maxNativeDebitWei, total_native_fee_enforced_onchain: false,
      native_value_refund_verified: false, approval_gas_nonrefundable: true,
      known_source_fees_wei: knownFees, actual_source_fees_wei: unresolvedFees.length === 0 ? knownFees : null,
      unresolved_source_fee_effects: unresolvedFees.map((e) => ({ role: e.role, transaction_hash: e.transaction_hash,
        quoted_fee_wei: e.fee_quote.totalQuoteWei, included_fee_wei: e.included_proof?.actualTotalFeeWei ?? null })) },
    effects, source_proof: op.sourceProof, destination_proof: op.destinationProof,
    provider_observation: op.providerObservation, residual_allowance: op.failure?.residualAllowance ?? null,
    rpc_origins: { source: i.sourceRpcOrigin, destination: i.destinationRpcOrigin },
    deployments: { source: i.sourceDeployment, destination: i.destinationDeployment },
    policy: { identity: "apn.bridge.foreground-approval.v1", policy_hash: i.policyHash,
      approved_at: op.approval?.approvedAt ?? null, expiry_enforced_before_first_send: true,
      inclusion_deadline: m.tool === "across" ? "protocol_fill_deadline" : "not_present_in_protocol" },
    created_at: op.createdAt, updated_at: op.updatedAt, expires_at: i.expiresAt,
    next_actions: bridgeNextActions(op),
  };
}
function assetProjection(chainId: BridgeOperationRecord["intent"]["materialization"]["request"]["fromChainId"], token: `0x${string}`) {
  const row = BRIDGE_ASSET_REGISTRY[chainId], asset = bridgeAssetRow(chainId, token, "APN_STATE_CORRUPT");
  return { chain: row.caip2, token: asset.kind === "native" ? "native" : asset.address, symbol: asset.symbol, coin_key: asset.coinKey,
    decimals: asset.decimals, upgradeability: asset.kind === "native" ? "native_coin" : asset.code.upgradeability,
    approval: asset.kind === "native" ? "none_value_transfer" : asset.approval,
    native_coin: { symbol: row.nativeCoin.symbol, decimals: row.nativeCoin.decimals } };
}
export function bridgeReceipt(op: BridgeOperationRecord) {
  const body = { ...publicBridgeOperation(op), schema_version: "apn.bridge-receipt.v1" as const, operation_binding_hash: op.integrityHash };
  return { ...body, receipt_hash: hashObject(body) };
}
export type BridgeReceipt = ReturnType<typeof bridgeReceipt>;
