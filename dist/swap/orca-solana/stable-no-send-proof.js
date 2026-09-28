import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
const VERSION = "apn.orca-stable-no-send-proof.v1";
/** The hash identifies the exact marker, material, custody identity and reserved principal lease. */
export function orcaStableNoSendProof(operation, material, binding, account) {
    if (operation.submissionMarker === null || operation.usageLease === null)
        corrupt();
    const body = { schemaVersion: VERSION, operationId: operation.operationId,
        ownerProfileHash: operation.ownerProfileHash, quoteHash: operation.quote.quoteHash,
        markerHash: operation.submissionMarker.markerHash,
        markerOperationIntegrityHash: operation.submissionMarker.operationIntegrityHash,
        materialDigest: material.materialDigest, bindingHash: binding?.bindingHash ?? null,
        custodyAccountIdentityHash: account.identityHash, reservationId: operation.usageLease.reservationId,
        reservedLeaseIntegrityHash: operation.usageLease.reservationDigest };
    return { ...body, proofHash: domainHash(VERSION, canonicalJson(body)) };
}
export class OrcaStableNoSendProofStore extends SecureStateStore {
    initialized;
    async save(expected) {
        validateOrcaStableNoSendProof(expected);
        await this.ready();
        return await this.withLocks([`orca-stable-no-send-proof:${expected.operationId}`], async () => {
            const path = this.path(expected);
            const existing = await this.readJson(path);
            if (existing !== null) {
                const previous = validateOrcaStableNoSendProof(existing);
                if (canonicalJson(previous) !== canonicalJson(expected))
                    corrupt();
                return previous;
            }
            await this.ensureDirectory(`orca-stable-no-send-proofs/${expected.ownerProfileHash}`);
            await this.writeJson(path, expected, true);
            return expected;
        });
    }
    async load(operation) {
        await this.ready();
        const raw = await this.readJson(this.path(operation));
        return raw === null ? null : validateOrcaStableNoSendProof(raw);
    }
    path(value) {
        stateIdentifier(value.ownerProfileHash, "stable no-send owner");
        stateIdentifier(value.operationId, "stable no-send operation");
        return `orca-stable-no-send-proofs/${value.ownerProfileHash}/${value.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-no-send-proofs"); })();
        await this.initialized;
    }
}
export function validateOrcaStableNoSendProof(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        corrupt();
    const proof = value;
    const { proofHash, ...body } = proof;
    if (Object.keys(proof).length !== 12 || proof.schemaVersion !== VERSION ||
        ![proof.operationId, proof.ownerProfileHash, proof.quoteHash, proof.markerHash,
            proof.markerOperationIntegrityHash, proof.materialDigest, proof.custodyAccountIdentityHash,
            proof.reservationId, proof.reservedLeaseIntegrityHash, proof.proofHash]
            .every((item) => typeof item === "string" && /^[a-f0-9]{64}$/u.test(item)) ||
        (proof.bindingHash !== null && (typeof proof.bindingHash !== "string" || !/^[a-f0-9]{64}$/u.test(proof.bindingHash))) ||
        proofHash !== domainHash(VERSION, canonicalJson(body)))
        corrupt();
    return proof;
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Stable no-send proof is invalid."); }
//# sourceMappingURL=stable-no-send-proof.js.map