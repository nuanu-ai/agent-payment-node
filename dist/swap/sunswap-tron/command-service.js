import { ApnError } from "../../errors.js";
import { SwapOperationRepository } from "../repository.js";
import { loadSunSwapPinCatalog } from "./catalog.js";
export async function executeSunSwapCommand(request, context) {
    if (request.command === "swap.sunswap.inventory")
        return data({ catalog: loadSunSwapPinCatalog(), admitted: false,
            execution: "dormant" }, "official_catalog_not_owner_admission");
    if (request.command === "swap.sunswap.quote") {
        if (context.sunswap === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "SunSwap quote requires an explicitly injected read-only builder.", { reason: "sunswap_runtime_unavailable" });
        return data(await context.sunswap.quote({ ...request, now: context.clock.now() }), "unsigned_read_only_swap_quote");
    }
    if (request.command === "swap.sunswap.prepare")
        throw new ApnError("APN_OPERATION_BLOCKED", "No active owner swap admission is installed; catalog presence does not authorize preparation.", { reason: "sunswap_owner_admission_required" });
    if (request.command === "swap.sunswap.status")
        return await status(request.operationId, context);
    if (request.command === "swap.sunswap.approve")
        throw new ApnError("APN_OPERATION_BLOCKED", "Native TRX input has no TRC20 or Permit2 approval operation.", { reason: "sunswap_native_no_approval" });
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
//# sourceMappingURL=command-service.js.map