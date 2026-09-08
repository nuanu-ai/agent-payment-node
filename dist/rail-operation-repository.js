import { readdir } from "node:fs/promises";
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
            await this.ensureDirectory("rail-receipts");
        })();
        await this.initialized;
    }
    async loadOperation(profileHash, operationId) {
        await this.ready();
        const value = await this.readJson(this.path("rail-operations", profileHash, operationId));
        if (value === null)
            return null;
        const operation = validateRailOperation(value);
        if (operation.profileHash !== profileHash || operation.operationId !== operationId)
            corrupt();
        return operation;
    }
    async findOperation(operationId) {
        const matches = (await this.listAllOperations()).filter((operation) => operation.operationId === operationId);
        if (matches.length > 1)
            corrupt();
        return matches[0] ?? null;
    }
    async listOperations(profileHash) {
        await this.ready();
        stateIdentifier(profileHash, "rail profile hash");
        const directory = `rail-operations/${profileHash}`;
        await this.ensureDirectory(directory);
        const result = [];
        for (const entry of await readdir(this.resolveRelative(directory), { withFileTypes: true })) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                corrupt();
            const value = await this.loadOperation(profileHash, entry.name.slice(0, -5));
            if (value === null)
                corrupt();
            result.push(value);
        }
        return result;
    }
    async listAllOperations() {
        await this.ready();
        const result = [];
        for (const entry of await readdir(this.resolveRelative("rail-operations"), { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name))
                corrupt();
            result.push(...await this.listOperations(entry.name));
        }
        if (new Set(result.map((operation) => operation.operationId)).size !== result.length)
            corrupt();
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
    /** The operation is authoritative and is persisted before its derived receipt. */
    async persist(operation) {
        await this.writeOperation(operation);
        await this.repairReceipt(operation);
    }
    async repairReceipt(operation) {
        const stored = await this.loadOperation(operation.profileHash, operation.operationId);
        if (stored === null || canonicalJson(stored) !== canonicalJson(operation))
            corrupt();
        const path = this.path("rail-receipts", operation.profileHash, operation.operationId);
        const previous = await this.readJson(path);
        if (previous !== null)
            validateReceiptShape(previous, operation);
        const receipt = railReceipt(operation);
        if (canonicalJson(previous) === canonicalJson(receipt))
            return;
        await this.ensureDirectory(`rail-receipts/${operation.profileHash}`);
        await this.writeJson(path, receipt);
    }
    async loadReceipt(profileHash, operationId) {
        const operation = await this.loadOperation(profileHash, operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "The direct-rail operation was not found.");
        const value = await this.readJson(this.path("rail-receipts", profileHash, operationId));
        if (value !== null)
            validateReceiptShape(value, operation);
        if (value === null || canonicalJson(value) !== canonicalJson(railReceipt(operation))) {
            throw new ApnError("APN_OPERATION_BLOCKED", "The receipt needs recovery from its durable operation.", {
                operationId, nextActions: [`apn operation resume --operation ${operationId}`],
            });
        }
        return value;
    }
    path(root, profileHash, operationId) {
        stateIdentifier(profileHash, "rail profile hash");
        stateIdentifier(operationId, "rail operation ID");
        return `${root}/${profileHash}/${operationId}.json`;
    }
}
function validateReceiptShape(value, operation) {
    if (!isPlainRecord(value))
        corrupt();
    const expectedKeys = Object.keys(railReceipt(operation)).sort();
    if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(expectedKeys) || value.schema_version !== "apn.rail-receipt.v1" || value.operation_id !== operation.operationId || value.fingerprint !== operation.fingerprint)
        corrupt();
    const { receipt_hash, ...body } = value;
    if (hashObject(body) !== receipt_hash)
        corrupt();
    const index = operation.transitions.findIndex((entry) => entry.state === value.state && entry.at === value.updated_at);
    if (index < 0 || canonicalJson(value) !== canonicalJson(railHistoricalReceipt(operation, index)))
        corrupt();
}
function corrupt() { throw new ApnError("APN_STATE_CORRUPT", "The direct-rail store or receipt binding is invalid."); }
//# sourceMappingURL=rail-operation-repository.js.map