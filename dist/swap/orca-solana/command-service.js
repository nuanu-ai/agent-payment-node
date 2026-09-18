import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import { SwapOperationRepository } from "../repository.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_PROTOCOL_REGISTRY, ORCA_POOL_FEE_RATE, ORCA_POOL_TICK_SPACING, ORCA_PROGRAM_PINS, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT, ORCA_SOLANA_CHAIN, ORCA_USDC_VAULT, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG, WSOL_MINT, } from "./pins.js";
/** Inventory is the owner's source for the keyless pin and digest; nothing here admits or signs anything. */
export function orcaInventory(runtimeInstalled) {
    return { chain: ORCA_SOLANA_CHAIN, admitted: false, execution: runtimeInstalled ? "foreground_cli_after_owner_admission" : "dormant",
        pool: { address: ORCA_SOL_USDC_POOL, program: WHIRLPOOL_PROGRAM, config: WHIRLPOOLS_CONFIG, tokenA: WSOL_MINT, tokenB: USDC_MINT,
            vaultA: ORCA_SOL_VAULT, vaultB: ORCA_USDC_VAULT, tickSpacing: ORCA_POOL_TICK_SPACING, feeRate: ORCA_POOL_FEE_RATE, direction: "SOL_to_USDC_exact_input" },
        allowedPrograms: [COMPUTE_BUDGET_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, WHIRLPOOL_PROGRAM], programPins: ORCA_PROGRAM_PINS,
        keyless: { mechanismPin: ORCA_KEYLESS_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN),
            protocolRegistryDigest: ORCA_KEYLESS_PROTOCOL_REGISTRY.registryDigest } };
}
export async function executeOrcaCommand(request, context) {
    const runtime = context.orcaRuntime;
    if (request.command === "swap.orca.inventory")
        return data(orcaInventory(runtime !== undefined), "official_catalog_not_owner_admission");
    if (request.command === "swap.orca.status" && runtime === undefined) {
        const operation = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
        return { proofClass: operation.state, data: null, operation, receipt: null, nextActions: [] };
    }
    if (runtime === undefined)
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The keyless Orca runtime is not installed for this command.", { reason: "orca_runtime_unavailable" });
    if (request.command === "swap.orca.quote") {
        const { command: _command, ...quote } = request;
        return data(await runtime.quote(quote, context.clock.now()), "unsigned_exact_simulated_swap_quote");
    }
    if (request.command === "swap.orca.prepare")
        return operationOutcome(await runtime.prepare(request, context.clock.now()));
    if (request.command === "swap.orca.status")
        return operationOutcome(await runtime.status(request.operationId, context.clock.now()));
    // Foreground CLI: the typed approval code and the single send are one command, like the Uniswap path.
    if (request.command === "swap.orca.approve")
        return operationOutcome(await runtime.approveAndExecute(request.operationId, context.clock.now()));
    return operationOutcome(await runtime.execute(request.operationId, context.clock.now()));
}
function data(value, proofClass) { return { proofClass, data: value, operation: null, receipt: null, nextActions: [] }; }
function operationOutcome(value) {
    return { proofClass: value.state, data: null, operation: value, receipt: null, nextActions: [] };
}
//# sourceMappingURL=command-service.js.map