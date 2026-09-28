import { ApnError } from "../../errors.js";
import { SwapOperationRepository } from "../repository.js";
import { admitOrcaStableOwner } from "./stable-admission.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { stableReservationAdmissionPorts } from "./stable-reservation-admission.js";
import { GuardedSwapService } from "../service.js";
import { releaseOrcaStableNoEffect } from "./stable-release.js";
/** Local only: authenticated material and current owner admission, with no RPC, signer or sender. */
export async function orcaStablePreparedStatus(operations, materialStore, ports, operationId, now) {
    const operation = await operations.loadAny(operationId);
    if (operation === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
    if (operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST)
        throw new ApnError("APN_OPERATION_BLOCKED", "Operation does not use the stable guarded mechanism.", { reason: "orca_stable_mechanism_mismatch" });
    if (operation.state === "failed_before_effect" || operation.submissionMarker !== null) {
        const staged = await materialStore.loadStaged(operationId);
        if (staged === null || staged.quote.quoteHash !== operation.quote.quoteHash)
            throw new ApnError("APN_STATE_CORRUPT", "Stable Orca terminal material is missing.");
        return status(operation, staged.materialDigest, staged.preview.messageHash, staged.preview.marketSlot);
    }
    const material = await materialStore.load(operationId, operation);
    if (material === null)
        throw new ApnError("APN_STATE_CORRUPT", "Stable Orca prepared material is missing.");
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.toISOString() < operation.quote.effectiveAt)
        throw new ApnError("APN_REPREPARE_REQUIRED", "Stable Orca preparation is not effective.");
    if (now.toISOString() >= operation.quote.expiresAt) {
        const released = await releaseOrcaStableNoEffect(new GuardedSwapService(operations, new AssetUsageLedger(operations.root)), materialStore, operationId, now);
        return status(released.operation, material.materialDigest, material.preview.messageHash, material.preview.marketSlot);
    }
    const admission = await admitOrcaStableOwner(stableReservationAdmissionPorts(ports, new AssetUsageLedger(operations.root), operation), { profile: operation.quote.profile, owner: operation.quote.account,
        policyRevision: material.policyRevision, amountInAtomic: operation.quote.inputAmountAtomic,
        minimumOutputAtomic: operation.quote.minimumOutputAtomic, now }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
    if (admission.policyDigest !== material.policyDigest || admission.activationDigest !== material.activationDigest)
        throw new ApnError("APN_OPERATION_BLOCKED", "Stable Orca owner activation changed.", { reason: "orca_stable_policy_drift" });
    return status(operation, material.materialDigest, material.preview.messageHash, material.preview.marketSlot);
}
function status(operation, materialDigest, messageHash, marketSlot) {
    return { schemaVersion: "apn.orca-stable-guarded-status.v1", operation,
        quoteHash: operation.quote.quoteHash, materialDigest, messageHash, marketSlot,
        expiresAt: operation.quote.expiresAt, phase: operation.state,
        signable: false, executable: false,
        signed: operation.submissionMarker === null ? false : operation.state === "finalized" || operation.state === "failed_confirmed_revert" ? true : null,
        broadcast: operation.submissionMarker === null ? false : operation.state === "finalized" || operation.state === "failed_confirmed_revert" ? true : null,
        possibleSend: operation.submissionMarker !== null,
        observeOnly: operation.submissionMarker !== null };
}
//# sourceMappingURL=stable-status.js.map