import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import { SwapOperationRepository } from "../repository.js";
import { SUNSWAP_PINNED_CONTRACTS, SUNSWAP_V2_CODE_HASHES, loadSunSwapPinCatalog } from "./catalog.js";
import { SUNSWAP_V2_KEYLESS_MECHANISM_PIN, SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY } from "./mechanism.js";
export async function executeSunSwapCommand(request, context) {
    if (request.command === "swap.sunswap.inventory")
        return data({ catalog: loadSunSwapPinCatalog(), admitted: false,
            execution: context.sunswapRuntime === undefined ? "dormant" : "foreground_cli_after_owner_admission",
            keyless: { mechanismPin: SUNSWAP_V2_KEYLESS_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(SUNSWAP_V2_KEYLESS_MECHANISM_PIN),
                protocolRegistryDigest: SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY.registryDigest,
                codePins: SUNSWAP_PINNED_CONTRACTS.map(({ role, address }) => ({ role, address, codeHash: SUNSWAP_V2_CODE_HASHES[role] })) } }, "official_catalog_not_owner_admission");
    if (request.command === "swap.sunswap.quote") {
        if (context.sunswapRuntime !== undefined)
            return data(await context.sunswapRuntime.quote(request, context.clock.now()), "unsigned_exact_simulated_swap_quote");
        if (context.sunswap === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "SunSwap quote requires an explicitly injected read-only builder.", { reason: "sunswap_runtime_unavailable" });
        return data(await context.sunswap.quote({ ...request, now: context.clock.now() }), "unsigned_read_only_swap_quote");
    }
    if (request.command === "swap.sunswap.prepare") {
        if (context.sunswapRuntime === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "No active owner swap admission is installed; catalog presence does not authorize preparation.", { reason: "sunswap_owner_admission_required" });
        return operation(await context.sunswapRuntime.prepare(request, context.clock.now()));
    }
    if (request.command === "swap.sunswap.status")
        return context.sunswapRuntime === undefined
            ? await status(request.operationId, context) : operation(await context.sunswapRuntime.status(request.operationId, context.clock.now()));
    if (request.command === "swap.sunswap.approve") {
        if (context.sunswapRuntime === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "Native TRX input has no TRC20 or Permit2 approval operation.", { reason: "sunswap_native_no_approval" });
        // Foreground CLI: the typed approval code and the single broadcast are one command, like Uniswap approve.
        return operation(await context.sunswapRuntime.approveAndExecute(request.operationId, context.clock.now()));
    }
    if (context.sunswapRuntime !== undefined)
        return operation(await context.sunswapRuntime.execute(request.operationId, context.clock.now()));
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "SunSwap signing and sending are dormant until a complete exact single-send adapter is installed.", { reason: "sunswap_execution_dormant" });
}
async function status(operationId, context) {
    const operation = await new SwapOperationRepository(context.state.root).loadAny(operationId);
    if (operation === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
    return { proofClass: operation.state, data: null, operation, receipt: null, nextActions: [] };
}
function data(value, proofClass) {
    return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
function operation(value) {
    return { proofClass: value.state, data: null, operation: value, receipt: null, nextActions: [] };
}
//# sourceMappingURL=command-service.js.map