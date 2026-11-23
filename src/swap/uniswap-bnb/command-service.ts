import type { CommandOutcome, CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import type { RuntimeContext } from "../../runtime.js";
import type { SwapOperationRecord } from "../model.js";
import { swapMechanismDigest } from "../pin.js";
import { swapActualEconomics, swapStatusReceipt } from "../receipt-facts.js";
import { SwapOperationRepository } from "../repository.js";
import { SWAP_INVENTORY_OWNER_ADMISSION, swapRouteDigest, swapRouteOf } from "../route-admission.js";
import { BNB_UNISWAP_NATIVE_LANE } from "./lane.js";
import { BNB_CHAIN, BNB_UNISWAP_CODE_PINS, BNB_UNISWAP_MECHANISM_PIN, BNB_UNISWAP_PAIRS, BNB_UNISWAP_PROTOCOL_REGISTRY,
  BNB_USDC_IMPLEMENTATION_PIN } from "./pins.js";

type Request = Extract<CommandRequest, { readonly command: `swap.uniswap-bnb.${string}` }>;

/** `apn swap bnb uniswap …`: the same six guarded actions as the Ethereum keyless lane, over the BNB runtime. */
export async function executeUniswapBnbCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome> {
  const runtime = context.uniswapBnbRuntime;
  if (request.command === "swap.uniswap-bnb.inventory") return data({ ownerAdmission: SWAP_INVENTORY_OWNER_ADMISSION,
    execution: runtime === undefined ? "dormant" : "foreground_cli_after_owner_admission",
    keyless: { chain: BNB_CHAIN, route: swapRouteOf(BNB_UNISWAP_MECHANISM_PIN), routeDigest: swapRouteDigest(BNB_UNISWAP_MECHANISM_PIN),
      mechanismPin: BNB_UNISWAP_MECHANISM_PIN, mechanismDigest: swapMechanismDigest(BNB_UNISWAP_MECHANISM_PIN),
      protocolRegistryDigest: BNB_UNISWAP_PROTOCOL_REGISTRY.registryDigest, router: { label: BNB_UNISWAP_NATIVE_LANE.routerLabel,
        address: BNB_UNISWAP_NATIVE_LANE.router }, pairs: BNB_UNISWAP_PAIRS, codePins: [...BNB_UNISWAP_CODE_PINS, BNB_USDC_IMPLEMENTATION_PIN],
      maxHeadDriftBlocks: BNB_UNISWAP_NATIVE_LANE.maxHeadDrift, rpc: BNB_UNISWAP_NATIVE_LANE.rpcEnvironment } }, "official_catalog_not_owner_admission");
  if (request.command === "swap.uniswap-bnb.quote") {
    if (runtime === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE",
      "BNB Uniswap quote requires the keyless BNB Smart Chain runtime.", { reason: "uniswap_bnb_runtime_unavailable" });
    return data(await runtime.quote(request, context.clock.now()), "unsigned_exact_simulated_swap_quote");
  }
  if (request.command === "swap.uniswap-bnb.prepare") {
    if (runtime === undefined) throw new ApnError("APN_OPERATION_BLOCKED",
      "No active owner swap admission is installed; staged allowlist data does not authorize preparation.", { reason: "uniswap_owner_admission_required" });
    return operationOutcome(await runtime.prepare(request, context.clock.now()));
  }
  if (request.command === "swap.uniswap-bnb.status") {
    if (runtime !== undefined) {
      const operation = await runtime.status(request.operationId, context.clock.now());
      return { ...operationOutcome(operation), receipt: await swapStatusReceipt(operation, async () => await runtime.actualEconomics(operation)) };
    }
    const operation = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
    if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
    if (operation.quote.sourceAsset.chain !== BNB_CHAIN) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Swap operation belongs to another runtime.", { reason: "swap_runtime_chain" });
    }
    return { proofClass: operation.state, data: null, operation, nextActions: [],
      receipt: await swapStatusReceipt(operation, async () => await swapActualEconomics(context.state.root, operation, undefined, context.clock.now())) };
  }
  if (runtime === undefined) throw new ApnError("APN_OPERATION_BLOCKED",
    "BNB Uniswap signing and sending need the keyless BNB Smart Chain runtime.", { reason: "uniswap_bnb_runtime_unavailable" });
  // Foreground CLI: the typed approval code and the single send are one command, like the Ethereum lane.
  if (request.command === "swap.uniswap-bnb.approve") return operationOutcome(await runtime.approveAndExecute(request.operationId, context.clock.now()));
  return operationOutcome(await runtime.execute(request.operationId, context.clock.now()));
}

function data(value: unknown, proofClass: string): CommandOutcome {
  return { proofClass, data: value, operation: null, receipt: null, nextActions: [] };
}
function operationOutcome(value: SwapOperationRecord): CommandOutcome {
  return { proofClass: value.state, data: null, operation: value, receipt: null, nextActions: [] };
}
