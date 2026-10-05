import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { validateDirectAllowlistBinding } from "./direct-allowlist-gate.js";
import { SecureStateStore } from "./secure-state-store.js";
const CLAIM_HASH = /^[a-f0-9]{64}$/u;
export function sealPrepareClaim(body) {
    return validatePrepareClaim({ ...body, integrityHash: hashObject(body) });
}
function validatePrepareClaim(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profileHash", "operationId", "idempotencyHash",
        "inputHash", "requestHash", "accountIdentityHash", "policyHash", "allowlist", "integrityHash"]) ||
        value.schemaVersion !== "apn.rail-prepare-claim.v1")
        corrupt();
    for (const key of ["profileHash", "operationId", "idempotencyHash", "inputHash", "requestHash", "accountIdentityHash", "policyHash", "integrityHash"]) {
        if (typeof value[key] !== "string" || !CLAIM_HASH.test(value[key]))
            corrupt();
    }
    validateDirectAllowlistBinding(value.allowlist);
    const { integrityHash, ...body } = value;
    if (hashObject(body) !== integrityHash)
        corrupt();
    return value;
}
export class RailPrepareClaimStore extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("rail-prepare-claims"); })();
        await this.initialized;
    }
    path(idempotencyHash) {
        if (!CLAIM_HASH.test(idempotencyHash))
            corrupt();
        return `rail-prepare-claims/${idempotencyHash}.json`;
    }
    async load(idempotencyHash) {
        await this.ready();
        const value = await this.readJson(this.path(idempotencyHash));
        if (value === null)
            return null;
        const claim = validatePrepareClaim(value);
        if (claim.idempotencyHash !== idempotencyHash)
            corrupt();
        return claim;
    }
    async create(claim) {
        validatePrepareClaim(claim);
        await this.ready();
        await this.writeJson(this.path(claim.idempotencyHash), claim, true);
    }
    async remove(idempotencyHash) {
        await this.ready();
        await this.removeFile(this.path(idempotencyHash));
    }
    async removeIfMatches(claim) {
        if ((await this.load(claim.idempotencyHash))?.integrityHash === claim.integrityHash)
            await this.remove(claim.idempotencyHash);
    }
}
export function sealApprovalClaim(body) {
    return validateApprovalClaim({ ...body, integrityHash: hashObject(body) });
}
function validateApprovalClaim(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profileHash", "operationId", "operationIntegrityHash",
        "fingerprint", "accountIdentityHash", "policyHash", "allowlist", "integrityHash"]) ||
        value.schemaVersion !== "apn.rail-approval-claim.v1")
        corrupt();
    for (const key of ["profileHash", "operationId", "operationIntegrityHash", "fingerprint", "accountIdentityHash", "policyHash", "integrityHash"]) {
        if (typeof value[key] !== "string" || !CLAIM_HASH.test(value[key]))
            corrupt();
    }
    validateDirectAllowlistBinding(value.allowlist);
    const { integrityHash, ...body } = value;
    if (hashObject(body) !== integrityHash)
        corrupt();
    return value;
}
export class RailApprovalClaimStore extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("rail-approval-claims"); })();
        await this.initialized;
    }
    path(operationId) {
        if (!CLAIM_HASH.test(operationId))
            corrupt();
        return `rail-approval-claims/${operationId}.json`;
    }
    async load(operationId) {
        await this.ready();
        const value = await this.readJson(this.path(operationId));
        if (value === null)
            return null;
        const claim = validateApprovalClaim(value);
        if (claim.operationId !== operationId)
            corrupt();
        return claim;
    }
    async create(claim) {
        validateApprovalClaim(claim);
        await this.ready();
        await this.writeJson(this.path(claim.operationId), claim, true);
    }
    async removeIfMatches(claim) {
        if ((await this.load(claim.operationId))?.integrityHash === claim.integrityHash)
            await this.removeFile(this.path(claim.operationId));
    }
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail effect or operation binding is invalid."); }
//# sourceMappingURL=rail-operation-claims.js.map