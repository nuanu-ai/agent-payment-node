import type { CommandOutcome, CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import type { RuntimeContext } from "../../runtime.js";
import { isOrcaStableGuardedMechanismDigest } from "../../legacy/orca-stable/mechanism.js";
import { swapMechanismDigest } from "../pin.js";
import { SWAP_INVENTORY_OWNER_ADMISSION, swapRouteDigest, swapRouteOf } from "../route-admission.js";
import { SwapOperationRepository } from "../repository.js";
import { isOrcaTokenPlan } from "./instructions.js";
import { SavedOrcaQuoteStore } from "./material.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, ORCA_PROGRAM_AUTHORITIES, ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, WHIRLPOOL_PROGRAM,
  WHIRLPOOLS_CONFIG } from "./pins.js";
import { ORCA_POOL_IDS, ORCA_POOLS, orcaPoolOfMechanism, type OrcaPoolConfig } from "./pools.js";
import { swapActualEconomics } from "../receipt-facts.js";

type Request = Extract<CommandRequest, { readonly command: `swap.orca.${string}` }>;

/** Inventory is the owner's source for each pool's keyless pin, route and digest; nothing here admits or signs anything. */
export function orcaInventory(runtimeInstalled: boolean): unknown {
  return { chain: ORCA_SOLANA_CHAIN, ownerAdmission: SWAP_INVENTORY_OWNER_ADMISSION, execution: runtimeInstalled ? "foreground_cli_after_owner_admission" : "dormant",
    program: WHIRLPOOL_PROGRAM, config: WHIRLPOOLS_CONFIG,
    allowedPrograms: [COMPUTE_BUDGET_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM, WHIRLPOOL_PROGRAM], programAuthorities: ORCA_PROGRAM_AUTHORITIES,
    pools: ORCA_POOL_IDS.map((id) => ORCA_POOLS[id]).map((pool) => ({ pool: pool.id, address: pool.pool, tokenA: pool.mintA, tokenB: pool.mintB,
      symbolA: pool.symbolA, symbolB: pool.symbolB, vaultA: pool.vaultA, vaultB: pool.vaultB, tickSpacing: pool.tickSpacing,
      feeRate: "read_from_pool_at_quote", direction: `${pool.symbolA}_to_${pool.symbolB}_exact_input`,
      input: pool.nativeWrap === "a" ? "native_sol_wrapped_in_transaction" : "owner_token_account",
      route: swapRouteOf(pool.mechanismPin), routeDigest: swapRouteDigest(pool.mechanismPin), mechanismPin: pool.mechanismPin,
      mechanismDigest: swapMechanismDigest(pool.mechanismPin), protocolRegistryDigest: pool.protocolRegistry.registryDigest })) };
}

export async function executeOrcaCommand(request: Request, context: RuntimeContext): Promise<CommandOutcome> {
  const runtime = context.orcaRuntime;
  if (request.command === "swap.orca.inventory") return data(orcaInventory(runtime !== undefined), "official_catalog_not_owner_admission");
  if (request.command === "swap.orca.stable-status" || request.command === "swap.orca.stable-release" ||
      request.command === "swap.orca.stable-recover-no-send" || request.command === "swap.orca.stable-observe") {
    const legacy = context.orcaStableLegacy;
    if (legacy === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The stable Orca finishers are unavailable.");
    if (request.command === "swap.orca.stable-status") return data(await legacy.status(request.operationId), "stable_operation_status");
    if (request.command === "swap.orca.stable-release") return data(await legacy.release(request.operationId), "stable_unsigned_principal_released");
    if (request.command === "swap.orca.stable-recover-no-send") return data(await legacy.recoverNoSend(request.operationId), "stable_no_send_proved_principal_released");
    return data(await legacy.observe(request.operationId), "stable_observation");
  }
  if (request.command === "swap.orca.quote") {
    const { command: _command, pool, ...quote } = request;
    return data(await installed(runtime)(ORCA_POOLS[pool]).quote(quote, context.clock.now()), "unsigned_exact_simulated_swap_quote");
  }
  if (request.command === "swap.orca.prepare") {
    // The saved quote names its pool; prepare runs in that pool's runtime and is admitted against that pool's route.
    const select = installed(runtime), material = await new SavedOrcaQuoteStore(context.state.root).load(request.quoteHash);
    if (material === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
    const plan = material.execution.plan, pool = ORCA_POOLS[isOrcaTokenPlan(plan) ? plan.pool : "sol-usdc"];
    return operationOutcome(await select(pool).prepare(request, context.clock.now()));
  }
  const operation = await new SwapOperationRepository(context.state.root).loadAny(request.operationId);
  if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
  // Any registered generation stays readable; the pool's runtime admits only its current registry for approval or signing.
  const pool: OrcaPoolConfig | null = orcaPoolOfMechanism(operation.mechanismDigest);
  if (pool === null) {
    // A stable USDC to USDT operation from APN 0.5.45 or earlier finishes only through its frozen exits.
    const stable = isOrcaStableGuardedMechanismDigest(operation.mechanismDigest);
    throw new ApnError("APN_OPERATION_BLOCKED", "This operation is outside the keyless Orca pools.", { reason: "orca_mechanism_mismatch",
      ...(stable ? { nextActions: [`apn swap solana orca stable-status --operation ${operation.operationId}`,
        `apn swap solana orca ${operation.submissionMarker === null ? "stable-release" : "stable-observe"} --operation ${operation.operationId}`] } : {}) });
  }
  if (request.command === "swap.orca.status" && runtime === undefined) return { proofClass: operation.state, data: null, receipt: null, nextActions: [],
    operation: { ...operation, ...await swapActualEconomics(context.state.root, operation, undefined, context.clock.now()) } };
  const pooled = installed(runtime)(pool);
  if (request.command === "swap.orca.status") {
    const current = await pooled.status(request.operationId, context.clock.now());
    return operationOutcome({ ...current, ...await pooled.actualEconomics(current) });
  }
  // Foreground CLI: the typed approval code and the single send are one command, like the Uniswap path.
  if (request.command === "swap.orca.approve") return operationOutcome(await pooled.approveAndExecute(request.operationId, context.clock.now()));
  return operationOutcome(await pooled.execute(request.operationId, context.clock.now()));
}

function installed(runtime: RuntimeContext["orcaRuntime"]): NonNullable<RuntimeContext["orcaRuntime"]> {
  if (runtime === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "The keyless Orca runtime is not installed for this command.",
    { reason: "orca_runtime_unavailable" });
  return runtime;
}

function data(value: unknown, proofClass: string): CommandOutcome { return { proofClass, data: value, operation: null, receipt: null, nextActions: [] }; }
function operationOutcome(value: Awaited<ReturnType<ReturnType<NonNullable<RuntimeContext["orcaRuntime"]>>["status"]>>): CommandOutcome {
  return { proofClass: value.state, data: null, operation: value, receipt: null, nextActions: [] };
}
