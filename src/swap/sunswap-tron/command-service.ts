import type { CommandOutcome, CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import type { RuntimeContext } from "../../runtime.js";
import { swapMechanismDigest } from "../pin.js";
import { SWAP_INVENTORY_OWNER_ADMISSION, swapRouteDigest, swapRouteOf } from "../route-admission.js";
import { SwapOperationRepository } from "../repository.js";
import { SUNSWAP_PINNED_CONTRACTS, SUNSWAP_V2_CODE_HASHES, loadSunSwapPinCatalog } from "./catalog.js";
import { SUNSWAP_V2_KEYLESS_MECHANISM_PIN, SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY } from "./mechanism.js";
import { swapActualEconomics, swapStatusReceipt } from "../receipt-facts.js";

type Request = Extract<CommandRequest, { readonly command: `swap.sunswap.${string}` }>;
export async function executeSunSwapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome> {
  if (request.command === "swap.sunswap.inventory") return data({ catalog: loadSunSwapPinCatalog(), ownerAdmission: SWAP_INVENTORY_OWNER_ADMISSION,
    execution: context.sunswapRuntime === undefined ? "dormant" : "foreground_cli_after_owner_admission",
    keyless: { route: swapRouteOf(SUNSWAP_V2_KEYLESS_MECHANISM_PIN), routeDigest: swapRouteDigest(SUNSWAP_V2_KEYLESS_MECHANISM_PIN),
      mechanismPin: SUNSWAP_V2_KEYLESS_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(SUNSWAP_V2_KEYLESS_MECHANISM_PIN),
      protocolRegistryDigest: SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY.registryDigest,
      codePins: SUNSWAP_PINNED_CONTRACTS.map(({ role, address }) => ({ role, address, codeHash: SUNSWAP_V2_CODE_HASHES[role] })) } },
  "official_catalog_not_owner_admission");
  if (request.command === "swap.sunswap.quote") {
    if (context.sunswapRuntime === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
      "SunSwap quote requires the keyless TRON runtime.", { reason: "sunswap_runtime_unavailable" });
    return data(await context.sunswapRuntime.quote(request, context.clock.now()), "unsigned_exact_simulated_swap_quote");
  }
  if (request.command === "swap.sunswap.prepare") {
    if (context.sunswapRuntime === undefined) throw new ApnError("APN_OPERATION_BLOCKED",
      "No active owner swap admission is installed; catalog presence does not authorize preparation.",
      { reason: "sunswap_owner_admission_required" });
    return operation(await context.sunswapRuntime.prepare(request, context.clock.now()));
  }
  if (request.command === "swap.sunswap.status") return context.sunswapRuntime === undefined
    ? await status(request.operationId, context) : await withEconomics(await context.sunswapRuntime.status(request.operationId, context.clock.now()), context);
  if (request.command === "swap.sunswap.approve") {
    if (context.sunswapRuntime === undefined) throw new ApnError("APN_OPERATION_BLOCKED",
      "Native TRX input has no TRC20 or Permit2 approval operation.", { reason: "sunswap_native_no_approval" });
    // Foreground CLI: the typed approval code and the single broadcast are one command, like Uniswap approve.
    return operation(await context.sunswapRuntime.approveAndExecute(request.operationId, context.clock.now()));
  }
  if (context.sunswapRuntime !== undefined) return operation(await context.sunswapRuntime.execute(request.operationId, context.clock.now()));
  throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
    "SunSwap signing and sending are dormant until a complete exact single-send adapter is installed.",
    { reason: "sunswap_execution_dormant" });
}

async function status(operationId: string, context: RuntimeContext): Promise<CommandOutcome> {
  const operation = await new SwapOperationRepository(context.state.root).loadAny(operationId);
  if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
  return { proofClass: operation.state, data: null, operation, nextActions: [],
    receipt: await swapStatusReceipt(operation, async () => await swapActualEconomics(context.state.root, operation, undefined, context.clock.now())) };
}
/** A status beside its record: the swap's actual economics, or the named refusal of the one read that would prove them. */
async function withEconomics(value: Awaited<ReturnType<NonNullable<RuntimeContext["sunswapRuntime"]>["status"]>>, context: RuntimeContext): Promise<CommandOutcome> {
  return { ...operation(value), receipt: await swapStatusReceipt(value, async () => await context.sunswapRuntime!.actualEconomics(value)) };
}
function data(value: unknown, proofClass: string): CommandOutcome {
  return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
function operation(value: Awaited<ReturnType<NonNullable<RuntimeContext["sunswapRuntime"]>["status"]>>): CommandOutcome {
  return { proofClass: value.state, data: null, operation: value, receipt: null, nextActions: [] };
}
