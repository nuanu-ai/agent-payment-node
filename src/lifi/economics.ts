import { hashObject } from "../canonical.js";
import type { FeeEstimate } from "../ports.js";
import { validateEconomics } from "../transfer-policy.js";
import { bridgeNativePrincipal } from "./asset-registry.js";
import { bridgeDeployment } from "./deployments.js";
import type { BridgeAccountSnapshot, BridgeEnvelope, BridgeFeeCeiling, BridgeMaterialization, BridgeTransaction, DecodedBridgeCall } from "./model.js";
import { ApnError, type ErrorDetails } from "../errors.js";
import type { BridgeOperationRecord, BridgePreSignRpcCategory, BridgePreSignRpcFailure, BridgePreSignRpcMethod, BridgePreSignRpcStage } from "./operation-model.js";
import type { BridgeRpcPort } from "./ports.js";
import { approvalData } from "./transaction.js";
import { BRIDGE_FEE_HEADROOM_BPS, BRIDGE_FEE_HEADROOM_POLICY, BRIDGE_MAX_GAS, BRIDGE_MIN_REMAINING_MS,
  bridgeFailure, bridgeHeadroomWei, bridgeUint } from "./validation.js";

/**
 * Raises one quoted EIP-1559 price pair to the maximum the owner approves. The returned prices are what the
 * envelope freezes, what custody signs, what bounds the debit on chain and what the approval screen shows; the
 * quoted pair is kept beside them so the disclosure can state both the quote and the stated headroom.
 */
export function bridgeApprovedPrices(fees: Pick<FeeEstimate, "maxFeePerGasAtomic" | "maxPriorityFeePerGasAtomic">): {
  readonly maxFeePerGasAtomic: string; readonly maxPriorityFeePerGasAtomic: string; readonly feeCeiling: BridgeFeeCeiling;
} {
  return { maxFeePerGasAtomic: bridgeHeadroomWei(fees.maxFeePerGasAtomic),
    maxPriorityFeePerGasAtomic: bridgeHeadroomWei(fees.maxPriorityFeePerGasAtomic),
    feeCeiling: { policy: BRIDGE_FEE_HEADROOM_POLICY, headroomBps: BRIDGE_FEE_HEADROOM_BPS,
      quotedMaxFeePerGasAtomic: fees.maxFeePerGasAtomic, quotedMaxPriorityFeePerGasAtomic: fees.maxPriorityFeePerGasAtomic } };
}

/**
 * Whether this intent needs a separate approval effect. A native principal never does: its allowance is the constant
 * zero, its approval cap is zero and the principal is the bridge transaction's value. A token needs one from zero.
 */
export function bridgeApprovalRequired(request: BridgeMaterialization["request"], allowanceAtomic: string): boolean {
  if (bridgeNativePrincipal(request)) {
    if (allowanceAtomic !== "0") bridgeFailure("APN_STATE_CORRUPT", "native_principal_allowance");
    return false;
  }
  return allowanceAtomic === "0";
}
export const BRIDGE_DEPLOYMENT_PROOF_VERIFIER = "apn.bridge.deployment-proof.base-stargate-ecotone.v1" as const;
export const BRIDGE_DEPLOYMENT_PROOF_POLICY_CUTOVER = "2026-09-22T05:47:00.000Z" as const;
export function legacyBridgeApprovalPolicyHash(materialization: Pick<BridgeMaterialization, "request">): string {
  return hashObject({ identity: "apn.bridge.foreground-approval.v1", request: materialization.request });
}
export function bridgeApprovalPolicyHash(materialization: Pick<BridgeMaterialization, "tool" | "request">): string {
  const request = materialization.request, retainedProof = materialization.tool === "stargateV2" &&
    [8453, 42161].includes(request.fromChainId) && [8453, 42161].includes(request.toChainId);
  return hashObject({ identity: "apn.bridge.foreground-approval.v1", request,
    ...(retainedProof ? { deploymentProofVerifier: BRIDGE_DEPLOYMENT_PROOF_VERIFIER } : {}) });
}
export function bridgeApprovalPolicyBinding(materialization: Pick<BridgeMaterialization, "tool" | "request">, policyHash: string,
  preparedAt: string): "deployment-proof-v1" | "full-refresh" | null {
  const current = bridgeApprovalPolicyHash(materialization), legacy = legacyBridgeApprovalPolicyHash(materialization);
  // Reuse authority exists only when the verifier made the current hash distinct from the historical policy hash.
  if (current !== legacy && policyHash === current) return "deployment-proof-v1";
  if (current === legacy && policyHash === current) return "full-refresh";
  if (policyHash === legacy && Date.parse(preparedAt) < Date.parse(BRIDGE_DEPLOYMENT_PROOF_POLICY_CUTOVER)) return "full-refresh";
  return null;
}
/** The part of a native debit that is the principal itself: excluded from the fee cap, included in the funding check. */
export function bridgeNativePrincipalWei(request: BridgeMaterialization["request"]): bigint {
  return bridgeNativePrincipal(request) ? BigInt(request.amountAtomic) : 0n;
}

type FeeBudgetValue = bigint | string | undefined;

/**
 * Keeps fee guard diagnostics to bounded decimal values and a local predicate. Provider payloads, addresses,
 * calldata, RPC origins and transport details never cross this boundary.
 */
function feeBudgetDetails(offendingPredicate: string, values: Readonly<Record<string, FeeBudgetValue>>): ErrorDetails {
  const details: Record<string, string> = { offendingPredicate };
  for (const [key, value] of Object.entries(values)) if (value !== undefined) details[key] = typeof value === "bigint" ? value.toString() : value;
  return details;
}

function aggregateFeeBudgetDetails(effects: readonly BridgeEnvelope[], principal: bigint, maxNativeDebitWei: string,
  sourceBalanceWei?: string): ErrorDetails {
  const feeQuoteTotalWei = effects.reduce((sum, effect) => sum + BigInt(effect.feeQuote.totalQuoteWei), 0n);
  const effectValueWei = effects.reduce((sum, effect) => sum + BigInt(effect.valueAtomic), 0n);
  const aggregateDebitWei = feeQuoteTotalWei + effectValueWei;
  const same = (pick: (effect: BridgeEnvelope) => string): string | undefined => {
    const values = effects.map(pick);
    return values.length > 0 && values.every((value) => value === values[0]) ? values[0] : undefined;
  };
  return feeBudgetDetails("feeDebitWei > maxNativeDebitWei", {
    gasLimitAtomic: same((effect) => effect.economics.gasLimitAtomic),
    maxFeePerGasAtomic: same((effect) => effect.economics.maxFeePerGasAtomic),
    maxPriorityFeePerGasAtomic: same((effect) => effect.economics.maxPriorityFeePerGasAtomic),
    feeQuoteTotalWei, nativePrincipalWei: principal, feeDebitWei: aggregateDebitWei - principal,
    effectValueWei, aggregateDebitWei, maxNativeDebitWei, sourceBalanceWei,
    sourceBalanceFloorWei: sourceBalanceWei === undefined ? undefined : aggregateDebitWei,
  });
}

function feeEstimateDetails(offendingPredicate: string, estimatedGasAtomic: string, gasLimitAtomic: string,
  maxFeePerGasAtomic: string, maxPriorityFeePerGasAtomic: string, extra: Readonly<Record<string, FeeBudgetValue>> = {}): ErrorDetails {
  return feeBudgetDetails(offendingPredicate, { estimatedGasAtomic, gasLimitAtomic, maxFeePerGasAtomic,
    maxPriorityFeePerGasAtomic, ...extra });
}

export async function freezeBridgeEnvelopes(m: BridgeMaterialization, account: BridgeAccountSnapshot, rpc: BridgeRpcPort): Promise<readonly BridgeEnvelope[]> {
  const amount = BigInt(m.request.amountAtomic), allowance = BigInt(account.allowanceAtomic);
  const approval = bridgeApprovalRequired(m.request, account.allowanceAtomic), principal = bridgeNativePrincipalWei(m.request);
  if (allowance !== 0n && allowance !== amount) bridgeFailure("APN_PERMISSION_ALLOWANCE_INSUFFICIENT", "residual_allowance_review_required");
  if (account.pendingNonceAtomic !== account.latestNonceAtomic) bridgeFailure("APN_OPERATION_BLOCKED", "pending_source_nonce");
  if (BigInt(account.balanceAtomic) < amount) bridgeFailure("APN_INSUFFICIENT_ASSET", "source_asset_balance",
    bridgeNativePrincipal(m.request) ? feeBudgetDetails("sourceBalanceWei < sourceBalanceFloorWei",
      { sourceBalanceWei: account.balanceAtomic, sourceBalanceFloorWei: amount }) : undefined);
  const drafts: Array<Omit<BridgeEnvelope, "feeQuote" | "envelopeHash">> = [];
  if (approval) {
    const transaction: BridgeTransaction = { chainId: m.request.fromChainId, from: m.sender, to: m.request.fromToken,
      data: approvalData(m.approvalAddress, m.request.amountAtomic), valueAtomic: "0", gasLimitAtomic: "0" };
    const fees = await rpc.estimate(transaction), approved = bridgeApprovedPrices(fees);
    const economics = validateEconomics(account.latestNonceAtomic, { ...fees, ...approved });
    if (BigInt(economics.gasLimitAtomic) > BRIDGE_MAX_GAS) bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "approval_gas_ceiling",
      feeEstimateDetails("gasLimitAtomic > maxGasLimitAtomic", fees.gasLimitAtomic, economics.gasLimitAtomic,
        economics.maxFeePerGasAtomic, economics.maxPriorityFeePerGasAtomic, { maxGasLimitAtomic: BRIDGE_MAX_GAS }));
    const body = { role: "approval" as const, ...transaction, economics, provisionalGas: false, feeCeiling: approved.feeCeiling };
    const { gasLimitAtomic: _gas, ...envelope } = body;
    drafts.push(envelope);
  }
  const fees = approval ? { ...await rpc.prices(), gasLimitAtomic: m.transaction.gasLimitAtomic } : await rpc.estimate(m.transaction);
  if (bridgeUint(fees.gasLimitAtomic, true) > BigInt(m.transaction.gasLimitAtomic)) bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "bridge_estimate_over_ceiling",
    feeEstimateDetails("estimatedGasAtomic > gasLimitAtomic", fees.gasLimitAtomic, m.transaction.gasLimitAtomic,
      fees.maxFeePerGasAtomic, fees.maxPriorityFeePerGasAtomic));
  const approved = bridgeApprovedPrices(fees);
  const economics = validateEconomics((BigInt(account.latestNonceAtomic) + BigInt(drafts.length)).toString(),
    { ...fees, ...approved, gasLimitAtomic: m.transaction.gasLimitAtomic });
  const { gasLimitAtomic: _gas, ...transaction } = m.transaction;
  drafts.push({ role: "bridge" as const, ...transaction, economics, provisionalGas: approval, feeCeiling: approved.feeCeiling });
  const feeInputs = drafts.map((draft) => ({ economics: draft.economics }));
  const quotes = rpc.feeQuotes === undefined ? await Promise.all(feeInputs.map(async (input) => await rpc.feeQuote(input))) : await rpc.feeQuotes(feeInputs);
  if (quotes.length !== drafts.length) bridgeFailure("APN_RPC_PROTOCOL", "bridge_fee_quote_count");
  const effects = drafts.map((draft, index) => {
    const body = { ...draft, feeQuote: quotes[index]! };
    return { ...body, envelopeHash: hashObject(body) };
  });
  const total = effects.reduce((sum, e) => sum + BigInt(e.feeQuote.totalQuoteWei) + BigInt(e.valueAtomic), 0n);
  if (total - principal > BigInt(m.request.maxNativeDebitWei)) bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "aggregate_native_debit",
    aggregateFeeBudgetDetails(effects, principal, m.request.maxNativeDebitWei, account.nativeBalanceWei));
  if (total > BigInt(account.nativeBalanceWei)) bridgeFailure("APN_INSUFFICIENT_GAS", "aggregate_native_funding",
    { ...aggregateFeeBudgetDetails(effects, principal, m.request.maxNativeDebitWei, account.nativeBalanceWei), ...feeBudgetDetails("aggregateDebitWei > sourceBalanceWei",
      { sourceBalanceWei: account.nativeBalanceWei, sourceBalanceFloorWei: total }) });
  return effects;
}
export function bridgeExpiry(m: BridgeMaterialization, decoded: DecodedBridgeCall, account: BridgeAccountSnapshot, preparedAt: string, now: number): string {
  let expires = BigInt(Date.parse(preparedAt)) + 300_000n;
  if (decoded.protocol.kind === "across") {
    const contract = bridgeDeployment(m.request.fromChainId, m.request.toChainId, m.tool, m.request.fromToken), p = decoded.protocol;
    if (contract.quoteTimeBufferAtomic === null || contract.fillDeadlineBufferAtomic === null) bridgeFailure("APN_PROVIDER_PROTOCOL", "across_time_contract");
    assertProtocolTime(m, decoded, account);
    for (const candidate of [(BigInt(p.quoteTimestamp) + BigInt(contract.quoteTimeBufferAtomic)) * 1000n, BigInt(p.fillDeadline) * 1000n]) if (candidate < expires) expires = candidate;
    if (decoded.composite !== undefined) {
      const flyDeadline = BigInt(decoded.composite.deadlineAtomic) * 1000n;
      if (flyDeadline < expires) expires = flyDeadline;
    }
  }
  if (expires > BigInt(Number.MAX_SAFE_INTEGER) || expires - BigInt(now) < BigInt(BRIDGE_MIN_REMAINING_MS)) bridgeFailure("APN_REPREPARE_REQUIRED", "bridge_validity_remaining");
  return new Date(Number(expires)).toISOString();
}
function assertProtocolTime(m: BridgeMaterialization, decoded: DecodedBridgeCall, account: BridgeAccountSnapshot): void {
  if (decoded.protocol.kind !== "across") return;
  const p = decoded.protocol, contract = bridgeDeployment(m.request.fromChainId, m.request.toChainId, m.tool, m.request.fromToken), now = BigInt(account.block.timestampAtomic);
  if (contract.quoteTimeBufferAtomic === null || contract.fillDeadlineBufferAtomic === null ||
    BigInt(p.quoteTimestamp) > now || now - BigInt(p.quoteTimestamp) > BigInt(contract.quoteTimeBufferAtomic) ||
    now >= BigInt(p.fillDeadline) || BigInt(p.fillDeadline) > now + BigInt(contract.fillDeadlineBufferAtomic)) bridgeFailure("APN_REPREPARE_REQUIRED", "across_protocol_validity");
  if (decoded.composite !== undefined && (now >= BigInt(decoded.composite.deadlineAtomic) || BigInt(decoded.composite.deadlineAtomic) > BigInt(p.fillDeadline))) {
    bridgeFailure("APN_REPREPARE_REQUIRED", "fly_deadline_validity");
  }
}
export function assertBridgeRemaining(op: BridgeOperationRecord, now: number): void {
  if (Date.parse(op.intent.expiresAt) - now < BRIDGE_MIN_REMAINING_MS) bridgeFailure("APN_REPREPARE_REQUIRED", "bridge_validity_remaining");
}
const PRE_SIGN_RPC_METHODS = new Set<BridgePreSignRpcMethod>(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode",
  "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "debug_traceTransaction"]);
async function preSignRpc<T>(input: Omit<BridgePreSignRpcFailure, "schemaVersion" | "phase" | "method">, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (!(error instanceof ApnError) || error.code !== "APN_RPC_AMBIGUOUS") throw error;
    const candidate = error.details?.rpcMethod;
    const method = typeof candidate === "string" && PRE_SIGN_RPC_METHODS.has(candidate as BridgePreSignRpcMethod)
      ? candidate as BridgePreSignRpcMethod : null;
    const context: BridgePreSignRpcFailure = { schemaVersion: "apn.bridge-presign-rpc-failure.v1", phase: "pre_sign_guard", ...input, method };
    throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge pre-sign RPC transport is unavailable.", {
      rpcStage: context.stage, rpcChainRole: context.chainRole, rpcChainId: context.chainId.toString(),
      rpcCategory: context.category, ...(method === null ? {} : { rpcMethod: method }), effectRole: context.effectRole,
    });
  }
}
function rpcBoundary(role: "approval" | "bridge", stage: BridgePreSignRpcStage, chainRole: "source" | "destination",
  chainId: number, category: BridgePreSignRpcCategory) {
  return { effectRole: role, stage, chainRole, chainId, category } as const;
}
export async function guardBridgeEffect(op: BridgeOperationRecord, role: "approval" | "bridge", source: BridgeRpcPort, destination: BridgeRpcPort, now: () => number): Promise<void> {
  assertBridgeRemaining(op, now());
  const i = op.intent, m = i.materialization, effect = op.effects.find((e) => e.role === role);
  const proofBinding = bridgeApprovalPolicyBinding(m, i.policyHash, i.preparedAt);
  if (proofBinding === null) bridgeFailure("APN_STATE_CORRUPT", "bridge_deployment_proof_verifier_changed");
  if (op.terminal || effect === undefined || effect.submissionAttempts !== 0) bridgeFailure("APN_OPERATION_BLOCKED", "bridge_first_send_only");
  if (source.origin !== i.sourceRpcOrigin || destination.origin !== i.destinationRpcOrigin || source.chainId !== m.request.fromChainId ||
    destination.chainId !== m.request.toChainId) bridgeFailure("APN_RPC_CONFIG", "bridge_frozen_RPC_origin");
  const [sourceDeployment, destinationDeployment] = await Promise.all([
    preSignRpc(rpcBoundary(role, "source_deployment_refresh", "source", source.chainId, "deployment_refresh"),
      async () => await (proofBinding === "deployment-proof-v1" ? source.refreshDeployment?.(m.tool, m.request.toChainId, m.request.fromToken,
        i.sourceDeployment) ?? source.deployment(m.tool, m.request.toChainId, m.request.fromToken)
        : source.deployment(m.tool, m.request.toChainId, m.request.fromToken))),
    preSignRpc(rpcBoundary(role, "destination_deployment_refresh", "destination", destination.chainId, "deployment_refresh"),
      async () => await (proofBinding === "deployment-proof-v1" ? destination.refreshDeployment?.(m.tool, m.request.fromChainId, m.request.toToken,
        i.destinationDeployment) ?? destination.deployment(m.tool, m.request.fromChainId, m.request.toToken)
        : destination.deployment(m.tool, m.request.fromChainId, m.request.toToken))),
  ]);
  for (const [frozen, current] of [[i.sourceDeployment, sourceDeployment], [i.destinationDeployment, destinationDeployment]] as const) {
    if (current.contractHash !== frozen.contractHash || current.codeHash !== frozen.codeHash || current.configurationHash !== frozen.configurationHash) bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_drift");
  }
  const envelope = effect.envelope, c = envelope.economics;
  const account = await preSignRpc(rpcBoundary(role, "source_account_refresh", "source", source.chainId, "account_nonce"),
    async () => await source.account(m.sender, m.approvalAddress, m.request.fromToken, [{ chainId: envelope.chainId, from: envelope.from,
      to: envelope.to, data: envelope.data, valueAtomic: envelope.valueAtomic, gasLimitAtomic: c.gasLimitAtomic }]));
  assertProtocolTime(m, i.decoded, account);
  if (account.latestNonceAtomic !== c.nonceAtomic || account.pendingNonceAtomic !== c.nonceAtomic) bridgeFailure("APN_OPERATION_BLOCKED", "bridge_nonce_changed");
  const expectedAllowance = role === "approval" || bridgeNativePrincipal(m.request) ? "0" : m.request.amountAtomic;
  if (account.allowanceAtomic !== expectedAllowance) bridgeFailure("APN_PERMISSION_ALLOWANCE_INSUFFICIENT", "bridge_exact_allowance_changed");
  if (BigInt(account.balanceAtomic) < BigInt(m.request.amountAtomic)) bridgeFailure("APN_INSUFFICIENT_ASSET", "source_asset_balance");
  const estimate = await preSignRpc(rpcBoundary(role, "source_execution_simulation", "source", source.chainId, "simulation"),
    async () => await source.estimate({ chainId: envelope.chainId, from: envelope.from, to: envelope.to, data: envelope.data,
      valueAtomic: envelope.valueAtomic, gasLimitAtomic: c.gasLimitAtomic }));
  // `c` is the owner-approved maximum: the preparation quote raised by the stated headroom. A fresh estimate inside
  // that maximum proceeds on the signed envelope; only an estimate above the approved maximum ends the operation.
  if (bridgeUint(estimate.gasLimitAtomic, true) > BigInt(c.gasLimitAtomic)) bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "fresh_execution_estimate_over_cap",
    feeEstimateDetails("estimatedGasAtomic > gasLimitAtomic", estimate.gasLimitAtomic, c.gasLimitAtomic,
      estimate.maxFeePerGasAtomic, estimate.maxPriorityFeePerGasAtomic, { feeQuoteTotalWei: envelope.feeQuote.totalQuoteWei }));
  if (BigInt(estimate.maxFeePerGasAtomic) > BigInt(c.maxFeePerGasAtomic)) bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "fresh_execution_estimate_over_cap",
    feeEstimateDetails("maxFeePerGasAtomic > maxFeePerGasCeilingAtomic", estimate.gasLimitAtomic, c.gasLimitAtomic,
      estimate.maxFeePerGasAtomic, estimate.maxPriorityFeePerGasAtomic, {
        maxFeePerGasCeilingAtomic: c.maxFeePerGasAtomic, maxPriorityFeePerGasCeilingAtomic: c.maxPriorityFeePerGasAtomic,
        feeQuoteTotalWei: envelope.feeQuote.totalQuoteWei,
      }));
  if (BigInt(estimate.maxPriorityFeePerGasAtomic) > BigInt(c.maxPriorityFeePerGasAtomic)) bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "fresh_execution_estimate_over_cap",
    feeEstimateDetails("maxPriorityFeePerGasAtomic > maxPriorityFeePerGasCeilingAtomic", estimate.gasLimitAtomic, c.gasLimitAtomic,
      estimate.maxFeePerGasAtomic, estimate.maxPriorityFeePerGasAtomic, {
        maxFeePerGasCeilingAtomic: c.maxFeePerGasAtomic, maxPriorityFeePerGasCeilingAtomic: c.maxPriorityFeePerGasAtomic,
        feeQuoteTotalWei: envelope.feeQuote.totalQuoteWei,
      }));
  let paid = 0n, unpaid = 0n;
  for (const e of op.effects) {
    if (e.submissionAttempts === 1) {
      const proof = e.safeProof ?? e.includedProof;
      if (proof === null || proof.status !== "success") bridgeFailure("APN_OPERATION_BLOCKED", "earlier_effect_unresolved");
      paid += BigInt(proof.actualTotalFeeWei) + BigInt(e.envelope.valueAtomic);
    } else {
      const quote = await preSignRpc(rpcBoundary(role, "source_fee_quote", "source", source.chainId, "fee_quote"),
        async () => await source.feeQuote(e.envelope));
      if (quote.chainId !== e.envelope.chainId || quote.rpcOrigin !== i.sourceRpcOrigin ||
        quote.maximumExecutionFeeWei !== e.envelope.economics.maximumGasCostAtomic) bridgeFailure("APN_RPC_PROTOCOL", "fresh_fee_quote_identity");
      unpaid += BigInt(quote.totalQuoteWei) + BigInt(e.envelope.valueAtomic);
    }
  }
  const freshPrincipal = bridgeNativePrincipalWei(m.request), freshAggregateDebit = paid + unpaid;
  if (freshAggregateDebit - freshPrincipal > BigInt(m.request.maxNativeDebitWei)) {
    const unpaidQuoteTotal = op.effects.every((effect) => effect.submissionAttempts === 0)
      ? unpaid - op.effects.reduce((sum, effect) => sum + BigInt(effect.envelope.valueAtomic), 0n) : undefined;
    bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "fresh_aggregate_native_debit", {
      ...feeBudgetDetails("feeDebitWei > maxNativeDebitWei", {
        feeQuoteTotalWei: unpaidQuoteTotal, nativePrincipalWei: freshPrincipal, feeDebitWei: freshAggregateDebit - freshPrincipal,
        effectValueWei: op.effects.reduce((sum, effect) => sum + BigInt(effect.envelope.valueAtomic), 0n),
        aggregateDebitWei: freshAggregateDebit, maxNativeDebitWei: m.request.maxNativeDebitWei,
        sourceBalanceWei: account.nativeBalanceWei, sourceBalanceFloorWei: freshAggregateDebit,
      }),
    });
  }
  if (unpaid > BigInt(account.nativeBalanceWei)) bridgeFailure("APN_INSUFFICIENT_GAS", "fresh_native_funding", {
    ...feeBudgetDetails("aggregateDebitWei > sourceBalanceWei", {
      nativePrincipalWei: freshPrincipal, feeDebitWei: freshAggregateDebit - freshPrincipal,
      effectValueWei: op.effects.reduce((sum, effect) => sum + BigInt(effect.envelope.valueAtomic), 0n),
      aggregateDebitWei: freshAggregateDebit, maxNativeDebitWei: m.request.maxNativeDebitWei,
      sourceBalanceWei: account.nativeBalanceWei, sourceBalanceFloorWei: unpaid,
    }),
  });
  assertBridgeRemaining(op, now());
}
