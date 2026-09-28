import { address, getBase64EncodedWireTransaction, getPublicKeyFromAddress, getSignatureFromTransaction, getTransactionDecoder, verifySignature } from "@solana/kit";
import { canonicalJson, domainHash, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { solanaSignature } from "../../solana/rpc.js";
import { validateSwapOperation } from "../model.js";
import { GuardedSwapService } from "../service.js";
import { admitOrcaStableOwner, recheckOrcaStableOwner } from "./stable-admission.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_STABLE_GUARDED_MECHANISM_DIGEST } from "./stable-mechanism.js";
import { validateOrcaStableUnsigned } from "./stable-prepare.js";
import { stableReservationAdmissionPorts } from "./stable-reservation-admission.js";
import { sha256Hex } from "./pins.js";
const VERSION = "apn.orca-stable-execution-binding.v1";
/** Internal journal. A crash after the marker makes every later begin call observe-only. */
export async function beginOrcaStableExecution(service, materials, bindings, ports, operationId, clock) {
    return await beginOrcaStableExecutionCore(service, materials, bindings, ports, operationId, clock);
}
/** Private, one-shot first attempt. No CLI/MCP route is exposed until finalized observation is integrated. */
export async function beginOrcaStableExecutionAndSend(service, materials, bindings, ports, operationId, clock) {
    const prepared = await beginOrcaStableExecutionCore(service, materials, bindings, ports, operationId, clock);
    if (prepared.signature === null)
        return prepared;
    return { ...prepared, operation: await ports.send(operationId) };
}
async function beginOrcaStableExecutionCore(service, materials, bindings, ports, operationId, clock) {
    return await service.operations.withLocks([`orca-stable-operation:${operationId}`], async () => {
        let operation = await service.operations.loadAny(operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Stable Orca operation was not found.");
        if (operation.mechanismDigest !== ORCA_STABLE_GUARDED_MECHANISM_DIGEST)
            blocked("Wrong stable mechanism.", "orca_stable_mechanism_mismatch");
        if (operation.submissionMarker !== null || operation.state !== "reserved")
            blocked("Stable execution already crossed its one-shot boundary.", "orca_stable_observe_only");
        const material = await materials.load(operationId, operation);
        if (material === null)
            corrupt("Stable execution material is missing.");
        const now = checkedNow(clock);
        if (now.toISOString() < operation.quote.effectiveAt || now.toISOString() >= operation.quote.expiresAt)
            blocked("Stable quote expired before execution.", "orca_stable_deadline");
        const admissionPorts = stableReservationAdmissionPorts(ports.admission, service.usage, operation);
        const admission = await admitOrcaStableOwner(admissionPorts, { profile: operation.quote.profile,
            owner: operation.quote.account, policyRevision: material.policyRevision,
            amountInAtomic: operation.quote.inputAmountAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
            now }, ORCA_STABLE_GUARDED_MECHANISM_DIGEST);
        if (admission.policyDigest !== material.policyDigest || admission.activationDigest !== material.activationDigest ||
            operation.policyDigest !== admission.policyDigest)
            blocked("Stable owner policy drifted.", "orca_stable_policy_drift");
        const lease = operation.usageLease;
        if (lease === null || lease.state !== "reserved" || lease.amountAtomic !== operation.quote.inputAmountAtomic ||
            lease.policyDigest !== operation.policyDigest)
            corrupt("Stable principal lease does not match the operation.");
        const liveLease = await service.usage.load({ account: operation.quote.account, chain: operation.quote.sourceAsset.chain,
            asset: { kind: "token", identifier: operation.quote.sourceAsset.identifier } }, lease.reservationId);
        if (liveLease === null || canonicalJson(liveLease) !== canonicalJson(lease))
            corrupt("Stable principal lease changed.");
        const preflight = await ports.preflight(operation, material);
        const preview = await validateOrcaStableUnsigned(preflight.preview);
        const checkedAt = checkedInstant(preflight.checkedAt);
        if (!Number.isSafeInteger(preflight.physicalPostCount) || preflight.physicalPostCount < 1 || preflight.physicalPostCount > 23 ||
            !Number.isSafeInteger(preflight.elapsedMs) || preflight.elapsedMs < 0 || preflight.elapsedMs > 30_000 ||
            !/^[a-f0-9]{64}$/u.test(preflight.simulationHash) ||
            checkedAt < now.toISOString() || checkedAt >= operation.quote.expiresAt ||
            preview.owner !== material.preview.owner || preview.sourceAta !== material.preview.sourceAta ||
            preview.destinationAta !== material.preview.destinationAta || preview.amountInAtomic !== material.preview.amountInAtomic ||
            preview.minimumOutputAtomic !== material.preview.minimumOutputAtomic ||
            canonicalJson(preview.tickArrayStarts) !== canonicalJson(material.preview.tickArrayStarts) ||
            preview.oracle !== material.preview.oracle || preview.createUsdtAta !== material.preview.createUsdtAta ||
            canonicalJson(preview.instructionPrograms) !== canonicalJson(material.preview.instructionPrograms) ||
            BigInt(preview.maximumTotalFeeLamports) > BigInt(material.preview.maximumTotalFeeLamports) ||
            BigInt(preview.ataRentLamports) > BigInt(material.preview.ataRentLamports))
            blocked("Fresh stable execution differs from the owner approval or missed its budget.", "orca_stable_freshness");
        await recheckOrcaStableOwner(admissionPorts, admission, new Date(checkedAt));
        const active = await ports.admission.activePolicy(operation.quote.profile);
        if (active === null || active.digest !== admission.policyDigest || active.revision !== admission.policyRevision ||
            active.activationDigest !== admission.activationDigest)
            blocked("Stable owner activation drifted.", "orca_stable_policy_drift");
        const markAt = checkedNow(clock);
        if (markAt.toISOString() < checkedAt || markAt.toISOString() >= operation.quote.expiresAt ||
            markAt.getTime() - Date.parse(checkedAt) > 750)
            blocked("Stable preflight became stale.", "orca_stable_freshness");
        const markerBody = { operationId, operationIntegrityHash: operation.integrityHash,
            unsignedTransactionPayloadHash: operation.quote.unsignedTransactionPayloadHash, markedAt: markAt.toISOString() };
        operation = await service.operations.transition(operation.ownerProfileHash, operationId, operation.integrityHash, "submitting", {
            submissionMarker: { markerHash: domainHash("apn.swap-submission-marker.v1", canonicalJson(markerBody)),
                markedAt: markerBody.markedAt, operationIntegrityHash: markerBody.operationIntegrityHash,
                unsignedTransactionPayloadHash: markerBody.unsignedTransactionPayloadHash },
        }, markAt);
        // All failures after the marker are observe-only. Never invoke preflight or signing on this operation again.
        let persisted = null;
        try {
            const binding = await bindings.save(operation, material, preflight);
            const account = await ports.admission.localAccount(operation.quote.profile);
            if (account === null || account.provider !== "local" || account.custody !== "local_software" ||
                account.address !== operation.quote.account)
                blocked("Stable signing account changed.", "orca_stable_owner_account");
            const effect = await ports.sign(operation, binding, account);
            await verifyOrcaStableSignedEffect(effect, binding);
            await ports.effects.saveEffect(account, effect);
            persisted = { binding, account, effect };
        }
        catch {
            return { operation, binding: null, signature: null };
        }
        const { binding, effect } = persisted;
        return { operation, binding, signature: effect.transactionId };
    });
}
export class OrcaStableExecutionBindingStore extends SecureStateStore {
    initialized;
    async save(operation, material, preflight) {
        const marker = operation.submissionMarker;
        if (marker === null || operation.state !== "submitting")
            corrupt("Stable execution marker is missing.");
        const body = { schemaVersion: VERSION, operationId: operation.operationId,
            operationIntegrityHash: marker.operationIntegrityHash, submissionMarkerHash: marker.markerHash,
            materialDigest: material.materialDigest, policyDigest: material.policyDigest,
            activationDigest: material.activationDigest, preview: preflight.preview,
            checkedAt: preflight.checkedAt, elapsedMs: preflight.elapsedMs,
            physicalPostCount: preflight.physicalPostCount, simulationHash: preflight.simulationHash };
        const value = { ...body, bindingHash: domainHash(VERSION, canonicalJson(body)) };
        await this.ready();
        return await this.withLocks([`orca-stable-binding:${operation.operationId}`], async () => {
            const path = this.path(operation);
            const existing = await this.readJson(path);
            if (existing !== null) {
                const prior = await this.load(operation, material);
                if (prior === null || canonicalJson(prior) !== canonicalJson(value))
                    corrupt("Stable execution binding changed.");
                return prior;
            }
            await this.ensureDirectory(`orca-stable-execution-bindings/${operation.ownerProfileHash}`);
            await this.writeJson(path, value, true);
            return value;
        });
    }
    async load(operation, material) {
        await this.ready();
        const raw = await this.readJson(this.path(operation));
        if (raw === null)
            return null;
        const value = raw;
        const { bindingHash, ...body } = value;
        if (bindingHash !== domainHash(VERSION, canonicalJson(body)) ||
            value.schemaVersion !== VERSION || value.operationId !== operation.operationId ||
            value.operationIntegrityHash !== operation.submissionMarker?.operationIntegrityHash ||
            value.submissionMarkerHash !== operation.submissionMarker?.markerHash ||
            value.materialDigest !== material.materialDigest || value.policyDigest !== material.policyDigest ||
            value.activationDigest !== material.activationDigest ||
            value.preview.owner !== operation.quote.account ||
            value.preview.amountInAtomic !== operation.quote.inputAmountAtomic ||
            value.preview.minimumOutputAtomic !== operation.quote.minimumOutputAtomic)
            corrupt("Stable execution binding is invalid.");
        await validateOrcaStableUnsigned(value.preview);
        return value;
    }
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "stable binding profile");
        stateIdentifier(operation.operationId, "stable binding operation");
        return `orca-stable-execution-bindings/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("orca-stable-execution-bindings"); })();
        await this.initialized;
    }
}
export async function verifyOrcaStableSignedEffect(effect, binding) {
    try {
        const bytes = Buffer.from(effect.rawPayload, "base64"), wire = getTransactionDecoder().decode(bytes);
        const signature = wire.signatures[address(binding.preview.owner)];
        if (bytes.toString("base64") !== effect.rawPayload || sha256(effect.rawPayload) !== effect.rawPayloadHash ||
            effect.fingerprint !== binding.bindingHash || effect.operationId !== binding.operationId ||
            Object.keys(wire.signatures).length !== 1 || signature === undefined || signature === null ||
            sha256Hex(new Uint8Array(wire.messageBytes)) !== binding.preview.messageHash ||
            Buffer.from(wire.messageBytes).toString("base64") !== binding.preview.messageBase64 ||
            getBase64EncodedWireTransaction(wire) !== effect.rawPayload ||
            getSignatureFromTransaction(wire) !== solanaSignature(effect.transactionId) ||
            !await verifySignature(await getPublicKeyFromAddress(address(binding.preview.owner)), signature, wire.messageBytes))
            throw new Error();
    }
    catch {
        corrupt("Stable signed effect does not bind the exact owner and message.");
    }
}
function checkedNow(clock) {
    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        throw new ApnError("APN_INVALID_INPUT", "Stable execution clock is invalid.");
    return now;
}
function checkedInstant(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString() !== value)
        throw new ApnError("APN_INVALID_INPUT", "Stable preflight instant is invalid.");
    return value;
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=stable-execution-journal.js.map