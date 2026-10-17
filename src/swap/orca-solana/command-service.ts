import type { CommandOutcome, CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import { isPlainRecord } from "../../canonical.js";
import type { RuntimeContext } from "../../runtime.js";
import { swapMechanismDigest } from "../pin.js";
import { SWAP_INVENTORY_OWNER_ADMISSION, swapRouteDigest, swapRouteOf } from "../route-admission.js";
import { ORCA_STABLE_GUARDED_MECHANISM_PIN } from "./stable-mechanism.js";
import { SwapOperationRepository } from "../repository.js";
import { orcaStableInventory } from "./stable-readonly.js";
import { isOrcaTokenPlan } from "./instructions.js";
import { SavedOrcaQuoteStore } from "./material.js";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, ORCA_PROGRAM_AUTHORITIES, ORCA_SOLANA_CHAIN, SYSTEM_PROGRAM, TOKEN_PROGRAM, WHIRLPOOL_PROGRAM,
  WHIRLPOOLS_CONFIG } from "./pins.js";
import { ORCA_POOL_IDS, ORCA_POOLS, orcaPoolOfMechanism, type OrcaPoolConfig } from "./pools.js";

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
  if (request.command === "swap.orca.stable-inventory") return data({ ...orcaStableInventory(), route: swapRouteOf(ORCA_STABLE_GUARDED_MECHANISM_PIN),
    routeDigest: swapRouteDigest(ORCA_STABLE_GUARDED_MECHANISM_PIN) }, "pinned_read_only_inventory");
  if (request.command === "swap.orca.stable-quote") {
    if (context.orcaStableQuote === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca quote reader is unavailable.");
    return data(await context.orcaStableQuote(request), "read_only_market_quote");
  }
  if (request.command === "swap.orca.stable-prepare") {
    if (context.orcaStablePrepare === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca preparation is unavailable.");
    return data(await context.orcaStablePrepare(request), "unsigned_simulated_stable_preparation");
  }
  if (request.command === "swap.orca.stable-status") {
    if (context.orcaStableStatus === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca status is unavailable.");
    return data(await context.orcaStableStatus(request.operationId), "stable_operation_status");
  }
  if (request.command === "swap.orca.stable-approve" || request.command === "swap.orca.stable-execute") {
    // One foreground consent: approve reserves and executes; execute (its own consent) serves a reservation left unexecuted.
    const run = request.command === "swap.orca.stable-approve" ? context.orcaStableApprove : context.orcaStableExecute;
    if (run === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca execution is unavailable.");
    const result = await run(request.operationId);
    if (isPlainRecord(result) && result.signature === null) {
      throw new ApnError("APN_OPERATION_BLOCKED", "Stable execution stopped after its durable marker without a proved send. Principal remains held.",
        { reason: "orca_stable_marked_no_send_unproven", nextActions: [
          `apn swap solana orca stable-recover-no-send --operation ${request.operationId}`] });
    }
    return data(result, "stable_first_send_attempt");
  }
  if (request.command === "swap.orca.stable-recover-no-send") {
    if (context.orcaStableRecoverNoSend === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca no-send recovery is unavailable.");
    return data(await context.orcaStableRecoverNoSend(request.operationId), "stable_no_send_proved_principal_released");
  }
  if (request.command === "swap.orca.stable-observe") {
    if (context.orcaStableObserve === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca observation is unavailable.");
    return data(await context.orcaStableObserve(request.operationId), "stable_observation");
  }
  if (request.command === "swap.orca.stable-release") {
    if (context.orcaStableRelease === undefined) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Stable Orca release is unavailable.");
    return data(await context.orcaStableRelease(request.operationId), "stable_unsigned_principal_released");
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
  if (pool === null) throw new ApnError("APN_OPERATION_BLOCKED", "This operation is outside the keyless Orca pools.", { reason: "orca_mechanism_mismatch" });
  if (request.command === "swap.orca.status" && runtime === undefined) return { proofClass: operation.state, data: null, operation, receipt: null, nextActions: [] };
  const pooled = installed(runtime)(pool);
  if (request.command === "swap.orca.status") return operationOutcome(await pooled.status(request.operationId, context.clock.now()));
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
