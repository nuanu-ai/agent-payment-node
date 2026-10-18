import { formatUnits } from "viem";
import { ApnError } from "../errors.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import type { OperationAbandonApprovalPort } from "../operation-abandon-approval.js";
import type { StateStore } from "../state.js";
import { CIRCLE_SOURCE_TOKEN } from "./catalog.js";
import { advanceCircleFundingOperation, publicCircleFundingOperation, type CircleFundingOperationV2 } from "./funding-operation.js";
import { CircleRepository } from "./repository.js";

/** The journal reason of a Circle funding route the owner closed with a possibly-sent effect no proof decided. */
export const CIRCLE_FUNDING_OWNER_ABANDON = "owner_abandoned_unknown";
/** Effect phases past the submission fence with no receipt proof: the bytes may have reached the network. */
const POSSIBLY_SENT = ["submission_started", "submitted", "unknown"];

/**
 * R4 exit 3 of a Circle CCTP V2 funding route that a possibly-sent approval, burn, mint or cleanup keeps open and no proof
 * decides (an envelope frozen before eras were recorded never proves never-lands; a pruned node proves nothing). Past the
 * route's expiry, the owner's TTY consent ends it `abandoned_unknown`: nothing is signed or sent, every usage hold stays
 * charged, and the operation index releases both accounts and profiles. The effect may still land; the consent says so.
 */
export async function abandonCircleFunding(state: StateStore, operationId: string, consent: OperationAbandonApprovalPort, now: () => number): Promise<unknown> {
  const repo = new CircleRepository(state.root), initial = await required(repo, operationId);
  await state.initialize();
  return await state.withLocks([`profile:${initial.profileHash}`, `profile:${initial.destinationProfileHash}`, `operation:${initial.operationId}`,
    `operation:idempotency:${initial.idempotencyHash}`, evmAddressLock(initial.sourceCustody.walletAddress), evmAddressLock(initial.destinationCustody.walletAddress)], async () => {
    let op = await required(repo, operationId);
    if (op.state === "abandoned_unknown") return publicCircleFundingOperation(op);
    const refuse = (reason: string, message: string): never => { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason, operationId, state: op.state,
      nextActions: [`apn circle evm observe --operation ${operationId}`] }); };
    const pending = op.effects.filter(e => POSSIBLY_SENT.includes(e.phase) && e.transactionHash !== null);
    if (pending.length === 0) refuse("circle_funding_abandon_not_unknown", "Only a Circle route with a possibly-sent effect no proof decided can be abandoned.");
    if (now() < Date.parse(op.expiresAt)) refuse("circle_funding_abandon_before_expiry", "A Circle route can be abandoned only after its expiry.");
    const f = op.funding;
    await consent.approve({ operationId, fingerprint: op.fingerprint, profile: op.profile, providerId: "circle-cctp-v2-fast", walletAddress: f.sourceOwner,
      recipient: f.recipient, amountAtomic: f.amountAtomic, amountDecimal: formatUnits(BigInt(f.amountAtomic), 6),
      chainLabel: `eip155:42161 -> eip155:${op.destinationChain}`, assetLabel: `USDC (${CIRCLE_SOURCE_TOKEN})`, unit: "USDC",
      outcomeNote: `Financial outcome: UNKNOWN. ${pending.map(e => `${e.role} ${e.transactionHash}`).join(", ")} may still land; ` +
        "APN never sends it again, and every usage hold of the route stays charged." });
    op = advanceCircleFundingOperation(op, { state: "abandoned_unknown", terminal: true }, CIRCLE_FUNDING_OWNER_ABANDON, now());
    await repo.saveFunding(op);
    return publicCircleFundingOperation(op);
  });
}

async function required(repo: CircleRepository, operationId: string): Promise<CircleFundingOperationV2> {
  const op = await repo.loadAny(operationId);
  if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Circle EVM operation was not found.");
  if (op.terminal && op.state !== "abandoned_unknown") {
    throw new ApnError("APN_OPERATION_BLOCKED", "The Circle route is already terminal; there is nothing to abandon.", { reason: "operation_already_terminal", operationId,
      state: op.state, nextActions: [`apn operation status --operation ${operationId}`, `apn receipt get --operation ${operationId}`] });
  }
  if (op.schemaVersion !== "apn.circle-v2-evm-operation.v2") {
    throw new ApnError("APN_OPERATION_BLOCKED", "A v1 Circle route is read-only; only a v2 funding route has an owner abandon.", { reason: "funding_operation_schema_required" });
  }
  return op;
}
