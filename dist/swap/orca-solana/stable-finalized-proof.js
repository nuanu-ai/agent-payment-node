import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { validateSwapReceiptProof } from "../model.js";
const VERSION = "apn.orca-stable-finalized-observation.v1";
export function sealOrcaStableFinalizedObservation(operation, bindings, outcome, proof) {
    if (operation.submissionMarker === null || operation.usageLease === null)
        corrupt();
    const body = { schemaVersion: VERSION, operationId: operation.operationId,
        ownerProfileHash: operation.ownerProfileHash, markerHash: operation.submissionMarker.markerHash,
        ...bindings, reservationId: operation.usageLease.reservationId,
        reservedLeaseDigest: operation.usageLease.reservationDigest, outcome, proof };
    return validateOrcaStableFinalizedObservation({ ...body, observationHash: domainHash(VERSION, canonicalJson(body)) }, operation);
}
export function validateOrcaStableFinalizedObservation(value, operation) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "ownerProfileHash",
        "markerHash", "materialDigest", "bindingHash", "claimHash", "accountIdentityHash",
        "reservationId", "reservedLeaseDigest", "outcome", "proof", "observationHash"]))
        corrupt();
    const result = value;
    const { observationHash, ...body } = result;
    if (result.schemaVersion !== VERSION || result.operationId !== operation.operationId ||
        result.ownerProfileHash !== operation.ownerProfileHash ||
        result.markerHash !== operation.submissionMarker?.markerHash ||
        result.reservationId !== operation.usageLease?.reservationId ||
        ![result.materialDigest, result.bindingHash, result.claimHash, result.accountIdentityHash,
            result.reservedLeaseDigest, observationHash].every(item => typeof item === "string" && /^[a-f0-9]{64}$/u.test(item)) ||
        !["succeeded", "reverted"].includes(result.outcome) ||
        observationHash !== domainHash(VERSION, canonicalJson(body)))
        corrupt();
    if (!isPlainRecord(result.proof))
        corrupt();
    try {
        const proof = validateSwapReceiptProof(result.proof, operation.quote.sourceAsset.chain, operation.submissionMarker.markedAt, result.proof.observedAt, "stored");
        if (!proof.finalized)
            corrupt();
    }
    catch {
        corrupt();
    }
    return result;
}
/** Occupancy is authoritative: a malformed or JSON-null file must never be treated as absent. */
export class OrcaStableFinalizedObservationStore extends SecureStateStore {
    initialized;
    async load(operation) {
        await this.ready();
        const directory = `orca-stable-finalized-observations/${operation.ownerProfileHash}`;
        const name = `${operation.operationId}.json`;
        if (!(await this.readDirectory(directory)).some(entry => entry.name === name))
            return null;
        return validateOrcaStableFinalizedObservation(await this.readJson(this.path(operation)), operation);
    }
    async save(operation, value) {
        validateOrcaStableFinalizedObservation(value, operation);
        await this.ready();
        const existing = await this.load(operation);
        if (existing !== null) {
            if (canonicalJson(existing) !== canonicalJson(value))
                corrupt();
            return existing;
        }
        await this.ensureDirectory(`orca-stable-finalized-observations/${operation.ownerProfileHash}`);
        await this.writeJson(this.path(operation), value, true);
        return value;
    }
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "stable observation profile");
        stateIdentifier(operation.operationId, "stable observation operation");
        return `orca-stable-finalized-observations/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-finalized-observations"); })();
        await this.initialized;
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Stable finalized observation is invalid."); }
//# sourceMappingURL=stable-finalized-proof.js.map