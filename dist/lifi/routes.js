import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { bridgeAssetAddress, bridgeAssetRow, bridgeAssetTool, bridgeChain, bridgeCrossNativeConversion, bridgeDestinationChain, bridgeExecutionDestination, bridgeFeeAsset, bridgeNativeCoin, bridgeNativeDenominationConversion, bridgeNativePrincipal, bridgeQuoteDestination } from "./asset-registry.js";
import { decodeBridgeCall } from "./decode.js";
import { LIFI_ROUTE_RESPONSE_BYTES } from "./provider.js";
import { BRIDGE_DIAMOND, BRIDGE_MAX_GAS, BRIDGE_ZERO_ADDRESS, bridgeAddress, bridgeFailure, bridgeHex, bridgeJson, bridgeOpaque, bridgeRecord, bridgeSame, bridgeUint } from "./validation.js";
/** Exact contracts for the reviewed composite BNB delivery graph. */
const BNB_QUOTE_DELIVERY = {
    token: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    handler: "0x33b255b5db44A78c34381f89f1a454bc0Ef49871",
    swapTarget: "0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c",
};
/** The admitted row for the leg of the request that this chain identifies. Both chains are distinct by construction. */
function requestAsset(request, chainId) {
    if (chainId === request.fromChainId)
        return bridgeAssetRow(chainId, request.fromToken);
    if (chainId === request.toChainId)
        return bridgeAssetRow(chainId, request.toToken);
    return bridgeFailure("APN_PROVIDER_PROTOCOL", "route_chain_identity");
}
/** A tool is preparable only when both legs are reviewed for it: a native principal has no reviewed Stargate pool. */
function toolGate(tool, request) {
    if (tool !== "across" && tool !== "stargateV2")
        return "finite_decoder_and_correlated_evidence_unavailable";
    if (!bridgeExecutionDestination(request.toChainId)) {
        const row = bridgeQuoteDestination(request.toChainId);
        if (!row.tools.includes(tool))
            return "destination_tool_quote_unavailable";
        return "destination_execution_unreviewed";
    }
    try {
        bridgeAssetTool(requestAsset(request, request.fromChainId), tool);
        bridgeAssetTool(requestAsset(request, request.toChainId), tool);
    }
    catch {
        return "asset_tool_unreviewed";
    }
    return null;
}
export function parseBridgeRoutes(response, request, sender) {
    if (response.status !== 200)
        bridgeFailure("APN_PROVIDER_UNAVAILABLE", "route_discovery_status");
    const body = bridgeRecord(bridgeJson(response.body, LIFI_ROUTE_RESPONSE_BYTES));
    const routes = list(body.routes, 20, "route_count");
    const results = routes.map((value) => {
        const route = bridgeRecord(value), routeId = bridgeOpaque(route.id);
        assertTuple(route, request, sender, false);
        if (route.containsSwitchChain !== false || list(route.steps, 1, "top_level_step_count").length !== 1)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "single_source_effect_required");
        const step = bridgeRecord(route.steps[0]);
        assertStep(step, request, sender);
        const estimate = bridgeRecord(step.estimate), output = bridgeUint(estimate.toAmount, true).toString(), minimum = bridgeUint(estimate.toAmountMin, true).toString();
        if (route.toAmount !== output || route.toAmountMin !== minimum)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "route_step_output_identity");
        const tool = bridgeOpaque(step.tool), gate = toolGate(tool, request);
        // These rows are candidates for finite materialization, never final execution authority.
        return { route, step, choice: { routeId, stepId: bridgeOpaque(step.id), tool, quotedOutputAtomic: output, minimumOutputAtomic: minimum,
                routeHash: hashObject(route), stepHash: hashObject(step), stepIdentityHash: hashObject(stepIdentity(step)),
                preparable: gate === null, unavailableReason: gate } };
    });
    if (new Set(results.map((r) => r.choice.routeId)).size !== results.length || new Set(results.map((r) => r.choice.stepId)).size !== results.length)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "duplicate_route_identity");
    return results;
}
export function materializeBridgeRoute(selected, response, request, sender) {
    return parseBridgeMaterialization(selected, response, request, sender, false);
}
/** Decode and validate a reviewed quote-only destination without creating an operation or enabling an RPC/send path. */
export function inspectBridgeRouteMaterialization(selected, response, request, sender) {
    return parseBridgeMaterialization(selected, response, request, sender, true);
}
function parseBridgeMaterialization(selected, response, request, sender, quoteOnly) {
    if (!selected.choice.preparable && !(quoteOnly && selected.choice.unavailableReason === "destination_execution_unreviewed")) {
        bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_bridge_decoder_unavailable");
    }
    if (response.status !== 200)
        bridgeFailure("APN_PROVIDER_UNAVAILABLE", "step_materialization_status");
    const step = bridgeRecord(bridgeJson(response.body, LIFI_ROUTE_RESPONSE_BYTES));
    assertStep(step, request, sender);
    if (hashObject(stepIdentity(step)) !== selected.choice.stepIdentityHash &&
        !(bridgeCrossNativeConversion(request) && step.id === selected.choice.stepId && step.tool === selected.choice.tool)) {
        bridgeFailure("APN_PROVIDER_PROTOCOL", "materialized_step_identity_changed");
    }
    const estimate = bridgeRecord(step.estimate), tx = bridgeRecord(step.transactionRequest);
    const allowed = ["to", "from", "data", "value", "chainId", "gasLimit", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "type", "accessList", "nonce"];
    if (Object.keys(tx).some((k) => !allowed.includes(k)) || (tx.type !== undefined && tx.type !== 2 && tx.type !== "0x2") ||
        (tx.accessList !== undefined && (!Array.isArray(tx.accessList) || tx.accessList.length !== 0)) ||
        (tx.gasPrice !== undefined && (tx.maxFeePerGas !== undefined || tx.maxPriorityFeePerGas !== undefined)) ||
        ((tx.maxFeePerGas === undefined) !== (tx.maxPriorityFeePerGas === undefined)))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "transaction_envelope_fields");
    for (const k of ["gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"])
        if (tx[k] !== undefined)
            providerQuantity(tx[k]);
    const gas = providerQuantity(tx.gasLimit);
    if (gas < 1n || gas > BRIDGE_MAX_GAS || bridgeChain(tx.chainId) !== request.fromChainId ||
        bridgeAddress(tx.from) !== sender || bridgeAddress(tx.to) !== BRIDGE_DIAMOND)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "materialized_transaction_identity");
    const materialization = {
        routeId: selected.choice.routeId, stepId: selected.choice.stepId, tool: selected.choice.tool, request, sender,
        approvalAddress: bridgeAddress(estimate.approvalAddress), quotedOutputAtomic: bridgeUint(estimate.toAmount, true).toString(),
        minimumOutputAtomic: bridgeUint(estimate.toAmountMin, true).toString(), feeCosts: parseFees(estimate.feeCosts, request),
        includedStepIdentities: list(step.includedSteps, 8, "included_step_count").map((s) => hashObject(stepIdentity(bridgeRecord(s)))),
        transaction: { chainId: request.fromChainId, from: sender, to: bridgeAddress(tx.to), data: bridgeHex(tx.data),
            valueAtomic: providerQuantity(tx.value).toString(), gasLimitAtomic: gas.toString() },
        requestHash: hashObject(request), responseHash: sha256(response.body), routeHash: selected.choice.routeHash, stepHash: selected.choice.stepHash,
        materializedStepHash: hashObject(step), transactionDigest: "",
    };
    const m = { ...materialization, transactionDigest: hashObject(materialization.transaction) }, decoded = decodeBridgeCall(m);
    if (bridgeHex(step.transactionId, 32, 32) !== decoded.transactionId)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "provider_transfer_id");
    const subs = list(step.includedSteps, 8, "included_step_count").map((s) => bridgeRecord(s));
    if (bridgeCrossNativeConversion(request))
        assertBnbEffectGraph(subs, request, decoded.bridgeAmountAtomic, m.quotedOutputAtomic, m.minimumOutputAtomic);
    else {
        if (subs.length !== 2 || subs[0].tool !== "feeCollection" || subs[0].type !== "protocol" ||
            subs[1].tool !== m.tool || subs[1].type !== "cross")
            bridgeFailure("APN_PROVIDER_PROTOCOL", "included_effect_graph");
        assertIncludedAction(bridgeRecord(subs[0].action), request, request.amountAtomic, true);
        assertIncludedAction(bridgeRecord(subs[1].action), request, decoded.bridgeAmountAtomic, false);
    }
    const implicitProtocolFeeAtomic = validateRouteEconomics(m);
    return { materialization: m, implicitProtocolFeeAtomic, providerNonceAtomic: tx.nonce === undefined ? null : providerQuantity(tx.nonce).toString() };
}
export function validateRouteEconomics(m) {
    const r = m.request, amount = bridgeUint(r.amountAtomic, true), output = bridgeUint(m.quotedOutputAtomic, true), minimum = bridgeUint(m.minimumOutputAtomic, true);
    const conversion = bridgeNativeDenominationConversion(r);
    if ((!conversion && (output > amount || amount - minimum > bridgeUint(r.maxRouteFeeAtomic))) || minimum > output || minimum < bridgeUint(r.minOutputAtomic, true) ||
        (output - minimum) * 10000n > output * BigInt(r.slippageBps) + 9999n)
        bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "bridge_output_or_token_fee_limit");
    let included = 0n, sourceIncluded = 0n;
    const additional = [];
    for (const fee of m.feeCosts) {
        if (fee.included) {
            if ((fee.chainId !== r.fromChainId && fee.chainId !== r.toChainId) || fee.asset !== bridgeFeeAsset(requestAsset(r, fee.chainId)))
                bridgeFailure("APN_PROVIDER_PROTOCOL", "included_fee_asset");
            included += bridgeUint(fee.amountAtomic);
            if (fee.chainId === r.fromChainId)
                sourceIncluded += bridgeUint(fee.amountAtomic);
        }
        else
            additional.push(fee);
    }
    if ((conversion ? sourceIncluded > bridgeUint(r.maxRouteFeeAtomic) : included + output > amount))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "token_fee_double_count");
    // Native Stargate adds the separately quoted LayerZero fee to the principal; token Stargate carries only that fee.
    const stargateFeeValue = m.tool === "stargateV2" && additional.length === 1 ?
        (bridgeNativePrincipal(r) ? (amount + bridgeUint(additional[0].amountAtomic)).toString() : additional[0].amountAtomic) : null;
    if (m.tool === "across" ? additional.length !== 0 || m.transaction.valueAtomic !== (bridgeNativePrincipal(r) ? r.amountAtomic : "0") :
        additional.length !== 1 || additional[0].chainId !== r.fromChainId || additional[0].asset !== "native" ||
            stargateFeeValue !== m.transaction.valueAtomic)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "native_fee_identity");
    return conversion ? "0" : (amount - included - output).toString();
}
function assertStep(step, request, sender) {
    bridgeOpaque(step.id);
    bridgeOpaque(step.tool);
    if (step.type !== "lifi" || bridgeRecord(step.toolDetails).key !== step.tool ||
        (step.integrator !== undefined && step.integrator !== "lifi-api") || (step.fee !== undefined && step.fee !== 0))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "step_identity");
    rejectExecutionExtensions(step);
    const action = bridgeRecord(step.action);
    assertTuple(action, request, sender, true);
    const estimate = bridgeRecord(step.estimate), source = requestAsset(request, request.fromChainId);
    for (const key of ["approvalReset", "skipApproval", "skipPermit"])
        if (estimate[key] !== undefined && typeof estimate[key] !== "boolean")
            bridgeFailure("APN_PROVIDER_PROTOCOL", "approval_flag");
    // A native principal needs no approval and the provider must say so. A token never skips one, and only a zero-first
    // row (Tether) may carry the provider's reset flag: APN approves from zero or uses an exact allowance, never resets.
    if (estimate.tool !== step.tool || estimate.fromAmount !== request.amountAtomic || bridgeAddress(estimate.approvalAddress) !== BRIDGE_DIAMOND ||
        (source.kind === "native" ? estimate.skipApproval !== true || estimate.approvalReset === true
            : estimate.skipApproval === true || (estimate.approvalReset === true && source.approval !== "zero_first")))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "approval_semantics");
    bridgeUint(estimate.toAmount, true);
    bridgeUint(estimate.toAmountMin, true);
    parseFees(estimate.feeCosts, request);
    for (const value of list(estimate.gasCosts, 8, "gas_cost_count")) {
        const gas = bridgeRecord(value), token = bridgeRecord(gas.token);
        // Gas is always the source chain's first-class native coin; the zero address is only its wire sentinel.
        if (bridgeChain(token.chainId) !== request.fromChainId || bridgeAddress(token.address) !== BRIDGE_ZERO_ADDRESS ||
            token.decimals !== bridgeNativeCoin(request.fromChainId).decimals || typeof gas.type !== "string" ||
            !["SEND", "APPROVE", "FEE"].includes(gas.type))
            bridgeFailure("APN_PROVIDER_PROTOCOL", "gas_cost_asset");
        for (const key of ["price", "estimate", "limit", "amount"])
            bridgeUint(gas[key]);
    }
    const subs = list(step.includedSteps, 8, "included_step_count");
    for (const [index, value] of subs.entries()) {
        const sub = bridgeRecord(value);
        bridgeOpaque(sub.id);
        bridgeOpaque(sub.tool);
        rejectExecutionExtensions(sub);
        if (!bridgeCrossNativeConversion(request) || index === 0)
            includedActionKeys(bridgeRecord(sub.action));
        if (sub.includedSteps !== undefined && (!Array.isArray(sub.includedSteps) || sub.includedSteps.length !== 0))
            bridgeFailure("APN_PROVIDER_PROTOCOL", "nested_effect_graph");
    }
}
function assertTuple(value, request, sender, action) {
    assertToken(value.fromToken, request.fromChainId, request);
    assertToken(value.toToken, request.toChainId, request);
    if (value.fromChainId !== request.fromChainId || value.toChainId !== request.toChainId || value.fromAmount !== request.amountAtomic ||
        bridgeAddress(value.fromAddress) !== sender || bridgeAddress(value.toAddress) !== request.recipient)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "route_action_tuple");
    if (action) {
        actionKeys(value);
        if (value.slippage !== request.slippageBps / 10_000 || (value.destinationGasConsumption !== undefined &&
            value.destinationGasConsumption !== "0" && !bridgeCrossNativeConversion(request)))
            bridgeFailure("APN_PROVIDER_PROTOCOL", "slippage_or_destination_call");
    }
}
function assertBnbEffectGraph(subs, request, bridgeAmount, output, minimum) {
    if (subs.length !== 3 || subs[0].tool !== "feeCollection" || subs[0].type !== "protocol" ||
        subs[1].tool !== "across" || subs[1].type !== "cross" || subs[2].tool !== "fly" || subs[2].type !== "swap") {
        bridgeFailure("APN_PROVIDER_PROTOCOL", "bnb_included_effect_graph");
    }
    assertIncludedAction(bridgeRecord(subs[0].action), request, request.amountAtomic, true);
    const across = bridgeRecord(subs[1].action), swap = bridgeRecord(subs[2].action);
    const from = bridgeRecord(across.fromToken), intermediate = bridgeRecord(across.toToken), swapFrom = bridgeRecord(swap.fromToken), swapTo = bridgeRecord(swap.toToken);
    const destinationGas = bridgeUint(across.destinationGasConsumption, true);
    const callData = across.destinationCallData === undefined ? null : bridgeHex(across.destinationCallData, 4096);
    if (across.fromChainId !== 1 || across.toChainId !== 56 || across.fromAmount !== bridgeAmount || bridgeAddress(from.address) !== BRIDGE_ZERO_ADDRESS ||
        from.chainId !== 1 || from.decimals !== 18 || bridgeAddress(intermediate.address) !== BNB_QUOTE_DELIVERY.token || intermediate.chainId !== 56 || intermediate.decimals !== 18 ||
        bridgeAddress(across.fromAddress) !== BRIDGE_DIAMOND || bridgeAddress(across.toAddress) !== BNB_QUOTE_DELIVERY.handler || across.slippage !== request.slippageBps / 10_000 ||
        destinationGas > 2000000n || (callData !== null && callData !== `0x${"0".repeat((callData.length - 2))}`))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "bnb_across_action");
    if (swap.fromChainId !== 56 || swap.toChainId !== 56 || bridgeAddress(swapFrom.address) !== BNB_QUOTE_DELIVERY.token || swapFrom.chainId !== 56 || swapFrom.decimals !== 18 ||
        bridgeAddress(swapTo.address) !== BRIDGE_ZERO_ADDRESS || swapTo.chainId !== 56 || swapTo.decimals !== 18 || bridgeUint(swap.fromAmount, true) > bridgeUint(bridgeAmount, true) ||
        bridgeAddress(swap.fromAddress) !== bridgeAddress(swap.toAddress) || swap.slippage !== request.slippageBps / 10_000)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "bnb_swap_action");
    const estimate = bridgeRecord(subs[2].estimate);
    if (estimate.tool !== "fly" || estimate.fromAmount !== swap.fromAmount || estimate.toAmount !== output || estimate.toAmountMin !== minimum ||
        bridgeAddress(estimate.approvalAddress) !== BNB_QUOTE_DELIVERY.swapTarget)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "bnb_swap_estimate");
}
function assertIncludedAction(a, request, amount, collection) {
    includedActionKeys(a);
    const { jitoBundle: _jitoBundle, integratorFees: _integratorFees, integratorId: _integratorId, ...identity } = a;
    assertToken(identity.fromToken, request.fromChainId, request);
    assertToken(identity.toToken, collection ? request.fromChainId : request.toChainId, request);
    if (identity.fromChainId !== request.fromChainId || identity.toChainId !== (collection ? request.fromChainId : request.toChainId) ||
        identity.fromAmount !== amount || bridgeAddress(identity.fromAddress) !== BRIDGE_DIAMOND ||
        bridgeAddress(identity.toAddress) !== (collection ? BRIDGE_DIAMOND : request.recipient) || identity.slippage !== request.slippageBps / 10_000 ||
        (identity.destinationGasConsumption !== undefined && identity.destinationGasConsumption !== "0"))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "included_action_tuple");
}
function actionKeys(a) {
    if (Object.keys(a).some((k) => !["fromChainId", "toChainId", "fromToken", "toToken", "fromAmount", "fromAddress", "toAddress", "slippage", "destinationGasConsumption"].includes(k)))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "action_extension");
}
function includedActionKeys(a) {
    const { jitoBundle, integratorFees, integratorId, ...identity } = a;
    actionKeys(identity);
    if ((jitoBundle !== undefined && jitoBundle !== false) ||
        (integratorId !== undefined && integratorId !== "lifi-api") ||
        (integratorFees !== undefined && (jitoBundle !== false || integratorId !== "lifi-api")))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "included_action_metadata");
    if (integratorFees !== undefined)
        bridgeRecord(integratorFees);
}
function assertToken(value, chainId, request) {
    const token = bridgeRecord(value), asset = requestAsset(request, chainId);
    if (token.chainId !== chainId || token.decimals !== asset.decimals ||
        bridgeAddress(token.address) !== bridgeAssetAddress(asset))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "admitted_asset_metadata");
}
function parseFees(value, request) {
    return list(value, 16, "fee_count").map((value) => {
        const fee = bridgeRecord(value), token = bridgeRecord(fee.token), chainId = bridgeDestinationChain(token.chainId), address = bridgeAddress(token.address);
        if (typeof fee.included !== "boolean" || typeof fee.name !== "string" || fee.name.length < 1 || fee.name.length > 192 || /[\u0000-\u001f\u007f]/u.test(fee.name))
            bridgeFailure("APN_PROVIDER_PROTOCOL", "fee_semantics");
        // An included fee must be the admitted asset on one of the two route chains; anything else is the native coin.
        // For a native principal the included asset is itself the native coin, recorded as "native", never the sentinel.
        const onPair = [request.fromChainId, request.toChainId].includes(chainId);
        if (fee.included ? !onPair || token.decimals !== requestAsset(request, chainId).decimals || address !== bridgeAssetAddress(requestAsset(request, chainId))
            : token.decimals !== bridgeNativeCoin(request.fromChainId).decimals || address !== BRIDGE_ZERO_ADDRESS ||
                chainId !== request.fromChainId)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "fee_asset");
        return { name: fee.name, chainId, asset: fee.included ? bridgeFeeAsset(requestAsset(request, chainId)) : "native",
            amountAtomic: bridgeUint(fee.amount).toString(), included: fee.included };
    });
}
function stepIdentity(step, included = false) {
    const rawAction = bridgeRecord(step.action);
    const { jitoBundle: _jitoBundle, integratorFees: _integratorFees, integratorId: _integratorId, ...action } = rawAction;
    const a = included ? action : rawAction;
    const normalizeToken = (v) => { const t = bridgeRecord(v); return { address: bridgeAddress(t.address), chainId: t.chainId, decimals: t.decimals }; };
    return { id: step.id, type: step.type, tool: step.tool, integrator: step.integrator ?? "lifi-api", fee: step.fee ?? 0,
        executionType: step.executionType ?? "transaction", toolKey: step.toolDetails === undefined ? step.tool : bridgeRecord(step.toolDetails).key,
        action: { ...a, fromAddress: bridgeAddress(a.fromAddress), toAddress: bridgeAddress(a.toAddress), fromToken: normalizeToken(a.fromToken), toToken: normalizeToken(a.toToken) },
        includedSteps: step.includedSteps === undefined ? [] : list(step.includedSteps, 8, "included_step_count").map((s) => stepIdentity(bridgeRecord(s), true)) };
}
function rejectExecutionExtensions(step) {
    for (const key of ["typedData", "permit", "permit2", "authorization", "destinationCall", "destinationCalls", "contractCalls", "userOperation"])
        if (step[key] !== undefined)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "execution_extension");
    if ((step.executionType !== undefined && step.executionType !== "transaction") || (step.gasless !== undefined && step.gasless !== false))
        bridgeFailure("APN_PROVIDER_PROTOCOL", "execution_mode");
}
function list(value, maximum, reason) {
    if (!Array.isArray(value) || value.length > maximum)
        bridgeFailure("APN_PROVIDER_PROTOCOL", reason);
    return value;
}
function providerQuantity(value) {
    if (typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/u.test(value))
        return BigInt(value);
    return bridgeUint(value);
}
export function bridgeRouteProjection(choice) {
    return { route_id: choice.routeId, step_id: choice.stepId, tool: choice.tool, quoted_output_atomic: choice.quotedOutputAtomic,
        minimum_output_atomic: choice.minimumOutputAtomic, preparable: choice.preparable, executable: false,
        executability_gate: choice.unavailableReason ?? "selected_materialization_rpc_deployment_fee_and_consent_required", route_hash: choice.routeHash };
}
//# sourceMappingURL=routes.js.map