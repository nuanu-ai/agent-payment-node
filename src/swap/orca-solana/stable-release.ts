import { assetUsageReservationId } from "../../asset-usage-ledger.js";
import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { GuardedSwapService } from "../service.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { ORCA_SOLANA_CHAIN, USDC_MINT } from "./pins.js";

/** Retires an unsigned stable preparation and its exact principal lease, including an orphan after a reserve crash. */
export async function releaseOrcaStableNoEffect(service: GuardedSwapService, materialStore: SavedOrcaStableMaterialStore,
  operationId: string, now: Date) {
  return await service.operations.withLocks([`orca-stable-approval:${operationId}`], async () => {
    const operation = await service.operations.loadAny(operationId);
    if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
    if (operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST)
      blocked("Operation does not use the stable guarded mechanism.", "orca_stable_mechanism_mismatch");
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.toISOString() < operation.updatedAt)
      throw new ApnError("APN_INVALID_INPUT", "Stable release time is invalid.");
    if (operation.state === "failed_before_effect") return result(operation);
    if (!["quoted", "prepared", "awaiting_approval", "reserved"].includes(operation.state) ||
        operation.submissionMarker !== null || operation.receiptProof !== null)
      blocked("Stable operation has crossed the possible effect boundary.", "orca_stable_effect_boundary");
    const material = await materialStore.load(operationId, operation);
    if (material === null) throw new ApnError("APN_STATE_CORRUPT", "Stable Orca prepared material is missing.");
    if (material.preview.signable !== false || material.preview.executable !== false)
      blocked("Stable material is not proven unsigned and inert.", "orca_stable_effect_boundary");
    const identity = { account: operation.quote.account, chain: ORCA_SOLANA_CHAIN,
      asset: { kind: "token" as const, identifier: USDC_MINT } };
    const reservationId = assetUsageReservationId(identity, `swap-${operation.idempotencyHash}`);
    const proof = domainHash("apn.orca-stable-no-effect-release.v1", canonicalJson({
      operationId, quoteHash: operation.quote.quoteHash, materialDigest: material.materialDigest,
      mechanismDigest: operation.mechanismDigest }));
    const lease = await service.usage.load(identity, reservationId);
    if (lease !== null && (lease.amountAtomic !== operation.quote.inputAmountAtomic ||
        lease.policyDigest !== operation.policyDigest || lease.rail !== "swap" ||
        !["reserved", "failed_before_effect"].includes(lease.state)))
      throw new ApnError("APN_STATE_CORRUPT", "Stable principal lease differs from the unsigned operation.");
    if (operation.state === "reserved" && (lease === null || operation.usageLease?.reservationId !== reservationId))
      throw new ApnError("APN_STATE_CORRUPT", "Reserved stable operation has no matching principal lease.");
    const released = lease === null ? undefined : await service.usage.transition({ ...identity, reservationId,
      policyDigest: operation.policyDigest, state: "failed_before_effect", now, outcomeDigest: proof });
    const terminal = await service.operations.transition(operation.ownerProfileHash, operation.operationId,
      operation.integrityHash, "failed_before_effect", { failureProofHash: proof,
        ...(released === undefined ? {} : { usageLease: released }) }, now);
    return result(terminal);
  });
}

function result(operation: Awaited<ReturnType<GuardedSwapService["reserve"]>>) {
  return { schemaVersion: "apn.orca-stable-no-effect-release.v1" as const, operation,
    signable: false as const, executable: false as const, signed: false as const, broadcast: false as const };
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
