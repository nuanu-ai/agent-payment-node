import type { CommandOutcome } from "../../commands.js";
import type { RuntimeContext } from "../../runtime.js";
import { SWAP_TERMINAL_STATES, type SwapOperationRecord } from "../../swap/model.js";
import { SwapOperationRepository } from "../../swap/repository.js";
import { field, readableClaims, requiredRecordPath, salvageRecord, type OperationFamilyAdapter, type OperationStore } from "../adapter.js";
import type { OperationClaim } from "../types.js";
import { chainDomain, domainClaim, namedProfileClaim, pastUnstartedDeadline, salvageChain } from "./family-claims.js";
import { OPERATION_ABANDON, OPERATION_STATUS } from "./family-commands.js";

const STORE: OperationStore = { directory: "swap-operations", perProfile: true };

/** The account a swap signs with on its source chain (EVM, Solana or TRON). */
export function swapClaims(record: Pick<SwapOperationRecord, "quote">): readonly OperationClaim[] {
  return [domainClaim(chainDomain(record.quote.sourceAsset.chain, record.quote.account))];
}

/**
 * Guarded swaps of every lane (Uniswap, SunSwap, Jupiter, Orca, legacy Orca stable). The store is keyed by the swap
 * quote's own profile hash; the record also holds the profile under the state store's hash, so profile-wide admissions
 * see it. A swap that never wrote its submission marker cannot sign once its quote expired (`markSubmitting`).
 */
export const swapAdapter: OperationFamilyAdapter<SwapOperationRecord> = {
  family: "swap",
  stores: [STORE],
  async load(root, recordPath) {
    const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
    return await new SwapOperationRepository(root).read(profileHash!, operationId);
  },
  identity: record => ({ profileHash: record.ownerProfileHash, operationId: record.operationId, idempotencyHash: null, requestHash: null }),
  claims: record => readableClaims(() => [...swapClaims(record), namedProfileClaim(record.quote.profile)]),
  terminal: record => SWAP_TERMINAL_STATES.includes(record.state) ||
    record.submissionMarker === null && pastUnstartedDeadline(record.quote.expiresAt),
  state: record => record.state,
  salvage: raw => salvageRecord(raw, value => [salvageChain(field(value, "quote", "sourceAsset", "chain"), field(value, "quote", "account"))],
    ["ownerProfileHash"]),
  view: async record => record,
  // The lane's own status reads the swap and observes a marked one (inclusion, revert or expired_unlanded).
  status: async (context, record) => await laneStatus(context, record),
  // A marked swap whose outcome no chain proof can settle has the owner exit (R4); the family refuses every other case.
  abandon: async (context, record) => await (await import("../../swap/abandon.js")).abandonSwapOperation(context, record.operationId),
  commands: { status: OPERATION_STATUS, resume: OPERATION_STATUS, exit: OPERATION_ABANDON },
};

/** The lane that owns a swap, chosen by its mechanism as `abandonSwapOperation` chooses it. */
async function laneStatus(context: RuntimeContext, record: SwapOperationRecord): Promise<CommandOutcome> {
  const operationId = record.operationId, digest = record.mechanismDigest, chain = record.quote.sourceAsset.chain;
  if ((await import("../../legacy/orca-stable/mechanism.js")).isOrcaStableGuardedMechanismDigest(digest)) {
    return await (await import("../../swap/orca-solana/command-service.js")).executeOrcaCommand({ command: "swap.orca.stable-status", operationId }, context);
  }
  if ((await import("../../swap/orca-solana/pools.js")).isOrcaKeylessMechanismDigest(digest)) {
    return await (await import("../../swap/orca-solana/command-service.js")).executeOrcaCommand({ command: "swap.orca.status", operationId }, context);
  }
  const { swapMechanismDigest } = await import("../../swap/pin.js"), { JUPITER_V1_KNOWN_ROUTES } = await import("../../swap/jupiter-solana/v1-route-config.js");
  if (JUPITER_V1_KNOWN_ROUTES.some(route => swapMechanismDigest(route.mechanismPin) === digest)) {
    return await (await import("../../swap/jupiter-solana/command-service.js")).executeJupiterCommand({ command: "swap.jupiter.status", operationId }, context);
  }
  if (chain.startsWith("tron:")) {
    return await (await import("../../swap/sunswap-tron/command-service.js")).executeSunSwapCommand({ command: "swap.sunswap.status", operationId }, context);
  }
  return await (await import("../../swap/uniswap-command-service.js")).executeUniswapCommand({ command: "swap.uniswap.status", operationId }, context);
}
