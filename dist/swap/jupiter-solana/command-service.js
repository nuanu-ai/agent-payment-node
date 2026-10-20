import { ApnError } from "../../errors.js";
import { SwapOperationRepository } from "../repository.js";
import { SWAP_TERMINAL_STATES } from "../model.js";
import { JUPITER_V6_PROGRAM, SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT, WRAPPED_SOL_MINT } from "./catalog.js";
import { JUPITER_V1_HISTORICAL_ROUTES, JUPITER_V1_KNOWN_ROUTES, JUPITER_V1_ROUTES } from "./v1-route-config.js";
import { JUPITER_V1_IMMUTABLE_PROGRAMS, JUPITER_V1_PROGRAM_AUTHORITIES } from "./v1-pins.js";
import { SWAP_INVENTORY_OWNER_ADMISSION, swapRouteDigest, swapRouteOf } from "../route-admission.js";
import { assertJupiterV1Runtime } from "./v1-runtime-factory.js";
import { swapMechanismDigest } from "../pin.js";
import { JupiterV1DispatchStore } from "./v1-dispatch.js";
import { JupiterV1ExecutionFailureStore } from "./v1-execution-failure.js";
import { swapStatusReceipt } from "../receipt-facts.js";
export async function executeJupiterCommand(request, context) {
    if (request.command === "swap.jupiter.inventory")
        return data(jupiterInventory(context.jupiterV1Runtime !== undefined), "official_catalog_not_owner_admission");
    // The runtime factory installs the V1 runtime for every swap.jupiter.* command; only a bare test core lacks it.
    const runtime = context.jupiterV1Runtime;
    if (runtime === undefined)
        throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Jupiter commands require the installed Jupiter V1 runtime.", { reason: "jupiter_runtime_unavailable" });
    assertJupiterV1Runtime(runtime, context.state.root);
    if (request.command === "swap.jupiter.quote")
        return data(await runtime.quote(request, context.clock.now()), "unsigned_exact_simulated_swap_quote");
    if (request.command === "swap.jupiter.prepare")
        return operationOutcome(await runtime.prepare(request, context.clock.now()));
    const op = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
    if (op === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
    if (!JUPITER_V1_KNOWN_ROUTES.some(route => op.mechanismDigest === swapMechanismDigest(route.mechanismPin)))
        throw new ApnError("APN_OPERATION_BLOCKED", "This operation belongs to another mechanism.");
    if (request.command === "swap.jupiter.status") {
        const current = await runtime.status(request.operationId, context.clock.now());
        return { ...await withDispatch(current, context), receipt: await swapStatusReceipt(current, async () => await runtime.actualEconomics(current)) };
    }
    if (request.command === "swap.jupiter.approve")
        return await withDispatch(await runtime.approveAndExecute(request.operationId, context.clock.now()), context);
    return await withDispatch(await runtime.execute(request.operationId, context.clock.now()), context);
}
/** One current route per pool quotes; the byte-pinned generations of APN 0.5.42 and earlier stay listed for observation only. */
function jupiterInventory(installed) {
    const route = (r) => ({ routeId: r.routeId, pool: r.pool, route: swapRouteOf(r.mechanismPin),
        routeDigest: swapRouteDigest(r.mechanismPin), mechanismPin: r.mechanismPin, mechanismDigest: swapMechanismDigest(r.mechanismPin),
        protocolRegistryDigest: r.protocolRegistry.registryDigest });
    return { catalog: Object.freeze({ genesis: SOLANA_MAINNET_GENESIS, program: JUPITER_V6_PROGRAM, nativeInput: WRAPPED_SOL_MINT, outputToken: SOLANA_USDC_MINT }),
        ownerAdmission: SWAP_INVENTORY_OWNER_ADMISSION, execution: installed ? "foreground_cli_after_owner_admission" : "dormant",
        v1: { installed, provenance: "upgrade_authority", programAuthorities: [...JUPITER_V1_PROGRAM_AUTHORITIES, ...JUPITER_V1_IMMUTABLE_PROGRAMS],
            routes: JUPITER_V1_ROUTES.map(route),
            historicalObserveOnly: JUPITER_V1_HISTORICAL_ROUTES.map((r) => ({ routeId: r.routeId, mechanismDigest: swapMechanismDigest(r.mechanismPin) })) } };
}
function data(value, proofClass) {
    return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
function operationOutcome(operation) {
    const terminal = SWAP_TERMINAL_STATES.includes(operation.state);
    const approvable = ["awaiting_approval", "reserved"].includes(operation.state) && operation.submissionMarker === null;
    return { proofClass: operation.state, data: null, operation, receipt: null, nextActions: terminal ? [] :
            [`apn swap solana jupiter ${approvable ? "approve" : "status"} --operation ${operation.operationId}`] };
}
async function withDispatch(operation, context) {
    const observation = await new JupiterV1DispatchStore(context.state.root).load(operation);
    const failure = await new JupiterV1ExecutionFailureStore(context.state.root).load(operation);
    return { ...operationOutcome(operation), data: observation === null && failure === null ? null : { ...(observation === null ? {} : { dispatchObservation: observation }), ...(failure === null ? {} : { executionFailure: failure }) } };
}
//# sourceMappingURL=command-service.js.map