import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { bridgeChain, bridgeNativeCoin, bridgeTokenRow } from "./asset-registry.js";
import { decodeBridgeCall } from "./decode.js";
import { LIFI_ROUTE_RESPONSE_BYTES } from "./provider.js";
import { BRIDGE_DIAMOND, BRIDGE_MAX_GAS, BRIDGE_ZERO_ADDRESS, bridgeAddress, bridgeFailure, bridgeHex, bridgeJson, bridgeOpaque, bridgeRecord, bridgeSame, bridgeUint } from "./validation.js";
/** The admitted row for the leg of the request that this chain identifies. Both chains are distinct by construction. */
function requestAsset(request, chainId) {
    if (chainId === request.fromChainId)
        return bridgeTokenRow(chainId, request.fromToken);
    if (chainId === request.toChainId)
        return bridgeTokenRow(chainId, request.toToken);
    return bridgeFailure("APN_PROVIDER_PROTOCOL", "route_chain_identity");
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
        const tool = bridgeOpaque(step.tool), admitted = tool === "across" || tool === "stargateV2";
        // These rows are candidates for finite materialization, never final execution authority.
        return { route, step, choice: { routeId, stepId: bridgeOpaque(step.id), tool, quotedOutputAtomic: output, minimumOutputAtomic: minimum,
                routeHash: hashObject(route), stepHash: hashObject(step), stepIdentityHash: hashObject(stepIdentity(step)),
                preparable: admitted, unavailableReason: admitted ? null : "finite_decoder_and_correlated_evidence_unavailable" } };
    });
    if (new Set(results.map((r) => r.choice.routeId)).size !== results.length || new Set(results.map((r) => r.choice.stepId)).size !== results.length)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "duplicate_route_identity");
    return results;
}
export function materializeBridgeRoute(selected, response, request, sender) {
    if (!selected.choice.preparable)
        bridgeFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "finite_bridge_decoder_unavailable");
    if (response.status !== 200)
        bridgeFailure("APN_PROVIDER_UNAVAILABLE", "step_materialization_status");
    const step = bridgeRecord(bridgeJson(response.body, LIFI_ROUTE_RESPONSE_BYTES));
    assertStep(step, request, sender);
    if (hashObject(stepIdentity(step)) !== selected.choice.stepIdentityHash)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "materialized_step_identity_changed");
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
    if (subs.length !== 2 || subs[0].tool !== "feeCollection" || subs[0].type !== "protocol" ||
        subs[1].tool !== m.tool || subs[1].type !== "cross")
        bridgeFailure("APN_PROVIDER_PROTOCOL", "included_effect_graph");
    assertIncludedAction(bridgeRecord(subs[0].action), request, request.amountAtomic, true);
    assertIncludedAction(bridgeRecord(subs[1].action), request, decoded.bridgeAmountAtomic, false);
    const implicitProtocolFeeAtomic = validateRouteEconomics(m);
    return { materialization: m, implicitProtocolFeeAtomic, providerNonceAtomic: tx.nonce === undefined ? null : providerQuantity(tx.nonce).toString() };
}
export function validateRouteEconomics(m) {
    const r = m.request, amount = bridgeUint(r.amountAtomic, true), output = bridgeUint(m.quotedOutputAtomic, true), minimum = bridgeUint(m.minimumOutputAtomic, true);
    if (output > amount || minimum > output || minimum < bridgeUint(r.minOutputAtomic, true) ||
        (output - minimum) * 10000n > output * BigInt(r.slippageBps) || amount - minimum > bridgeUint(r.maxRouteFeeAtomic))
        bridgeFailure("APN_FEE_BUDGET_EXCEEDED", "bridge_output_or_token_fee_limit");
    let included = 0n;
    const additional = [];
    for (const fee of m.feeCosts) {
        if (fee.included) {
            if ((fee.chainId !== r.fromChainId && fee.chainId !== r.toChainId) || fee.asset !== requestAsset(r, fee.chainId).address)
                bridgeFailure("APN_PROVIDER_PROTOCOL", "included_fee_asset");
            included += bridgeUint(fee.amountAtomic);
        }
        else
            additional.push(fee);
    }
    if (included + output > amount)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "token_fee_double_count");
    if (m.tool === "across" ? additional.length !== 0 || m.transaction.valueAtomic !== "0" :
        additional.length !== 1 || additional[0].chainId !== r.fromChainId || additional[0].asset !== "native" ||
            additional[0].amountAtomic !== m.transaction.valueAtomic)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "native_fee_identity");
    return (amount - included - output).toString();
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
    const estimate = bridgeRecord(step.estimate);
    if (estimate.tool !== step.tool || estimate.fromAmount !== request.amountAtomic ||
        bridgeAddress(estimate.approvalAddress) !== BRIDGE_DIAMOND || estimate.approvalReset === true || estimate.skipApproval === true)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "approval_semantics");
    for (const key of ["approvalReset", "skipApproval", "skipPermit"])
        if (estimate[key] !== undefined && typeof estimate[key] !== "boolean")
            bridgeFailure("APN_PROVIDER_PROTOCOL", "approval_flag");
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
    for (const value of subs) {
        const sub = bridgeRecord(value);
        bridgeOpaque(sub.id);
        bridgeOpaque(sub.tool);
        rejectExecutionExtensions(sub);
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
        if (value.slippage !== request.slippageBps / 10_000 || (value.destinationGasConsumption !== undefined && value.destinationGasConsumption !== "0"))
            bridgeFailure("APN_PROVIDER_PROTOCOL", "slippage_or_destination_call");
    }
}
function assertIncludedAction(a, request, amount, collection) {
    actionKeys(a);
    assertToken(a.fromToken, request.fromChainId, request);
    assertToken(a.toToken, collection ? request.fromChainId : request.toChainId, request);
    if (a.fromChainId !== request.fromChainId || a.toChainId !== (collection ? request.fromChainId : request.toChainId) ||
        a.fromAmount !== amount || bridgeAddress(a.fromAddress) !== BRIDGE_DIAMOND ||
        bridgeAddress(a.toAddress) !== (collection ? BRIDGE_DIAMOND : request.recipient) || a.slippage !== request.slippageBps / 10_000 ||
        (a.destinationGasConsumption !== undefined && a.destinationGasConsumption !== "0"))
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
        bridgeAddress(token.address) !== asset.address)
        bridgeFailure("APN_PROVIDER_PROTOCOL", "admitted_asset_metadata");
}
function parseFees(value, request) {
    return list(value, 16, "fee_count").map((value) => {
        const fee = bridgeRecord(value), token = bridgeRecord(fee.token), chainId = bridgeChain(token.chainId), address = bridgeAddress(token.address);
        if (typeof fee.included !== "boolean" || typeof fee.name !== "string" || fee.name.length < 1 || fee.name.length > 192 || /[\u0000-\u001f\u007f]/u.test(fee.name))
            bridgeFailure("APN_PROVIDER_PROTOCOL", "fee_semantics");
        // An included fee must be the admitted asset on one of the two route chains; anything else is the native coin.
        const onPair = [request.fromChainId, request.toChainId].includes(chainId);
        if (fee.included ? !onPair || token.decimals !== requestAsset(request, chainId).decimals || address !== requestAsset(request, chainId).address
            : token.decimals !== bridgeNativeCoin(request.fromChainId).decimals || address !== BRIDGE_ZERO_ADDRESS ||
                chainId !== request.fromChainId)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "fee_asset");
        return { name: fee.name, chainId, asset: fee.included ? address : "native", amountAtomic: bridgeUint(fee.amount).toString(), included: fee.included };
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