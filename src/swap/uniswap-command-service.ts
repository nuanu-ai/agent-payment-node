import type { CommandOutcome, CommandRequest } from "../commands.js";
import { ApnError } from "../errors.js";
import type { RuntimeContext } from "../runtime.js";
import { SwapOperationRepository } from "./repository.js";
import { UNISWAP_OFFICIAL_PIN_CATALOG, UNISWAP_USDC } from "./uniswap-pin.js";
import { swapMechanismDigest } from "./pin.js";
import { UNISWAP_V3_CODE_PINS, UNISWAP_V3_KEYLESS_MECHANISM_PIN, UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, UNISWAP_V3_PAIRS,
  USDC_IMPLEMENTATION_PIN } from "./uniswap-v3/pins.js";

type Request = Extract<CommandRequest, { readonly command: `swap.uniswap.${string}` | `swap.uniswap-token.${string}` }>;
export async function executeUniswapCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome> {
  if (request.command === "swap.uniswap-token.prepare" || request.command === "swap.uniswap-token.approve" ||
      request.command === "swap.uniswap-token.execute" || request.command === "swap.uniswap-token.status" || request.command === "swap.uniswap-token.inventory" || request.command === "swap.uniswap-token.quote") {
    const runtime = context.uniswapTokenRuntime;
    if (runtime === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Uniswap token-input runtime is unavailable.", { reason: "uniswap_token_runtime_unavailable" });
    if (request.command === "swap.uniswap-token.prepare") return tokenOutcome(await runtime.prepare(request));
    if (request.command === "swap.uniswap-token.approve") return tokenOutcome(await runtime.approve(request.operationId));
    if (request.command === "swap.uniswap-token.execute") return tokenOutcome(await runtime.execute(request.operationId));
    if (request.command === "swap.uniswap-token.inventory") return data(runtime.inventory(), "exact_token_route_inventory");
    if (request.command === "swap.uniswap-token.quote") return data(await runtime.quote(request), "unsigned_exact_simulated_swap_quote");
    return tokenOutcome(await runtime.status(request.operationId));
  }
  if (request.command === "swap.uniswap.inventory") return data({ catalog: UNISWAP_OFFICIAL_PIN_CATALOG, admitted: false,
    execution: context.uniswapRuntime === undefined ? "dormant" : "foreground_cli_after_owner_admission",
    keyless: { mechanismPin: UNISWAP_V3_KEYLESS_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(UNISWAP_V3_KEYLESS_MECHANISM_PIN),
      protocolRegistryDigest: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY.registryDigest, pairs: UNISWAP_V3_PAIRS,
      codePins: [...UNISWAP_V3_CODE_PINS, USDC_IMPLEMENTATION_PIN] } }, "official_catalog_not_owner_admission");
  if (request.command === "swap.uniswap.quote") {
    if (context.uniswapRuntime !== undefined) return data(await context.uniswapRuntime.quote(request, context.clock.now()), "unsigned_exact_simulated_swap_quote");
    if (context.uniswap === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
      "Uniswap quote requires an explicitly configured Trading API and Ethereum RPC adapter.", { reason: "uniswap_runtime_unavailable" });
    if (request.outputToken !== UNISWAP_USDC) throw new ApnError("APN_OPERATION_BLOCKED",
      "The injected Trading API builder is pinned to native ETH to USDC only.", { reason: "uniswap_pair_unpinned" });
    return data(await context.uniswap.quote({ ...request, now: context.clock.now() }), "unsigned_exact_simulated_swap_quote");
  }
  if (request.command === "swap.uniswap.prepare") {
    if (context.uniswapRuntime === undefined) throw new ApnError("APN_OPERATION_BLOCKED",
      "No active owner swap admission is installed; staged allowlist data does not authorize preparation.", { reason: "uniswap_owner_admission_required" });
    return operationOutcome(await context.uniswapRuntime.prepare(request, context.clock.now()));
  }
  if (request.command === "swap.uniswap.status") {
    if (context.uniswapRuntime !== undefined) return operationOutcome(await context.uniswapRuntime.status(request.operationId, context.clock.now()));
    const operation = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
    if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
    return { proofClass: operation.state, data: null, operation, receipt: null, nextActions: [] };
  }
  if (request.command === "swap.uniswap.approve") {
    if (context.uniswapRuntime === undefined) throw new ApnError("APN_OPERATION_BLOCKED",
      "Native ETH input has no ERC20 or Permit2 approval operation.", { reason: "uniswap_native_no_approval" });
    // Foreground CLI: the typed approval code and the single send are one command, like bridge approve.
    return operationOutcome(await context.uniswapRuntime.approveAndExecute(request.operationId, context.clock.now()));
  }
  if (request.command === "swap.uniswap.execute" && context.uniswapRuntime !== undefined) return operationOutcome(await context.uniswapRuntime.execute(request.operationId, context.clock.now()));
  throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
    "Uniswap signing and sending are dormant until a complete exact single-send adapter is installed.", { reason: "uniswap_execution_dormant" });
}
function tokenOutcome(value: Awaited<ReturnType<NonNullable<RuntimeContext["uniswapTokenRuntime"]>["status"]>>): CommandOutcome {
  return { proofClass: value.phase, data: null, operation: value, receipt: value.receipt, nextActions: [] };
}
function data(value: unknown, proofClass: string): CommandOutcome {
  return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
function operationOutcome(value: Awaited<ReturnType<NonNullable<RuntimeContext["uniswapRuntime"]>["status"]>>): CommandOutcome {
  return { proofClass: value.state, data: null, operation: value, receipt: null, nextActions: [] };
}
