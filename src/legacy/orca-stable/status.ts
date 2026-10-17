import { ApnError } from "../../errors.js";
import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { SwapOperationRepository } from "../../swap/repository.js";
import { GuardedSwapService } from "../../swap/service.js";
import { SavedOrcaStableMaterialStore } from "./material.js";
import { isOrcaStableGuardedMechanismDigest } from "./mechanism.js";
import { releaseOrcaStableNoEffect } from "./release.js";

/**
 * Local status of a stable operation a released version prepared: authenticated material, no RPC, signer or sender.
 * An unsigned preparation whose quote window closed is released here; nothing can execute it any more (SWAP-10).
 */
export async function orcaStablePreparedStatus(operations: SwapOperationRepository, materialStore: SavedOrcaStableMaterialStore,
  operationId: string, now: Date) {
  const operation = await operations.loadAny(operationId);
  if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
  if (!isOrcaStableGuardedMechanismDigest(operation.mechanismDigest))
    throw new ApnError("APN_OPERATION_BLOCKED", "Operation does not use the stable guarded mechanism.", { reason: "orca_stable_mechanism_mismatch" });
  if (["failed_before_effect", "expired_unlanded"].includes(operation.state) || operation.submissionMarker !== null) {
    const staged = await materialStore.loadStaged(operationId);
    if (staged === null || staged.quote.quoteHash !== operation.quote.quoteHash)
      throw new ApnError("APN_STATE_CORRUPT", "Stable Orca terminal material is missing.");
    return status(operation, staged.materialDigest, staged.preview.messageHash, staged.preview.marketSlot);
  }
  const material = await materialStore.load(operationId, operation);
  if (material === null) throw new ApnError("APN_STATE_CORRUPT", "Stable Orca prepared material is missing.");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.toISOString() < operation.quote.effectiveAt)
    throw new ApnError("APN_REPREPARE_REQUIRED", "Stable Orca preparation is not effective.");
  if (now.toISOString() >= operation.quote.expiresAt) {
    const released = await releaseOrcaStableNoEffect(new GuardedSwapService(operations, new AssetUsageLedger(operations.root)),
      materialStore, operationId, now);
    return status(released.operation, material.materialDigest, material.preview.messageHash, material.preview.marketSlot);
  }
  return status(operation, material.materialDigest, material.preview.messageHash, material.preview.marketSlot);
}

function status(operation: Awaited<ReturnType<SwapOperationRepository["loadAny"]>> & {}, materialDigest: string,
  messageHash: string, marketSlot: string) {
  return { schemaVersion: "apn.orca-stable-guarded-status.v1" as const, operation,
    quoteHash: operation.quote.quoteHash, materialDigest, messageHash, marketSlot,
    expiresAt: operation.quote.expiresAt, phase: operation.state,
    signable: false as const, executable: false as const, executionRequiresForegroundConsent: false as const,
    signed: operation.submissionMarker === null ? false : operation.state === "finalized" || operation.state === "failed_confirmed_revert" ? true : null,
    broadcast: operation.submissionMarker === null ? false : operation.state === "finalized" || operation.state === "failed_confirmed_revert" ? true : null,
    possibleSend: operation.submissionMarker !== null,
    observeOnly: operation.submissionMarker !== null };
}
