import { ApnError } from "../../errors.js";
import { SwapOperationRepository } from "../repository.js";
import { admitOrcaStableOwner } from "./stable-admission.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
/** Local only: authenticated material and current owner admission, with no RPC, signer or sender. */
export async function orcaStablePreparedStatus(operations, materialStore, ports, operationId, now) {
    const operation = await operations.loadAny(operationId);
    if (operation === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
    if (operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST)
        throw new ApnError("APN_OPERATION_BLOCKED", "Operation does not use the stable guarded mechanism.", { reason: "orca_stable_mechanism_mismatch" });
    const material = await materialStore.load(operationId, operation);
    if (material === null)
        throw new ApnError("APN_STATE_CORRUPT", "Stable Orca prepared material is missing.");
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.toISOString() < operation.quote.effectiveAt ||
        now.toISOString() >= operation.quote.expiresAt)
        throw new ApnError("APN_REPREPARE_REQUIRED", "Stable Orca preparation expired.");
    const admission = await admitOrcaStableOwner(ports, { profile: operation.quote.profile, owner: operation.quote.account,
        policyRevision: material.policyRevision, amountInAtomic: operation.quote.inputAmountAtomic,
        minimumOutputAtomic: operation.quote.minimumOutputAtomic, now }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
    if (admission.policyDigest !== material.policyDigest || admission.activationDigest !== material.activationDigest)
        throw new ApnError("APN_OPERATION_BLOCKED", "Stable Orca owner activation changed.", { reason: "orca_stable_policy_drift" });
    return { schemaVersion: "apn.orca-stable-guarded-status.v1", operation,
        quoteHash: operation.quote.quoteHash, materialDigest: material.materialDigest,
        messageHash: material.preview.messageHash, marketSlot: material.preview.marketSlot,
        expiresAt: operation.quote.expiresAt, signable: false, executable: false,
        signed: false, broadcast: false };
}
//# sourceMappingURL=stable-status.js.map