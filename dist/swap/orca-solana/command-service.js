import { ApnError } from "../../errors.js";
import { isPlainRecord } from "../../canonical.js";
import { swapMechanismDigest } from "../pin.js";
import { SWAP_INVENTORY_OWNER_ADMISSION, swapRouteDigest, swapRouteOf } from "../route-admission.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN } from "./stable-mechanism.js";
import { SwapOperationRepository } from "../repository.js";
import { orcaStableInventory } from "./stable-readonly.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, isOrcaKeylessMechanismDigest, ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_PROTOCOL_REGISTRY, ORCA_POOL_TICK_SPACING, ORCA_PROGRAM_AUTHORITIES, ORCA_SOL_USDC_POOL, ORCA_SOL_VAULT, ORCA_SOLANA_CHAIN, ORCA_USDC_VAULT, SYSTEM_PROGRAM, TOKEN_PROGRAM, USDC_MINT, WHIRLPOOL_PROGRAM, WHIRLPOOLS_CONFIG, WSOL_MINT, } from "./pins.js";
/** Inventory is the owner's source for the keyless pin and digest; nothing here admits or signs anything. */
export function orcaInventory(runtimeInstalled) {
    return { chain: ORCA_SOLANA_CHAIN, ownerAdmission: SWAP_INVENTORY_OWNER_ADMISSION, execution: runtimeInstalled ? "foreground_cli_after_owner_admission" : "dormant",
        pool: { address: ORCA_SOL_USDC_POOL, program: WHIRLPOOL_PROGRAM, config: WHIRLPOOLS_CONFIG, tokenA: WSOL_MINT, tokenB: USDC_MINT,
            vaultA: ORCA_SOL_VAULT, vaultB: ORCA_USDC_VAULT, tickSpacing: ORCA_POOL_TICK_SPACING, feeRate: "read_from_pool_at_quote", direction: "SOL_to_USDC_exact_input" },
        allowedPrograms: [COMPUTE_BUDGET_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, WHIRLPOOL_PROGRAM], programAuthorities: ORCA_PROGRAM_AUTHORITIES,
        keyless: { route: swapRouteOf(ORCA_KEYLESS_MECHANISM_PIN), routeDigest: swapRouteDigest(ORCA_KEYLESS_MECHANISM_PIN),
            mechanismPin: ORCA_KEYLESS_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(ORCA_KEYLESS_MECHANISM_PIN),
            protocolRegistryDigest: ORCA_KEYLESS_PROTOCOL_REGISTRY.registryDigest } };
}
export async function executeOrcaCommand(request, context) {
    const runtime = context.orcaRuntime;
    if (request.command === "swap.orca.inventory")
        return data(orcaInventory(runtime !== undefined), "official_catalog_not_owner_admission");
    if (request.command === "swap.orca.stable-inventory")
        return data({ ...orcaStableInventory(), route: swapRouteOf(ORCA_STABLE_GUARDED_MECHANISM_PIN),
            routeDigest: swapRouteDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN) }, "pinned_read_only_inventory");
    if (request.command === "swap.orca.stable-quote") {
        if (context.orcaStableQuote === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca quote reader is unavailable.");
        return data(await context.orcaStableQuote(request), "read_only_market_quote");
    }
    if (request.command === "swap.orca.stable-prepare") {
        if (context.orcaStablePrepare === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca preparation is unavailable.");
        return data(await context.orcaStablePrepare(request), "unsigned_simulated_stable_preparation");
    }
    if (request.command === "swap.orca.stable-status") {
        if (context.orcaStableStatus === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca status is unavailable.");
        return data(await context.orcaStableStatus(request.operationId), "stable_operation_status");
    }
    if (request.command === "swap.orca.stable-approve" || request.command === "swap.orca.stable-execute") {
        // One foreground consent: approve reserves and executes; execute (its own consent) serves a reservation left unexecuted.
        const run = request.command === "swap.orca.stable-approve" ? context.orcaStableApprove : context.orcaStableExecute;
        if (run === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca execution is unavailable.");
        const result = await run(request.operationId);
        if (isPlainRecord(result) && result.signature === null) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Stable execution stopped after its durable marker without a proved send. Principal remains held.", { reason: "orca_stable_marked_no_send_unproven", nextActions: [
                    `apn swap solana orca stable-recover-no-send --operation ${request.operationId}`
                ] });
        }
        return data(result, "stable_first_send_attempt");
    }
    if (request.command === "swap.orca.stable-recover-no-send") {
        if (context.orcaStableRecoverNoSend === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca no-send recovery is unavailable.");
        return data(await context.orcaStableRecoverNoSend(request.operationId), "stable_no_send_proved_principal_released");
    }
    if (request.command === "swap.orca.stable-observe") {
        if (context.orcaStableObserve === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca observation is unavailable.");
        return data(await context.orcaStableObserve(request.operationId), "stable_observation");
    }
    if (request.command === "swap.orca.stable-release") {
        if (context.orcaStableRelease === undefined)
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca release is unavailable.");
        return data(await context.orcaStableRelease(request.operationId), "stable_unsigned_principal_released");
    }
    if (request.command === "swap.orca.status" || request.command === "swap.orca.approve" || request.command === "swap.orca.execute") {
        const operation = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
        // Any registered generation stays readable; the runtime admits only the current registry for approval or signing.
        if (!isOrcaKeylessMechanismDigest(operation.mechanismDigest))
            throw new ApnError("APN_OPERATION_BLOCKED", "This operation is outside the native SOL to USDC Orca runtime.", { reason: "orca_mechanism_mismatch" });
    }
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