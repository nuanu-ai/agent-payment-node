import { ApnError } from "../../errors.js";
import { tokenOutcome } from "../uniswap-command-service.js";
/** `apn swap bnb uniswap-token …`: the Ethereum token lane's seven actions over the BNB Smart Chain token runtime. */
export async function executeUniswapBnbTokenCommand(request, context) {
    const runtime = context.uniswapBnbTokenRuntime;
    if (runtime === undefined)
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "BNB Uniswap token-input runtime is unavailable.", { reason: "uniswap_bnb_token_runtime_unavailable" });
    if (request.command === "swap.uniswap-bnb-token.inventory")
        return data(runtime.inventory(), "exact_token_route_inventory");
    if (request.command === "swap.uniswap-bnb-token.quote")
        return data(await runtime.quote(request), "unsigned_exact_simulated_swap_quote");
    if (request.command === "swap.uniswap-bnb-token.prepare")
        return tokenOutcome(await runtime.prepare(request));
    if (request.command === "swap.uniswap-bnb-token.approve")
        return tokenOutcome(await runtime.approve(request.operationId));
    if (request.command === "swap.uniswap-bnb-token.execute") {
        const executed = await runtime.execute(request.operationId);
        return tokenOutcome(executed, await runtime.residualAllowance?.(executed) ?? null, "execute");
    }
    if (request.command === "swap.uniswap-bnb-token.cleanup")
        return tokenOutcome(await runtime.cleanup(request.operationId, request.cleanupFees));
    const status = await runtime.status(request.operationId);
    return tokenOutcome(status, await runtime.residualAllowance?.(status) ?? null);
}
function data(value, proofClass) {
    return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
//# sourceMappingURL=token-command-service.js.map