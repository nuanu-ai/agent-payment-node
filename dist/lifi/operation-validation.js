import { hashObject, sha256 } from "../canonical.js";
import { decodeBridgeCall } from "./decode.js";
import { bridgeApprovalRequired, bridgeNativePrincipalWei } from "./economics.js";
import { BRIDGE_TERMINAL, bridgeIntentBinding, bridgeSnapshot } from "./operation-model.js";
import { legacyBridgeOperationSchema, operationSchema } from "./schema.js";
import { bridgeExecutionDestination, bridgeNativeDenominationConversion, bridgeProviderBoundNativeDestination, validateBridgeRequest } from "./asset-registry.js";
import { BRIDGE_DIAMOND, BRIDGE_FEE_HEADROOM_BPS, BRIDGE_FEE_HEADROOM_POLICY, BRIDGE_MAX_GAS, BRIDGE_ZERO_WORD, bridgeFailure, bridgeHeadroomWei, bridgeSame, bridgeUint } from "./validation.js";
import { approvalData } from "./transaction.js";
import { BRIDGE_FEE_RULE_HASH } from "./rpc-fees.js";
import { assetUsageReservationId, validateAssetUsageReservation } from "../asset-usage-ledger.js";
import { bridgeMechanism, validateBridgeAllowlistBinding } from "./allowlist.js";
import { isEvmTransactionHash } from "../rail-status-binding.js";
const EDGES = {
    awaiting_approval: ["execution_pending", "failed_before_effect"],
    execution_pending: ["source_pending", "unknown_finality", "failed_before_effect", "failed_after_approval", "failed_confirmed_revert"],
    source_pending: ["destination_pending", "unknown_finality", "completed", "destination_failed", "failed_after_approval", "failed_confirmed_revert"],
    destination_pending: ["unknown_finality", "completed", "destination_failed", "failed_confirmed_revert"],
    unknown_finality: ["source_pending", "destination_pending", "completed", "destination_failed", "failed_after_approval", "failed_confirmed_revert"],
    completed: [], destination_failed: [], failed_before_effect: [], failed_after_approval: [], failed_confirmed_revert: [],
};
const PHASE_EDGES = {
    unsealed: ["signing_started"], signing_started: ["sealed"], sealed: ["submitting"],
    submitting: ["submitted_pending", "unknown_finality", "included_success", "included_revert", "safe_success", "safe_revert"],
    submitted_pending: ["unknown_finality", "included_success", "included_revert", "safe_success", "safe_revert"],
    unknown_finality: ["included_success", "included_revert", "safe_success", "safe_revert"],
    included_success: ["safe_success", "unknown_finality"], included_revert: ["safe_revert", "unknown_finality"],
    safe_success: [], safe_revert: [],
};
export function bridgeCorrupt() { return bridgeFailure("APN_STATE_CORRUPT", "durable_bridge_binding"); }
export function validateBridgeOperation(value) {
    return validateBridgeOperationShape(value, false);
}
/** Validates the exact pre-allowlist durable shape without upgrading or rewriting it. */
export function validateLegacyBridgeOperation(value) {
    return validateBridgeOperationShape(value, true);
}
function validateBridgeOperationShape(value, legacy) {
    if (!(legacy ? legacyBridgeOperationSchema : operationSchema).safeParse(value).success)
        bridgeCorrupt();
    const op = value;
    // The old schema string was unfortunately reused. A timestamp ceiling prevents
    // malformed records produced by the upgraded writer from being downgraded into
    // the compatibility path.
    if (legacy && op.createdAt >= "2026-09-20T11:13:44.000Z")
        bridgeCorrupt();
    const { integrityHash, ...body } = op;
    if (integrityHash !== hashObject(body) || op.fingerprint !== hashObject(bridgeIntentBinding(op)))
        bridgeCorrupt();
    validateIntent(op, legacy);
    let previous;
    for (const entry of op.transitions) {
        const { transitionHash, ...entryBody } = entry;
        if (hashObject(entryBody) !== transitionHash || entry.previousHash !== (previous?.transitionHash ?? op.fingerprint))
            bridgeCorrupt();
        if (previous === undefined) {
            if (entry.state !== "awaiting_approval" || entry.at !== op.createdAt || entry.approval !== null ||
                entry.effects.some((e) => e.phase !== "unsealed") || entry.sourceProof !== null || entry.destinationProof !== null ||
                entry.providerObservation !== null || entry.failure !== null || (!legacy && entry.usageLease !== null) || !bridgeSame(entry.destinationScan, { startBlock: op.intent.destinationStartBlock, nextBlockAtomic: op.intent.destinationStartBlock.numberAtomic, previousEndBlock: null }))
                bridgeCorrupt();
        }
        else
            validateTransition(previous, entry, legacy);
        validateSnapshot(op, entry, legacy);
        previous = entry;
    }
    if (previous === undefined || previous.at !== op.updatedAt || op.terminal !== BRIDGE_TERMINAL.includes(op.state))
        bridgeCorrupt();
    const { at: _at, previousHash: _prev, transitionHash: _hash, ...last } = previous;
    if (!bridgeSame(last, bridgeSnapshot(op)))
        bridgeCorrupt();
    return op;
}
function validateIntent(op, legacy) {
    const i = op.intent, m = i.materialization, r = validateBridgeRequest(m.request, "APN_STATE_CORRUPT");
    if (!bridgeExecutionDestination(r.toChainId))
        bridgeCorrupt();
    if (op.profileHash !== i.owner.profileHash || i.profile !== i.owner.profile ||
        op.profileHash !== sha256(`profile\0${i.profile}`) || i.owner.address !== m.sender ||
        op.createdAt !== i.preparedAt || i.expiresAt <= i.preparedAt || Date.parse(i.expiresAt) - Date.parse(i.preparedAt) > 300_000 ||
        m.requestHash !== hashObject(r) || m.transactionDigest !== hashObject(m.transaction) ||
        i.policyHash !== hashObject({ identity: "apn.bridge.foreground-approval.v1", request: r }) ||
        op.requestHash !== hashObject({ profile: i.profile, quote: i.quoteHash, route: m.routeId }))
        bridgeCorrupt();
    if (!legacy) {
        const providerBoundNative = bridgeProviderBoundNativeDestination(r);
        if (providerBoundNative && (r.recipient !== i.owner.address || m.tool !== "across"))
            bridgeCorrupt();
        const allowlist = i.allowlist === null ? null : validateBridgeAllowlistBinding(i.allowlist);
        if (allowlist !== null && (allowlist.account !== i.owner.address || allowlist.selfRecipient !== r.recipient || allowlist.chain !== `eip155:${r.fromChainId}` ||
            allowlist.amountAtomic !== r.amountAtomic || !bridgeSame(allowlist.mechanism, bridgeMechanism(m.tool))))
            bridgeCorrupt();
        if (op.usageLease !== null && allowlist !== null) {
            const usageIdentity = { account: allowlist.account, chain: allowlist.chain, asset: allowlist.asset };
            const lease = validateAssetUsageReservation(op.usageLease);
            if (lease.state !== "reserved" || lease.rail !== "bridge" || lease.policyDigest !== allowlist.policyDigest ||
                lease.amountAtomic !== allowlist.amountAtomic || lease.account !== allowlist.account || lease.chain !== allowlist.chain ||
                !bridgeSame(lease.asset, allowlist.asset) || lease.reservationId !== assetUsageReservationId(usageIdentity, `apn.bridge-usage:${op.operationId}`))
                bridgeCorrupt();
        }
    }
    try {
        if (!bridgeSame(decodeBridgeCall(m), i.decoded))
            bridgeCorrupt();
    }
    catch {
        bridgeCorrupt();
    }
    if (i.sourceDeployment.chainId !== r.fromChainId || i.sourceDeployment.peerChainId !== r.toChainId ||
        i.destinationDeployment.chainId !== r.toChainId || i.destinationDeployment.peerChainId !== r.fromChainId ||
        i.sourceDeployment.tool !== m.tool || i.destinationDeployment.tool !== m.tool ||
        i.sourceDeployment.rpcOrigin !== i.sourceRpcOrigin || i.destinationDeployment.rpcOrigin !== i.destinationRpcOrigin)
        bridgeCorrupt();
    const a = i.sourceAccount;
    if (a.owner !== m.sender || a.token !== r.fromToken || a.spender !== m.approvalAddress || a.spender !== BRIDGE_DIAMOND ||
        a.chainId !== r.fromChainId || a.rpcOrigin !== i.sourceRpcOrigin || a.latestNonceAtomic !== a.pendingNonceAtomic ||
        !["0", r.amountAtomic].includes(a.allowanceAtomic) || bridgeUint(a.balanceAtomic) < bridgeUint(r.amountAtomic))
        bridgeCorrupt();
    const approval = bridgeApprovalRequired(r, a.allowanceAtomic);
    if (op.effects.length !== (approval ? 2 : 1) || op.effects.at(-1)?.role !== "bridge" ||
        (op.effects.length === 2 && op.effects[0].role !== "approval"))
        bridgeCorrupt();
    op.effects.forEach((effect, index) => {
        validateEnvelope(effect.envelope);
        const e = effect.envelope;
        if (e.role !== effect.role || e.chainId !== r.fromChainId || e.from !== m.sender || e.feeQuote.rpcOrigin !== i.sourceRpcOrigin ||
            BigInt(e.economics.nonceAtomic) !== BigInt(a.latestNonceAtomic) + BigInt(index))
            bridgeCorrupt();
        if (effect.role === "bridge") {
            if (e.to !== m.transaction.to || e.data !== m.transaction.data || e.valueAtomic !== m.transaction.valueAtomic ||
                e.economics.gasLimitAtomic !== m.transaction.gasLimitAtomic || e.provisionalGas !== approval)
                bridgeCorrupt();
        }
        else if (e.to !== r.fromToken || e.data !== approvalData(m.approvalAddress, r.amountAtomic) || e.valueAtomic !== "0" || e.provisionalGas)
            bridgeCorrupt();
    });
    const native = op.effects.reduce((sum, e) => sum + BigInt(e.envelope.feeQuote.totalQuoteWei) + BigInt(e.envelope.valueAtomic), 0n);
    if (native - bridgeNativePrincipalWei(r) > BigInt(r.maxNativeDebitWei) || native > BigInt(a.nativeBalanceWei))
        bridgeCorrupt();
    const included = m.feeCosts.filter((f) => f.included).reduce((sum, f) => sum + BigInt(f.amountAtomic), 0n);
    if (bridgeNativeDenominationConversion(r)
        ? i.implicitProtocolFeeAtomic !== "0" || included > BigInt(r.maxRouteFeeAtomic)
        : included + BigInt(m.quotedOutputAtomic) + BigInt(i.implicitProtocolFeeAtomic) !== BigInt(r.amountAtomic))
        bridgeCorrupt();
}
export function validateEnvelope(e) {
    const { envelopeHash, ...body } = e, c = e.economics, q = e.feeQuote, f = e.feeCeiling;
    // The approved maximum must be exactly the recorded quote raised by the stated headroom; nothing else is signable.
    if (f.policy !== BRIDGE_FEE_HEADROOM_POLICY || f.headroomBps !== BRIDGE_FEE_HEADROOM_BPS ||
        c.maxFeePerGasAtomic !== bridgeHeadroomWei(f.quotedMaxFeePerGasAtomic, "APN_STATE_CORRUPT") ||
        c.maxPriorityFeePerGasAtomic !== bridgeHeadroomWei(f.quotedMaxPriorityFeePerGasAtomic, "APN_STATE_CORRUPT"))
        bridgeCorrupt();
    if (envelopeHash !== hashObject(body) || BigInt(c.gasLimitAtomic) < 1n || BigInt(c.gasLimitAtomic) > BRIDGE_MAX_GAS ||
        BigInt(c.maxFeePerGasAtomic) < 1n || BigInt(c.maxPriorityFeePerGasAtomic) > BigInt(c.maxFeePerGasAtomic) ||
        BigInt(c.maximumGasCostAtomic) !== BigInt(c.gasLimitAtomic) * BigInt(c.maxFeePerGasAtomic) ||
        q.chainId !== e.chainId || q.maximumExecutionFeeWei !== c.maximumGasCostAtomic ||
        BigInt(q.totalQuoteWei) !== BigInt(q.maximumExecutionFeeWei) + BigInt(q.l1DataFeeUpperWei) + BigInt(q.operatorFeeUpperWei) ||
        (e.chainId !== 8453 && (q.l1DataFeeUpperWei !== "0" || q.operatorFeeUpperWei !== "0")) ||
        (e.chainId === 42161 ? q.feeModel !== "arbitrum-inclusive" : q.feeModel !== undefined))
        bridgeCorrupt();
}
export function validateEnvelopeProof(p, e, hash) {
    const c = e.economics;
    if (p.chainId !== e.chainId || p.transactionHash !== hash || p.from !== e.from || p.to !== e.to ||
        p.nonceAtomic !== c.nonceAtomic || p.valueAtomic !== e.valueAtomic || p.dataHash !== sha256(Buffer.from(e.data.slice(2), "hex")) ||
        p.gasLimitAtomic !== c.gasLimitAtomic || p.maxFeePerGasAtomic !== c.maxFeePerGasAtomic ||
        p.maxPriorityFeePerGasAtomic !== c.maxPriorityFeePerGasAtomic || p.rpcOrigin !== e.feeQuote.rpcOrigin)
        bridgeCorrupt();
    if (BigInt(p.gasUsedAtomic) > BigInt(c.gasLimitAtomic) || BigInt(p.effectiveGasPriceAtomic) > BigInt(c.maxFeePerGasAtomic) ||
        BigInt(p.executionFeeWei) !== BigInt(p.gasUsedAtomic) * BigInt(p.effectiveGasPriceAtomic) ||
        BigInt(p.actualTotalFeeWei) !== BigInt(p.executionFeeWei) + BigInt(p.l1DataFeeWei) + BigInt(p.operatorFeeWei) ||
        p.blobFeeWei !== "0" || p.feeEvidence.ruleHash !== BRIDGE_FEE_RULE_HASH ||
        (e.chainId !== 8453 && (p.l1DataFeeWei !== "0" || p.operatorFeeWei !== "0")) ||
        (p.safeBlock !== null && BigInt(p.safeBlock.numberAtomic) < BigInt(p.block.numberAtomic)))
        bridgeCorrupt();
    if (e.chainId === 8453) {
        const o = p.feeEvidence.baseOracle;
        if (o === null || o.blockHash !== p.block.hash || o.oracle !== "0x420000000000000000000000000000000000000F" ||
            o.from !== `0x${"0".repeat(40)}` || o.callData !== `0x275aedd2${BigInt(p.gasUsedAtomic).toString(16).padStart(64, "0")}` ||
            BigInt(o.rawReturn).toString() !== p.operatorFeeWei || BigInt(o.scalarAtomic) >= 1n << 32n || BigInt(o.constantWei) >= 1n << 64n ||
            BigInt(p.operatorFeeWei) !== BigInt(p.gasUsedAtomic) * BigInt(o.scalarAtomic) * 100n + BigInt(o.constantWei) || p.feeEvidence.arbitrumPosterGasAtomic !== null)
            bridgeCorrupt();
    }
    else if (p.feeEvidence.baseOracle !== null || (e.chainId === 42161 ? p.feeEvidence.arbitrumPosterGasAtomic === null ||
        BigInt(p.feeEvidence.arbitrumPosterGasAtomic) > BigInt(p.gasUsedAtomic) : p.feeEvidence.arbitrumPosterGasAtomic !== null))
        bridgeCorrupt();
}
function validateSnapshot(op, s, legacy) {
    if (s.effects.length !== op.effects.length)
        bridgeCorrupt();
    s.effects.forEach((effect, index) => validateEffect(effect, op.effects[index].envelope, s.at));
    if (s.approval !== null && (s.approval.fingerprint !== op.fingerprint || s.approval.expiresAt !== op.intent.expiresAt ||
        s.approval.approvedAt < op.createdAt || s.approval.approvedAt > s.at || s.approval.approvedAt >= s.approval.expiresAt))
        bridgeCorrupt();
    if (s.approval === null && s.effects.some((e) => e.phase !== "unsealed"))
        bridgeCorrupt();
    if (!legacy) {
        if (op.intent.allowlist !== null && (s.approval === null) !== (s.usageLease === null))
            bridgeCorrupt();
        if (op.intent.allowlist === null && s.usageLease !== null)
            bridgeCorrupt();
        if (s.usageLease !== null && !bridgeSame(s.usageLease, op.usageLease))
            bridgeCorrupt();
    }
    if (s.state === "awaiting_approval" && s.approval !== null)
        bridgeCorrupt();
    if (s.state !== "awaiting_approval" && s.state !== "failed_before_effect" && s.approval === null)
        bridgeCorrupt();
    const bridge = s.effects.at(-1), approval = s.effects.length === 2 ? s.effects[0] : null;
    if (s.sourceProof !== null) {
        const p = s.sourceProof, m = op.intent.materialization, proof = bridge.safeProof ?? bridge.includedProof;
        if (proof === null || proof.status !== "success" || p.transactionHash !== bridge.transactionHash ||
            p.blockNumberAtomic !== proof.block.numberAtomic || p.blockHash !== proof.block.hash || p.logsHash !== proof.logsHash ||
            p.chainId !== m.request.fromChainId || p.tool !== m.tool || p.correlation.kind !== m.tool ||
            p.sourceAmountAtomic !== m.request.amountAtomic || p.bridgeAmountAtomic !== op.intent.decoded.bridgeAmountAtomic ||
            p.feeForwardedAtomic !== op.intent.decoded.feeAmountAtomic)
            bridgeCorrupt();
    }
    if (s.destinationProof !== null) {
        const p = s.destinationProof, m = op.intent.materialization;
        if (m.tool === "across" ? p.fillType === null || p.relayerCredit === null || p.repaymentChainIdAtomic === null ||
            (p.fillType === 2 && (p.relayerCredit !== BRIDGE_ZERO_WORD || p.repaymentChainIdAtomic !== "0"))
            : p.fillType !== null || p.relayerCredit !== null || p.repaymentChainIdAtomic !== null)
            bridgeCorrupt();
        const providerBoundNative = bridgeProviderBoundNativeDestination(m.request);
        if (!legacy && providerBoundNative && (s.providerObservation?.status !== "completed_observed" ||
            s.providerObservation.destinationTransactionHash !== p.transactionHash || p.nativeBalance === null || p.nativeBalance.recipient !== m.request.recipient))
            bridgeCorrupt();
        if (!legacy && providerBoundNative && op.intent.decoded.composite === undefined &&
            (p.nativeTransfer === null || p.nativeTransfer.transactionHash !== p.transactionHash || p.nativeTransfer.to !== m.request.recipient ||
                p.nativeTransfer.valueAtomic !== p.amountAtomic || BigInt(p.nativeBalance.deltaAtomic) < BigInt(m.request.minOutputAtomic)))
            bridgeCorrupt();
        if (!legacy && op.intent.decoded.composite !== undefined) {
            const trace = p.compositeTrace;
            if (p.nativeTransfer !== null || trace === undefined || trace === null || trace.transactionHash !== p.transactionHash ||
                trace.inputAmountAtomic !== op.intent.decoded.composite.inputAmountAtomic || p.amountAtomic !== trace.deliveredAmountAtomic ||
                !["completed_native", "recovered_weth", "below_floor", "protocol_mismatch"].includes(trace.outcome))
                bridgeCorrupt();
        }
        if (s.sourceProof === null || p.correlationHash !== hashObject(s.sourceProof.correlation) || p.tool !== m.tool ||
            p.chainId !== m.request.toChainId || p.recipient !== m.request.recipient || p.token !== m.request.toToken ||
            p.rpcOrigin !== op.intent.destinationRpcOrigin || BigInt(p.safeBlock.numberAtomic) < BigInt(p.blockNumberAtomic) ||
            (op.intent.decoded.composite === undefined && (BigInt(p.amountAtomic) < BigInt(m.request.minOutputAtomic) || p.amountAtomic !== (s.sourceProof.correlation.kind === "across"
                ? s.sourceProof.correlation.outputAmountAtomic : s.sourceProof.correlation.amountReceivedAtomic))))
            bridgeCorrupt();
    }
    if (s.providerObservation?.status === "completed_observed") {
        const p = s.providerObservation;
        if (p.responseHash === null || !isEvmTransactionHash(p.destinationTransactionHash) || s.sourceProof === null ||
            bridge.phase !== "safe_success" || bridge.transactionHash !== s.sourceProof.transactionHash ||
            (s.destinationProof !== null && s.destinationProof.transactionHash !== p.destinationTransactionHash) ||
            bridge.submittedAt === null || p.observedAt < bridge.submittedAt || p.observedAt > s.at)
            bridgeCorrupt();
    }
    if (s.state === "completed" && (s.effects.some((e) => e.phase !== "safe_success") || s.destinationProof === null || s.sourceProof === null ||
        (op.intent.decoded.composite !== undefined && s.destinationProof.compositeTrace?.outcome !== "completed_native")))
        bridgeCorrupt();
    if (s.state === "destination_failed" && (s.effects.some((e) => e.phase !== "safe_success") || s.sourceProof === null || s.failure === null ||
        !["recovered_weth", "below_floor", "protocol_mismatch"].includes(s.failure.reason) ||
        (s.failure.reason !== "protocol_mismatch" && s.destinationProof?.compositeTrace?.outcome !== s.failure.reason)))
        bridgeCorrupt();
    if (s.state === "failed_before_effect" && (s.effects.some((e) => e.submissionAttempts !== 0 || e.phase === "signing_started") || s.failure === null))
        bridgeCorrupt();
    if (s.failure?.preSignRpc !== undefined) {
        const d = s.failure.preSignRpc, request = op.intent.materialization.request;
        const expectedChain = d.chainRole === "source" ? request.fromChainId : request.toChainId;
        const expectedCategory = d.stage.endsWith("deployment_refresh") ? "deployment_refresh"
            : d.stage === "source_account_refresh" ? "account_nonce"
                : d.stage === "source_execution_simulation" ? "simulation" : "fee_quote";
        const unsubmittedBridgeAfterApproval = d.effectRole === "bridge" && approval?.role === "approval" &&
            approval.submissionAttempts === 1 && bridge.role === "bridge" && bridge.submissionAttempts === 0 && bridge.phase === "unsealed";
        const compatibleState = (s.state === "failed_before_effect" && d.effectRole === s.effects[0].role &&
            s.effects.some((effect) => effect.role === d.effectRole && effect.phase === "unsealed" && effect.submissionAttempts === 0)) ||
            (s.state === "failed_after_approval" && unsubmittedBridgeAfterApproval && approval?.phase === "safe_success") ||
            (s.state === "source_pending" && unsubmittedBridgeAfterApproval &&
                (approval?.phase === "included_success" || approval?.phase === "safe_success")) ||
            (s.state === "unknown_finality" && unsubmittedBridgeAfterApproval) ||
            (s.state === "failed_confirmed_revert" && unsubmittedBridgeAfterApproval && approval?.phase === "safe_revert");
        if (s.failure.reason !== "unsent_apn_rpc_ambiguous" || !compatibleState ||
            d.chainId !== expectedChain || d.category !== expectedCategory ||
            (d.stage.startsWith("source_") ? d.chainRole !== "source" : d.chainRole !== "destination") ||
            !s.effects.some((effect) => effect.role === d.effectRole))
            bridgeCorrupt();
    }
    if ((s.failure?.residualAllowanceStatus === "observed" && s.failure.residualAllowance === null) ||
        (s.failure?.residualAllowanceStatus === "unavailable" && s.failure.residualAllowance !== null))
        bridgeCorrupt();
    if (s.state === "failed_after_approval" && (approval?.phase !== "safe_success" || bridge.submissionAttempts !== 0 || bridge.phase === "signing_started" || s.failure === null))
        bridgeCorrupt();
    if (s.state === "failed_confirmed_revert") {
        const index = s.effects.findIndex((e) => e.phase === "safe_revert");
        if (index < 0 || s.effects.slice(0, index).some((e) => e.phase !== "safe_success") ||
            s.effects.slice(index + 1).some((e) => e.submissionAttempts !== 0) || s.failure === null)
            bridgeCorrupt();
    }
    if (!bridgeSame(s.destinationScan.startBlock, op.intent.destinationStartBlock) ||
        BigInt(s.destinationScan.nextBlockAtomic) < BigInt(s.destinationScan.startBlock.numberAtomic) ||
        (s.destinationScan.previousEndBlock !== null && BigInt(s.destinationScan.previousEndBlock.numberAtomic) + 1n !== BigInt(s.destinationScan.nextBlockAtomic)))
        bridgeCorrupt();
}
function validateEffect(e, envelope, at) {
    if (e.role !== envelope.role || e.envelopeHash !== envelope.envelopeHash)
        bridgeCorrupt();
    const committed = !["unsealed", "signing_started"].includes(e.phase), submitted = !["unsealed", "signing_started", "sealed"].includes(e.phase);
    if (committed !== (e.transactionHash !== null && e.sealedMaterialHash !== null) ||
        (!committed && (e.transactionHash !== null || e.sealedMaterialHash !== null)) || e.submissionAttempts !== (submitted ? 1 : 0) ||
        (submitted !== (e.submittedAt !== null)) || (e.submittedAt !== null && e.submittedAt > at))
        bridgeCorrupt();
    const included = ["included_success", "included_revert", "safe_success", "safe_revert"].includes(e.phase);
    const safe = ["safe_success", "safe_revert"].includes(e.phase);
    if (included !== (e.includedProof !== null) || safe !== (e.safeProof !== null))
        bridgeCorrupt();
    for (const p of [e.includedProof, e.safeProof]) {
        if (p === null)
            continue;
        validateEnvelopeProof(p, envelope, e.transactionHash);
        if (p.status !== (e.phase.endsWith("success") ? "success" : "reverted"))
            bridgeCorrupt();
    }
    if (e.safeProof !== null && (e.safeProof.safeBlock === null || e.includedProof === null ||
        !bridgeSame({ ...e.safeProof, safeBlock: null }, { ...e.includedProof, safeBlock: null })))
        bridgeCorrupt();
}
function validateTransition(p, n, legacy = false) {
    if (BRIDGE_TERMINAL.includes(p.state) || (p.state !== n.state && !EDGES[p.state].includes(n.state)) || n.at < p.at)
        bridgeCorrupt();
    if (p.approval !== null && !bridgeSame(p.approval, n.approval))
        bridgeCorrupt();
    if (!legacy && p.usageLease !== null && !bridgeSame(p.usageLease, n.usageLease))
        bridgeCorrupt();
    if (p.effects.length !== n.effects.length)
        bridgeCorrupt();
    p.effects.forEach((e, index) => {
        const next = n.effects[index];
        if (e.role === "bridge" && e.phase === "unsealed" && next.phase === "signing_started" &&
            n.effects[0]?.role === "approval" && !["included_success", "safe_success"].includes(n.effects[0].phase))
            bridgeCorrupt();
        if (e.role !== next.role || e.envelopeHash !== next.envelopeHash ||
            (e.phase !== next.phase && !PHASE_EDGES[e.phase].includes(next.phase)) ||
            (e.transactionHash !== null && e.transactionHash !== next.transactionHash) ||
            (e.sealedMaterialHash !== null && e.sealedMaterialHash !== next.sealedMaterialHash) ||
            e.submissionAttempts > next.submissionAttempts || (e.submittedAt !== null && e.submittedAt !== next.submittedAt) ||
            (e.safeProof !== null && !bridgeSame(e.safeProof, next.safeProof)))
            bridgeCorrupt();
    });
    if (p.destinationProof !== null && !bridgeSame(p.destinationProof, n.destinationProof))
        bridgeCorrupt();
}
export function validateBridgeContinuity(previous, next) {
    validateBridgeOperation(previous);
    validateBridgeOperation(next);
    if (bridgeSame(previous, next))
        return;
    if (previous.terminal || previous.fingerprint !== next.fingerprint || next.transitions.length !== previous.transitions.length + 1 ||
        !bridgeSame(previous.transitions, next.transitions.slice(0, -1)))
        bridgeCorrupt();
}
//# sourceMappingURL=operation-validation.js.map