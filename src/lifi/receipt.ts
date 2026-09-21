import { hashObject } from "../canonical.js";
import { BRIDGE_ASSET_REGISTRY, bridgeAssetRow, bridgeNativePrincipal } from "./asset-registry.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import { validateBridgeOperation } from "./operation-validation.js";
import { BRIDGE_FEE_HEADROOM_BPS, BRIDGE_FEE_HEADROOM_POLICY } from "./validation.js";
import type { LegacyBridgeOperationRecord, StoredBridgeOperationRecord } from "./legacy-operation.js";
import { isLegacyBridgeOperation } from "./legacy-operation.js";

export function bridgeNextActions(op: BridgeOperationRecord): readonly string[] {
  if (op.terminal) return op.state === "completed" ? [] : ["apn bridge prepare --help"];
  if (op.state === "awaiting_approval") return [`apn bridge approve --operation ${op.operationId}`];
  return [`apn operation resume --operation ${op.operationId}`, `apn operation status --operation ${op.operationId}`];
}
export function bridgeProofClass(op: BridgeOperationRecord): string {
  if (op.state === "completed") return "rpc_safe_correlated";
  if (op.state === "destination_failed") return "rpc_safe_destination_terminal";
  if (op.state === "failed_confirmed_revert" || op.state === "failed_after_approval") return "rpc_safe_source";
  if (op.effects.some((e) => e.submissionAttempts === 1)) return "effect_observation_pending";
  return "durable_pre_effect";
}
export function publicBridgeOperation(op: BridgeOperationRecord) {
  validateBridgeOperation(op);
  return projectBridgeOperation(op, false);
}
function projectBridgeOperation(op: BridgeOperationRecord, legacy: boolean) {
  const i = op.intent, m = i.materialization;
  const fromAsset = bridgeAssetRow(m.request.fromChainId, m.request.fromToken, "APN_STATE_CORRUPT");
  const toAsset = bridgeAssetRow(m.request.toChainId, m.request.toToken, "APN_STATE_CORRUPT");
  const from = assetProjection(m.request.fromChainId, m.request.fromToken);
  const to = assetProjection(m.request.toChainId, m.request.toToken);
  const sameDenomination = fromAsset.pairKey === toAsset.pairKey && fromAsset.decimals === toAsset.decimals;
  const nativePrincipal = bridgeNativePrincipal(m.request);
  const assetBounds = {
    binding: "intent.materialization.request" as const,
    same_denomination: sameDenomination,
    source: { chain: from.chain, asset: from.token, symbol: from.symbol, decimals: from.decimals,
      principal_debit_atomic: m.request.amountAtomic, route_fee_cap_atomic: m.request.maxRouteFeeAtomic,
      route_fee_included_in_principal: true,
      native_execution_fee_cap_atomic: m.request.maxNativeDebitWei,
      maximum_total_native_debit_atomic: nativePrincipal
        ? (BigInt(m.request.amountAtomic) + BigInt(m.request.maxNativeDebitWei)).toString() : null },
    destination: { chain: to.chain, asset: to.token, symbol: to.symbol, decimals: to.decimals,
      expected_output_atomic: m.quotedOutputAtomic, minimum_output_atomic: m.minimumOutputAtomic,
      owner_minimum_output_atomic: m.request.minOutputAtomic },
  };
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
      lifi_transaction_id: i.decoded.transactionId, included_step_identities: m.includedStepIdentities,
      ...(i.decoded.composite === undefined ? {} : { composite: { kind: i.decoded.composite.kind,
        payload_hash: i.decoded.composite.payloadHash, message_hash: i.decoded.composite.messageHash,
        input_amount_atomic: i.decoded.composite.inputAmountAtomic, deadline_atomic: i.decoded.composite.deadlineAtomic,
        maximum_retention_bps: i.decoded.composite.maximumRetentionBps,
        recovery: "unswapped_WETH_is_not_native_BNB_success" as const } }) },
    asset: { from, to, native_principal_admitted: nativePrincipal },
    ...(legacy ? {} : { asset_bounds: assetBounds }),
    transfer: { ...m.request, sender: m.sender, quoted_output_atomic: m.quotedOutputAtomic,
      minimum_output_atomic: m.minimumOutputAtomic, actual_source_atomic: op.sourceProof?.sourceAmountAtomic ?? null,
      actual_output_atomic: op.destinationProof?.amountAtomic ?? null, allowance_atomic_at_prepare: i.sourceAccount.allowanceAtomic,
      spender: m.approvalAddress },
    fees: { declared: m.feeCosts, implicit_protocol_token_fee_atomic: i.implicitProtocolFeeAtomic,
      fee_headroom: { policy: BRIDGE_FEE_HEADROOM_POLICY, headroom_bps: BRIDGE_FEE_HEADROOM_BPS,
        approved_maximum_execution_fee_wei: effects.reduce((sum, e) => sum + BigInt(e.economics.maximumGasCostAtomic), 0n).toString(),
        quoted_execution_fee_wei: effects.reduce((sum, e) => sum + BigInt(e.economics.gasLimitAtomic) * BigInt(e.fee_ceiling.quotedMaxFeePerGasAtomic), 0n).toString(),
        statement: "Prices are quoted at preparation and raised by this stated headroom. You approve the maximum, not the quote: the signed envelope, the native debit cap and the pre-send check all use the maximum, and a fresh estimate above it refuses the send instead of repricing it." },
      token_loss_bound_atomic: sameDenomination
        ? (BigInt(m.request.amountAtomic) - BigInt(m.minimumOutputAtomic)).toString() : null,
      native_debit_cap_wei: m.request.maxNativeDebitWei, total_native_fee_enforced_onchain: false,
      native_value_refund_verified: false, approval_gas_nonrefundable: true,
      known_source_fees_wei: knownFees, actual_source_fees_wei: unresolvedFees.length === 0 ? knownFees : null,
      unresolved_source_fee_effects: unresolvedFees.map((e) => ({ role: e.role, transaction_hash: e.transaction_hash,
        quoted_fee_wei: e.fee_quote.totalQuoteWei, included_fee_wei: e.included_proof?.actualTotalFeeWei ?? null })) },
    effects, source_proof: op.sourceProof, destination_proof: op.destinationProof,
    provider_observation: op.providerObservation, residual_allowance: op.failure?.residualAllowance ?? null,
    ...(op.failure?.residualAllowanceStatus === undefined ? {} : { residual_allowance_status: op.failure.residualAllowanceStatus }),
    ...(op.failure?.preSignRpc === undefined ? {} : { pre_sign_rpc_failure: {
      schema_version: op.failure.preSignRpc.schemaVersion, phase: op.failure.preSignRpc.phase,
      effect_role: op.failure.preSignRpc.effectRole, stage: op.failure.preSignRpc.stage,
      chain_role: op.failure.preSignRpc.chainRole, chain_id: op.failure.preSignRpc.chainId,
      category: op.failure.preSignRpc.category, method: op.failure.preSignRpc.method,
    } }),
    ...(op.failure?.observationRpc === undefined ? {} : { observation_rpc_failure: {
      schema_version: op.failure.observationRpc.schemaVersion, stage: op.failure.observationRpc.stage,
      effect_role: op.failure.observationRpc.effectRole, code: op.failure.observationRpc.code,
      ...(op.failure.observationRpc.reason === undefined ? {} : { reason: op.failure.observationRpc.reason }),
      ...(op.failure.observationRpc.rpcMethod === undefined ? {} : { rpc_method: op.failure.observationRpc.rpcMethod }),
      ...(op.failure.observationRpc.httpStatus === undefined ? {} : { http_status: op.failure.observationRpc.httpStatus }),
      ...(op.failure.observationRpc.attempts === undefined ? {} : { attempts: op.failure.observationRpc.attempts }),
    } }),
    rpc_origins: { source: i.sourceRpcOrigin, destination: i.destinationRpcOrigin },
    deployments: { source: i.sourceDeployment, destination: i.destinationDeployment },
    policy: { identity: "apn.bridge.foreground-approval.v1", policy_hash: i.policyHash,
      ...(legacy ? {} : { allowlist: i.allowlist === null ? null : { schema_version: i.allowlist.schemaVersion, policy_digest: i.allowlist.policyDigest,
        policy_revision: i.allowlist.policyRevision, account: i.allowlist.account, self_recipient: i.allowlist.selfRecipient,
        chain: i.allowlist.chain, asset: i.allowlist.asset, amount_atomic: i.allowlist.amountAtomic,
        mechanism: i.allowlist.mechanism, reservation_id: op.usageLease?.reservationId ?? null } }),
      approved_at: op.approval?.approvedAt ?? null, expiry_enforced_before_first_send: true,
      inclusion_deadline: m.tool === "across" ? "protocol_fill_deadline" : "not_present_in_protocol" },
    created_at: op.createdAt, updated_at: op.updatedAt, expires_at: i.expiresAt,
    next_actions: bridgeNextActions(op),
  };
}
export type PublicBridgeOperation = ReturnType<typeof publicBridgeOperation>;
export type LegacyPublicBridgeOperation = Omit<PublicBridgeOperation, "schema_version" | "policy"> & {
  readonly schema_version: "apn.bridge-operation.legacy-view.v1";
  readonly policy: Omit<PublicBridgeOperation["policy"], "allowlist"> & {
    readonly allowlist: { readonly availability: "legacy_unknown"; readonly reservation_id: null };
  };
  readonly journal_compatibility: {
    readonly schema_version: "apn.bridge-operation.legacy-view.v1";
    readonly durable_schema_version: "apn.bridge-operation.v1";
    readonly resumable: false;
    readonly allowlist_binding: "legacy_unknown";
    readonly usage_lease: "legacy_unknown";
    readonly native_balance_proof: "recorded" | "legacy_unknown";
    readonly native_transfer_proof: "legacy_unknown";
  };
};
export type StoredPublicBridgeOperation = PublicBridgeOperation | LegacyPublicBridgeOperation;

export function publicLegacyBridgeOperation(op: LegacyBridgeOperationRecord): LegacyPublicBridgeOperation {
  const projected = projectBridgeOperation(op.raw, true);
  return { ...projected,
    schema_version: op.schemaVersion,
    policy: { ...projected.policy, allowlist: { availability: "legacy_unknown", reservation_id: null } },
    journal_compatibility: { schema_version: op.schemaVersion, durable_schema_version: op.durableSchemaVersion,
      resumable: false, allowlist_binding: op.compatibility.allowlistBinding, usage_lease: op.compatibility.usageLease,
      native_balance_proof: op.compatibility.nativeBalanceProof, native_transfer_proof: op.compatibility.nativeTransferProof },
    next_actions: op.terminal && op.state === "completed" ? [] : ["apn bridge prepare --help"] } as LegacyPublicBridgeOperation;
}
export function publicStoredBridgeOperation(op: StoredBridgeOperationRecord): StoredPublicBridgeOperation {
  return isLegacyBridgeOperation(op) ? publicLegacyBridgeOperation(op) : publicBridgeOperation(op);
}
/** Reconstructs the exact historical receipt projection for integrity checks only. */
export function legacyBridgeReceipt(op: LegacyBridgeOperationRecord): Record<string, unknown> {
  const body = { ...projectBridgeOperation(op.raw, true), schema_version: "apn.bridge-receipt.v1" as const,
    operation_binding_hash: op.raw.integrityHash };
  return { ...body, receipt_hash: hashObject(body) };
}
/** Exact receipt projections emitted by the two supported pre-upgrade writers. */
export function legacyBridgeReceiptCandidates(op: LegacyBridgeOperationRecord): readonly unknown[] {
  const latest = legacyBridgeReceipt(op);
  const olderBody = structuredClone(latest) as Record<string, any>;
  delete olderBody.receipt_hash;
  delete olderBody.asset.from.approval;
  delete olderBody.asset.to.approval;
  const older = { ...olderBody, receipt_hash: hashObject(olderBody) };
  return [latest, older];
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

/** Exact current-v1 receipt emitted before denomination-aware asset bounds were added. */
export function previousCurrentBridgeReceipt(op: BridgeOperationRecord): Record<string, unknown> {
  const previous = structuredClone(bridgeReceipt(op)) as Record<string, any>;
  delete previous.receipt_hash;
  delete previous.asset_bounds;
  previous.fees.token_loss_bound_atomic =
    (BigInt(op.intent.materialization.request.amountAtomic) - BigInt(op.intent.materialization.minimumOutputAtomic)).toString();
  return { ...previous, receipt_hash: hashObject(previous) };
}
export function currentBridgeReceiptCandidates(op: BridgeOperationRecord): readonly unknown[] {
  return [bridgeReceipt(op), previousCurrentBridgeReceipt(op)];
}
