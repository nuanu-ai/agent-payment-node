import { canonicalJson, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { railHistoricalReceipt, railReceipt, validateRailContinuity, validateRailOperation } from "./rail-operation-model.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";
export class RailOperationRepository extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => {
            await super.initialize();
            await this.ensureDirectory("rail-operations");
        })();
        await this.initialized;
    }
    async loadOperation(profileHash, operationId) {
        const value = await this.readJson(this.path("rail-operations", profileHash, operationId));
        if (value === null)
            return null;
        const operation = validateRailOperation(value);
        if (operation.profileHash !== profileHash || operation.operationId !== operationId)
            corrupt();
        return operation;
    }
    async findOperation(operationId) {
        stateIdentifier(operationId, "rail operation ID");
        return await this.findInProfiles("rail-operations", async (profileHash) => await this.loadOperation(profileHash, operationId), corrupt);
    }
    async listOperations(profileHash) {
        stateIdentifier(profileHash, "rail profile hash");
        const directory = `rail-operations/${profileHash}`;
        const result = [];
        for (const entry of await this.readDirectory(directory)) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                corrupt();
            const value = await this.loadOperation(profileHash, entry.name.slice(0, -5));
            if (value === null)
                corrupt();
            result.push(value);
        }
        return result;
    }
    async writeOperation(operation) {
        validateRailOperation(operation);
        await this.ready();
        const previous = await this.loadOperation(operation.profileHash, operation.operationId);
        if (previous !== null)
            validateRailContinuity(previous, operation);
        else if (operation.state !== "awaiting_approval" || operation.transitions.length !== 1)
            corrupt();
        await this.ensureDirectory(`rail-operations/${operation.profileHash}`);
        await this.writeJson(this.path("rail-operations", operation.profileHash, operation.operationId), operation);
    }
    /** The operation is the only record written; its receipt is derived from it on read. */
    async persist(operation) {
        await this.writeOperation(operation);
    }
    /**
     * The receipt of the operation's current transition. A receipt file a released version wrote for that transition is
     * returned as written; a file of an earlier transition is history, so the receipt is then derived from the operation.
     */
    async loadReceipt(profileHash, operationId) {
        const operation = await this.loadOperation(profileHash, operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "The direct-rail operation was not found.");
        const value = await this.readJson(this.path("rail-receipts", profileHash, operationId));
        if (value !== null && receiptTransition(value, operation) === operation.transitions.length - 1)
            return value;
        return railReceipt(operation);
    }
    path(root, profileHash, operationId) {
        stateIdentifier(profileHash, "rail profile hash");
        stateIdentifier(operationId, "rail operation ID");
        return `${root}/${profileHash}/${operationId}.json`;
    }
}
/** The transition a stored receipt belongs to; corrupt when it binds none of them exactly. */
function receiptTransition(value, operation) {
    if (!isPlainRecord(value))
        corrupt();
    const index = operation.transitions.findIndex((entry) => entry.state === value.state && entry.at === value.updated_at);
    if (index < 0)
        corrupt();
    // The stored receipt belongs to its own transition, so its shape is that transition's shape.
    const expected = railHistoricalReceipt(operation, index);
    if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(Object.keys(expected).sort()) || value.schema_version !== "apn.rail-receipt.v1" || value.operation_id !== operation.operationId || value.fingerprint !== operation.fingerprint)
        corrupt();
    const { receipt_hash, ...body } = value;
    if (hashObject(body) !== receipt_hash)
        corrupt();
    if (canonicalJson(value) !== canonicalJson(expected))
        corrupt();
    return index;
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail store or receipt binding is invalid."); }
//# sourceMappingURL=rail-operation-repository.js.map