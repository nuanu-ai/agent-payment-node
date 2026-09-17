import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { validateSwapOperation } from "./model.js";
import { transitionSwapOperation } from "./transitions.js";
export class SwapOperationRepository extends SecureStateStore {
    initialized;
    async create(operationValue) {
        const operation = validateSwapOperation(operationValue);
        await this.ready();
        return await this.withLocks([`profile:${operation.ownerProfileHash}`, `operation:${operation.operationId}`], async () => {
            const existing = await this.readBound(operation.ownerProfileHash, operation.operationId);
            if (existing !== null) {
                if (sameImmutable(existing, operation))
                    return existing;
                blocked("Swap operation identity is already owned by different immutable input.");
            }
            const collision = await this.findByIdempotency(operation.ownerProfileHash, operation.idempotencyHash);
            if (collision !== null)
                blocked("Swap idempotency key is already owned by a different operation.");
            await this.ensureDirectory(`swap-operations/${operation.ownerProfileHash}`);
            await this.writeJson(this.path(operation.ownerProfileHash, operation.operationId), operation, true);
            return operation;
        });
    }
    async load(ownerProfileHash, operationId) {
        stateIdentifier(ownerProfileHash, "swap profile hash");
        stateIdentifier(operationId, "swap operation id");
        await this.ready();
        return await this.withLocks([`profile:${ownerProfileHash}`, `operation:${operationId}`], async () => await this.readBound(ownerProfileHash, operationId));
    }
    async loadAny(operationId) {
        stateIdentifier(operationId, "swap operation id");
        const profiles = await this.readDirectory("swap-operations");
        let found = null;
        for (const profile of profiles) {
            if (!profile.isDirectory() || profile.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(profile.name))
                corrupt();
            const candidate = await this.readBound(profile.name, operationId);
            if (candidate !== null) {
                if (found !== null)
                    corrupt();
                found = candidate;
            }
        }
        return found;
    }
    async transition(ownerProfileHash, operationId, expectedIntegrityHash, state, evidence, now) {
        stateIdentifier(ownerProfileHash, "swap profile hash");
        stateIdentifier(operationId, "swap operation id");
        stateIdentifier(expectedIntegrityHash, "swap expected integrity hash");
        await this.ready();
        return await this.withLocks([`profile:${ownerProfileHash}`, `operation:${operationId}`], async () => {
            const current = await this.readBound(ownerProfileHash, operationId);
            if (current === null)
                throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
            if (current.integrityHash !== expectedIntegrityHash)
                blocked("Swap operation changed concurrently.");
            const next = transitionSwapOperation(current, state, evidence, now);
            await this.writeJson(this.path(ownerProfileHash, operationId), next);
            return next;
        });
    }
    async findByIdempotency(profileHash, idempotencyHash) {
        const entries = await this.readDirectory(`swap-operations/${profileHash}`);
        let match = null;
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                corrupt();
            const operation = await this.readBound(profileHash, entry.name.slice(0, -5));
            if (operation?.idempotencyHash === idempotencyHash) {
                if (match !== null)
                    corrupt();
                match = operation;
            }
        }
        return match;
    }
    async readBound(profileHash, operationId) {
        const value = await this.readJson(this.path(profileHash, operationId));
        if (value === null)
            return null;
        const operation = validateSwapOperation(value);
        if (operation.ownerProfileHash !== profileHash || operation.operationId !== operationId)
            corrupt();
        return operation;
    }
    path(profileHash, operationId) { return `swap-operations/${profileHash}/${operationId}.json`; }
    async ready() { this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("swap-operations"); })(); await this.initialized; }
}
function sameImmutable(left, right) {
    const select = (value) => ({ operationId: value.operationId, idempotencyHash: value.idempotencyHash,
        ownerProfileHash: value.ownerProfileHash, quote: value.quote, policyDigest: value.policyDigest,
        policyVersion: value.policyVersion, protocolRegistryDigest: value.protocolRegistryDigest,
        protocolRegistryVersion: value.protocolRegistryVersion, mechanismDigest: value.mechanismDigest,
        approvalCapAtomic: value.approvalCapAtomic });
    return canonicalJson(select(left)) === canonicalJson(select(right));
}
function blocked(message) { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "Swap operation path or ownership binding is invalid."); }
//# sourceMappingURL=repository.js.map