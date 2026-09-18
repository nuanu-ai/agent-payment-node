import { hashObject } from "../canonical.js";
import { validateEconomics } from "../transfer-policy.js";
import { bridgeNativePrincipal } from "./asset-registry.js";
import { bridgeDeployment } from "./deployments.js";
import { approvalData } from "./transaction.js";
import { BRIDGE_FEE_HEADROOM_BPS, BRIDGE_FEE_HEADROOM_POLICY, BRIDGE_MAX_GAS, BRIDGE_MIN_REMAINING_MS, bridgeFailure, bridgeHeadroomWei, bridgeUint } from "./validation.js";
/**
 * Raises one quoted EIP-1559 price pair to the maximum the owner approves. The returned prices are what the
 * envelope freezes, what custody signs, what bounds the debit on chain and what the approval screen shows; the
 * quoted pair is kept beside them so the disclosure can state both the quote and the stated headroom.
 */
export function bridgeApprovedPrices(fees) {
    return { maxFeePerGasAtomic: bridgeHeadroomWei(fees.maxFeePerGasAtomic),
        maxPriorityFeePerGasAtomic: bridgeHeadroomWei(fees.maxPriorityFeePerGasAtomic),
        feeCeiling: { policy: BRIDGE_FEE_HEADROOM_POLICY, headroomBps: BRIDGE_FEE_HEADROOM_BPS,
            quotedMaxFeePerGasAtomic: fees.maxFeePerGasAtomic, quotedMaxPriorityFeePerGasAtomic: fees.maxPriorityFeePerGasAtomic } };
}
/**
 * Whether this intent needs a separate approval effect. A native principal never does: its allowance is the constant
 * zero, its approval cap is zero and the principal is the bridge transaction's value. A token needs one from zero.
 */
export function bridgeApprovalRequired(request, allowanceAtomic) {
    if (bridgeNativePrincipal(request)) {
        if (allowanceAtomic !== "0")
            bridgeFailure("APN_STATE_CORRUPT", "native_principal_allowance");
        return false;
    }
    return allowanceAtomic === "0";
}
/** The part of a native debit that is the principal itself: excluded from the fee cap, included in the funding check. */
export function bridgeNativePrincipalWei(request) {
    return bridgeNativePrincipal(request) ? BigInt(request.amountAtomic) : 0n;
}
export async function freezeBridgeEnvelopes(m, account, rpc) {
    const amount = BigInt(m.request.amountAtomic), allowance = BigInt(account.allowanceAtomic);
    const approval = bridgeApprovalRequired(m.request, account.allowanceAtomic), principal = bridgeNativePrincipalWei(m.request);
    if (allowance !== 0n && allowance !== amount)
        bridgeFailure("APN_PERMISSION_ALLOWANCE_INSUFFICIENT", "residual_allowance_review_required");
    if (account.pendingNonceAtomic !== account.latestNonceAtomic)
        bridgeFailure("APN_OPERATION_BLOCKED", "pending_source_nonce");
    if (BigInt(account.balanceAtomic) < amount)
        bridgeFailure("APN_INSUFFICIENT_ASSET", "source_asset_balance");
    const effects = [];
    if (approval) {
        const transaction = { chainId: m.request.fromChainId, from: m.sender, to: m.request.fromToken,
            data: approvalData(m.approvalAddress, m.request.amountAtomic), valueAtomic: "0", gasLimitAtomic: "0" };
        const fees = await rpc.estimate(transaction), approved = bridgeApprovedPrices(fees);
        const economics = validateEconomics(account.latestNonceAtomic, { ...fees, ...approved });
        if (BigInt(economics.gasLimitAtomic) > BRIDGE_MAX_GAS)
            bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "approval_gas_ceiling");
        const body = { role: "approval", ...transaction, economics, feeQuote: await rpc.feeQuote({ economics }),
            provisionalGas: false, feeCeiling: approved.feeCeiling };
        const { gasLimitAtomic: _gas, ...envelope } = body;
        effects.push({ ...envelope, envelopeHash: hashObject(envelope) });
    }
    const fees = approval ? { ...await rpc.prices(), gasLimitAtomic: m.transaction.gasLimitAtomic } : await rpc.estimate(m.transaction);
    if (bridgeUint(fees.gasLimitAtomic, true) > BigInt(m.transaction.gasLimitAtomic))
        bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "bridge_estimate_over_ceiling");
    const approved = bridgeApprovedPrices(fees);
    const economics = validateEconomics((BigInt(account.latestNonceAtomic) + BigInt(effects.length)).toString(), { ...fees, ...approved, gasLimitAtomic: m.transaction.gasLimitAtomic });
    const { gasLimitAtomic: _gas, ...transaction } = m.transaction;
    const body = { role: "bridge", ...transaction, economics, feeQuote: await rpc.feeQuote({ economics }),
        provisionalGas: approval, feeCeiling: approved.feeCeiling };
    effects.push({ ...body, envelopeHash: hashObject(body) });
    const total = effects.reduce((sum, e) => sum + BigInt(e.feeQuote.totalQuoteWei) + BigInt(e.valueAtomic), 0n);
    if (total - principal > BigInt(m.request.maxNativeDebitWei))
        bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "aggregate_native_debit");
    if (total > BigInt(account.nativeBalanceWei))
        bridgeFailure("APN_INSUFFICIENT_GAS", "aggregate_native_funding");
    return effects;
}
export function bridgeExpiry(m, decoded, account, preparedAt, now) {
    let expires = BigInt(Date.parse(preparedAt)) + 300000n;
    if (decoded.protocol.kind === "across") {
        const contract = bridgeDeployment(m.request.fromChainId, m.request.toChainId, m.tool, m.request.fromToken), p = decoded.protocol;
        if (contract.quoteTimeBufferAtomic === null || contract.fillDeadlineBufferAtomic === null)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "across_time_contract");
        assertProtocolTime(m, decoded, account);
        for (const candidate of [(BigInt(p.quoteTimestamp) + BigInt(contract.quoteTimeBufferAtomic)) * 1000n, BigInt(p.fillDeadline) * 1000n])
            if (candidate < expires)
                expires = candidate;
    }
    if (expires > BigInt(Number.MAX_SAFE_INTEGER) || expires - BigInt(now) < BigInt(BRIDGE_MIN_REMAINING_MS))
        bridgeFailure("APN_REPREPARE_REQUIRED", "bridge_validity_remaining");
    return new Date(Number(expires)).toISOString();
}
function assertProtocolTime(m, decoded, account) {
    if (decoded.protocol.kind !== "across")
        return;
    const p = decoded.protocol, contract = bridgeDeployment(m.request.fromChainId, m.request.toChainId, m.tool, m.request.fromToken), now = BigInt(account.block.timestampAtomic);
    if (contract.quoteTimeBufferAtomic === null || contract.fillDeadlineBufferAtomic === null ||
        BigInt(p.quoteTimestamp) > now || now - BigInt(p.quoteTimestamp) > BigInt(contract.quoteTimeBufferAtomic) ||
        now >= BigInt(p.fillDeadline) || BigInt(p.fillDeadline) > now + BigInt(contract.fillDeadlineBufferAtomic))
        bridgeFailure("APN_REPREPARE_REQUIRED", "across_protocol_validity");
}
export function assertBridgeRemaining(op, now) {
    if (Date.parse(op.intent.expiresAt) - now < BRIDGE_MIN_REMAINING_MS)
        bridgeFailure("APN_REPREPARE_REQUIRED", "bridge_validity_remaining");
}
export async function guardBridgeEffect(op, role, source, destination, now) {
    assertBridgeRemaining(op, now());
    const i = op.intent, m = i.materialization, effect = op.effects.find((e) => e.role === role);
    if (op.terminal || effect === undefined || effect.submissionAttempts !== 0)
        bridgeFailure("APN_OPERATION_BLOCKED", "bridge_first_send_only");
    if (source.origin !== i.sourceRpcOrigin || destination.origin !== i.destinationRpcOrigin || source.chainId !== m.request.fromChainId ||
        destination.chainId !== m.request.toChainId)
        bridgeFailure("APN_RPC_CONFIG", "bridge_frozen_RPC_origin");
    const [sourceDeployment, destinationDeployment] = await Promise.all([source.deployment(m.tool, m.request.toChainId, m.request.fromToken), destination.deployment(m.tool, m.request.fromChainId, m.request.toToken)]);
    for (const [frozen, current] of [[i.sourceDeployment, sourceDeployment], [i.destinationDeployment, destinationDeployment]]) {
        if (current.contractHash !== frozen.contractHash || current.codeHash !== frozen.codeHash || current.configurationHash !== frozen.configurationHash)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_drift");
    }
    const account = await source.account(m.sender, m.approvalAddress, m.request.fromToken), envelope = effect.envelope, c = envelope.economics;
    assertProtocolTime(m, i.decoded, account);
    if (account.latestNonceAtomic !== c.nonceAtomic || account.pendingNonceAtomic !== c.nonceAtomic)
        bridgeFailure("APN_OPERATION_BLOCKED", "bridge_nonce_changed");
    const expectedAllowance = role === "approval" || bridgeNativePrincipal(m.request) ? "0" : m.request.amountAtomic;
    if (account.allowanceAtomic !== expectedAllowance)
        bridgeFailure("APN_PERMISSION_ALLOWANCE_INSUFFICIENT", "bridge_exact_allowance_changed");
    if (BigInt(account.balanceAtomic) < BigInt(m.request.amountAtomic))
        bridgeFailure("APN_INSUFFICIENT_ASSET", "source_asset_balance");
    const estimate = await source.estimate({ chainId: envelope.chainId, from: envelope.from, to: envelope.to, data: envelope.data,
        valueAtomic: envelope.valueAtomic, gasLimitAtomic: c.gasLimitAtomic });
    // `c` is the owner-approved maximum: the preparation quote raised by the stated headroom. A fresh estimate inside
    // that maximum proceeds on the signed envelope; only an estimate above the approved maximum ends the operation.
    if (bridgeUint(estimate.gasLimitAtomic, true) > BigInt(c.gasLimitAtomic) || BigInt(estimate.maxFeePerGasAtomic) > BigInt(c.maxFeePerGasAtomic) ||
        BigInt(estimate.maxPriorityFeePerGasAtomic) > BigInt(c.maxPriorityFeePerGasAtomic))
        bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "fresh_execution_estimate_over_cap");
    let paid = 0n, unpaid = 0n;
    for (const e of op.effects) {
        if (e.submissionAttempts === 1) {
            const proof = e.safeProof ?? e.includedProof;
            if (proof === null || proof.status !== "success")
                bridgeFailure("APN_OPERATION_BLOCKED", "earlier_effect_unresolved");
            paid += BigInt(proof.actualTotalFeeWei) + BigInt(e.envelope.valueAtomic);
        }
        else {
            const quote = await source.feeQuote(e.envelope);
            if (quote.chainId !== e.envelope.chainId || quote.rpcOrigin !== i.sourceRpcOrigin ||
                quote.maximumExecutionFeeWei !== e.envelope.economics.maximumGasCostAtomic)
                bridgeFailure("APN_RPC_PROTOCOL", "fresh_fee_quote_identity");
            unpaid += BigInt(quote.totalQuoteWei) + BigInt(e.envelope.valueAtomic);
        }
    }
    if (paid + unpaid - bridgeNativePrincipalWei(m.request) > BigInt(m.request.maxNativeDebitWei))
        bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "fresh_aggregate_native_debit");
    if (unpaid > BigInt(account.nativeBalanceWei))
        bridgeFailure("APN_INSUFFICIENT_GAS", "fresh_native_funding");
    assertBridgeRemaining(op, now());
}
//# sourceMappingURL=economics.js.map