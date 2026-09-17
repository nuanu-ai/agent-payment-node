import { ApnError } from "../../errors.js";
import { SwapOperationRepository } from "../repository.js";
import { EMPTY_PROGRAM_SNAPSHOT, JUPITER_SOLANA_SCHEMA, JUPITER_SWAP_API_V2, JUPITER_V2_SOURCE, JUPITER_V6_PROGRAM, SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT, WRAPPED_SOL_MINT, } from "./catalog.js";
export async function executeJupiterCommand(request, context) {
    if (request.command === "swap.jupiter.inventory")
        return data({ catalog: Object.freeze({ schemaVersion: JUPITER_SOLANA_SCHEMA,
                genesis: SOLANA_MAINNET_GENESIS, api: JUPITER_SWAP_API_V2, program: JUPITER_V6_PROGRAM, nativeInput: WRAPPED_SOL_MINT,
                outputToken: SOLANA_USDC_MINT, source: JUPITER_V2_SOURCE, programSnapshot: EMPTY_PROGRAM_SNAPSHOT }), admitted: false,
            execution: "dormant" }, "official_catalog_not_owner_admission");
    if (request.command === "swap.jupiter.quote") {
        if (context.jupiter === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Jupiter quote requires an explicitly injected read-only builder.", { reason: "jupiter_runtime_unavailable" });
        return data(await context.jupiter.quote({ ...request, now: context.clock.now() }), "unsigned_read_only_swap_quote");
    }
    if (request.command === "swap.jupiter.prepare")
        throw new ApnError("APN_OPERATION_BLOCKED", "No active owner swap admission is installed; catalog presence does not authorize preparation.", { reason: "jupiter_owner_admission_required" });
    if (request.command === "swap.jupiter.status")
        return await status(request.operationId, context);
    throw new ApnError("APN_OPERATION_BLOCKED", "Jupiter approval and execution remain blocked because the JUP6 instruction and account ABI is not verified for signing.", { reason: "jupiter_v6_instruction_unverified" });
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