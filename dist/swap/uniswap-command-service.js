import { ApnError } from "../errors.js";
import { SwapOperationRepository } from "./repository.js";
import { swapMechanismDigest } from "./pin.js";
import { SWAP_INVENTORY_OWNER_ADMISSION, swapRouteDigest, swapRouteOf } from "./route-admission.js";
import { UNISWAP_WBTC_MECHANISM_PIN, UNISWAP_WBTC_PROTOCOL_REGISTRY, UNISWAP_WBTC_PAIR, UNISWAP_WBTC_CODE_PINS, UNISWAP_V3_CODE_PINS, UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, UNISWAP_V3_PAIRS, USDC_IMPLEMENTATION_PIN } from "./uniswap-v3/pins.js";
import { swapActualEconomics } from "./receipt-facts.js";
export async function executeUniswapCommand(request, context) {
    if (request.command === "swap.uniswap-token.prepare" || request.command === "swap.uniswap-token.approve" ||
        request.command === "swap.uniswap-token.execute" || request.command === "swap.uniswap-token.cleanup" || request.command === "swap.uniswap-token.status" || request.command === "swap.uniswap-token.inventory" || request.command === "swap.uniswap-token.quote") {
        const runtime = context.uniswapTokenRuntime;
        if (runtime === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap token-input runtime is unavailable.", { reason: "uniswap_token_runtime_unavailable" });
        if (request.command === "swap.uniswap-token.prepare")
            return tokenOutcome(await runtime.prepare(request));
        if (request.command === "swap.uniswap-token.approve")
            return tokenOutcome(await runtime.approve(request.operationId));
        if (request.command === "swap.uniswap-token.execute")
            return tokenOutcome(await runtime.execute(request.operationId));
        if (request.command === "swap.uniswap-token.cleanup")
            return tokenOutcome(await runtime.cleanup(request.operationId));
        if (request.command === "swap.uniswap-token.inventory")
            return data(runtime.inventory(), "exact_token_route_inventory");
        if (request.command === "swap.uniswap-token.quote")
            return data(await runtime.quote(request), "unsigned_exact_simulated_swap_quote");
        return tokenOutcome(await runtime.status(request.operationId));
    }
    if (request.command === "swap.uniswap.inventory")
        return data({ ownerAdmission: SWAP_INVENTORY_OWNER_ADMISSION,
            execution: context.uniswapRuntime === undefined ? "dormant" : "foreground_cli_after_owner_admission",
            keyless: { route: swapRouteOf(UNISWAP_V3_KEYLESS_MECHANISM_PIN), routeDigest: swapRouteDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN),
                mechanismPin: UNISWAP_V3_KEYLESS_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN),
                protocolRegistryDigest: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY.registryDigest, pairs: UNISWAP_V3_PAIRS,
                codePins: [...UNISWAP_V3_CODE_PINS, USDC_IMPLEMENTATION_PIN] },
            wbtc: { route: swapRouteOf(UNISWAP_WBTC_MECHANISM_PIN), routeDigest: swapRouteDigest(UNISWAP_WBTC_MECHANISM_PIN),
                mechanismPin: UNISWAP_WBTC_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(UNISWAP_WBTC_MECHANISM_PIN),
                protocolRegistryDigest: UNISWAP_WBTC_PROTOCOL_REGISTRY.registryDigest, pair: UNISWAP_WBTC_PAIR, codePins: UNISWAP_WBTC_CODE_PINS, minimumOutputAtomic: "1000" } }, "official_catalog_not_owner_admission");
    if (request.command === "swap.uniswap.quote") {
        if (context.uniswapRuntime === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap quote requires the keyless Ethereum runtime.", { reason: "uniswap_runtime_unavailable" });
        return data(await context.uniswapRuntime.quote(request, context.clock.now()), "unsigned_exact_simulated_swap_quote");
    }
    if (request.command === "swap.uniswap.prepare") {
        if (context.uniswapRuntime === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "No active owner swap admission is installed; staged allowlist data does not authorize preparation.", { reason: "uniswap_owner_admission_required" });
        return operationOutcome(await context.uniswapRuntime.prepare(request, context.clock.now()));
    }
    if (request.command === "swap.uniswap.status") {
        if (context.uniswapRuntime !== undefined) {
            const operation = await context.uniswapRuntime.status(request.operationId, context.clock.now());
            return operationOutcome({ ...operation, ...await context.uniswapRuntime.actualEconomics(operation) });
        }
        const operation = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
        return { proofClass: operation.state, data: null, receipt: null, nextActions: [],
            operation: { ...operation, ...await swapActualEconomics(context.state.root, operation, undefined, context.clock.now()) } };
    }
    if (request.command === "swap.uniswap.approve") {
        if (context.uniswapRuntime === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "Native ETH input has no ERC20 or Permit2 approval operation.", { reason: "uniswap_native_no_approval" });
        // Foreground CLI: the typed approval code and the single send are one command, like bridge approve.
        return operationOutcome(await context.uniswapRuntime.approveAndExecute(request.operationId, context.clock.now()));
    }
    if (request.command === "swap.uniswap.execute" && context.uniswapRuntime !== undefined)
        return operationOutcome(await context.uniswapRuntime.execute(request.operationId, context.clock.now()));
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap signing and sending are dormant until a complete exact single-send adapter is installed.", { reason: "uniswap_execution_dormant" });
}
/**
 * The token lane's observed receipt already holds what the swap proved; `actualEconomics` gives it the shared swap shape:
 * the exact input debit, the output credit, every gas the operation paid (approval, swap, cleanup) and the ETH that left.
 */
function tokenOutcome(value) {
    const receipt = value.receipt, actualEconomics = receipt === null ? null : { inputAtomic: receipt.inputDebitAtomic,
        outputAtomic: receipt.outputCreditAtomic, networkFeeAtomic: (BigInt(receipt.approvalGasWei) + BigInt(receipt.swapGasWei) + BigInt(receipt.cleanupGasWei)).toString(),
        nativeDebitAtomic: receipt.nativeDebitWei };
    return { proofClass: value.phase, data: null, operation: { ...value, actualEconomics }, receipt: value.receipt, nextActions: [] };
}
function data(value, proofClass) {
    return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
function operationOutcome(value) {
    return { proofClass: value.state, data: null, operation: value, receipt: null, nextActions: [] };
}
//# sourceMappingURL=uniswap-command-service.js.map