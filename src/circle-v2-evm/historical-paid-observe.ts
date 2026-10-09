import { HistoricalPaidRpc } from "./historical-paid-rpc.js";
import type { StateStore } from "../state.js";
import type { BridgeHttps } from "../lifi/https.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { circleRoute } from "./catalog.js";
import { advanceCircle, circleBlocked, type CircleOperationV1 } from "./operation-model.js";
import { CircleRepository } from "./repository.js";
import type { CircleUsage } from "./usage.js";
import { CircleExternalRpcBudget } from "./external-rpc.js";
import { CircleExternalStore } from "./external-store.js";
import { HistoricalPaidClosureStore, verifyHistoricalPaidClosure } from "./historical-paid-closure.js";
import { HISTORICAL_LINEA_OPERATION, HISTORICAL_MONAD_OPERATION } from "./historical-paid-source.js";
import { HISTORICAL_MONAD_MINT } from "./historical-paid-destination.js";
/** Existing observe/adopt entry points only. This path cannot consent, load a key or dispatch. */
export async function observeHistoricalPaidCircle(state: StateStore, repo: CircleRepository, usage: CircleUsage, env: Readonly<Record<string, string | undefined>>, now: () => number, https: Pick<BridgeHttps, "request">, id: string, transactionHash?: string): Promise<CircleOperationV1> {
  const initial = await repo.load(id); if (initial === null || ![HISTORICAL_LINEA_OPERATION, HISTORICAL_MONAD_OPERATION].includes(id) || id === HISTORICAL_MONAD_OPERATION && transactionHash !== undefined && transactionHash !== HISTORICAL_MONAD_MINT) circleBlocked("historical_paid_exact_observation");
  await state.initialize(); return state.withLocks([`profile:${initial.profileHash}`, `profile:${initial.destinationProfileHash}`, `custody:${initial.profileHash}`, `custody:${initial.destinationProfileHash}`, `operation:${id}`, `operation:idempotency:${initial.idempotencyHash}`, evmAddressLock(initial.sourceCustody.walletAddress), evmAddressLock(initial.destinationCustody.walletAddress)], async () => {
    let op = (await repo.load(id))!; const route = circleRoute(op.destinationChain, op.destinationProfile), budget = new CircleExternalRpcBudget(now, now() + 120000, https), source = new HistoricalPaidRpc(env.APN_ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com", 42161, budget, op.operationId), destination = new HistoricalPaidRpc(env[route.rpcEnvironment] ?? route.rpcDefault, op.destinationChain, budget, op.operationId);
    const authority = await verifyHistoricalPaidClosure(state, op, source, destination), closure = (await new HistoricalPaidClosureStore(state.root).load(op))!;
    if (closure.externalFulfillment !== null) { const store = new CircleExternalStore(state.root), proof = closure.externalFulfillment, prior = await store.readClaim(op); await store.claim({ ...op, source: closure.source.sourceProof }, proof, prior === null ? { source: closure.source, destination: closure.destination } : await store.evidence(prior)); }
    budget.assert(); const usageRows = await usage.closeHistoricalPaid(op, authority); budget.assert();
    if (op.terminal) return op;
    const external = closure.externalFulfillment !== null, sourceProof = op.source!.finalityTag === "finalized" ? op.source : closure.source.sourceProof;
    const effects = op.effects.map(e => e.role === "burn" && e.proof?.finalityTag !== "finalized" ? { ...e, proof: sourceProof } : e);
    op = advanceCircle(op, { source: sourceProof, effects, usage: usageRows, usageFinalized: true, residualAllowanceAtomic: "0", ...(external ? { externalFulfillment: closure.externalFulfillment!, state: "external_fulfilled" as const } : { destination: op.destination ?? closure.destination.receipt as CircleOperationV1["destination"], state: "completed" as const }), terminal: true }, "historical_own_source_and_destination_usage_closed", now());
    await repo.save(op); return op;
  });
}
