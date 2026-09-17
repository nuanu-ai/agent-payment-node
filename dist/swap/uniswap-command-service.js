import { ApnError } from "../errors.js";
import { SwapOperationRepository } from "./repository.js";
import { UNISWAP_OFFICIAL_PIN_CATALOG } from "./uniswap-pin.js";
export async function executeUniswapCommand(request, context) {
    if (request.command === "swap.uniswap.inventory")
        return data({ catalog: UNISWAP_OFFICIAL_PIN_CATALOG, admitted: false,
            execution: "dormant" }, "official_catalog_not_owner_admission");
    if (request.command === "swap.uniswap.quote") {
        if (context.uniswap === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap quote requires an explicitly configured Trading API and Ethereum RPC adapter.", { reason: "uniswap_runtime_unavailable" });
        return data(await context.uniswap.quote({ ...request, now: context.clock.now() }), "unsigned_exact_simulated_swap_quote");
    }
    if (request.command === "swap.uniswap.prepare")
        throw new ApnError("APN_OPERATION_BLOCKED", "No active owner swap admission is installed; staged allowlist data does not authorize preparation.", { reason: "uniswap_owner_admission_required" });
    if (request.command === "swap.uniswap.status") {
        const operation = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
        return { proofClass: operation.state, data: null, operation, receipt: null, nextActions: [] };
    }
    if (request.command === "swap.uniswap.approve")
        throw new ApnError("APN_OPERATION_BLOCKED", "Native ETH input has no ERC20 or Permit2 approval operation.", { reason: "uniswap_native_no_approval" });
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap signing and sending are dormant until a complete exact single-send adapter is installed.", { reason: "uniswap_execution_dormant" });
}
function data(value, proofClass) {
    return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
//# sourceMappingURL=uniswap-command-service.js.map