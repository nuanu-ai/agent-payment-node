import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import {} from "./operation-model.js";
import { bridgeCorrupt, validateBridgeContinuity, validateBridgeOperation } from "./operation-validation.js";
import { bridgeReceipt } from "./receipt.js";
import { legacyBridgeReceiptCandidates } from "./receipt.js";
import { bridgeAtTransition } from "./transitions.js";
import { bridgeFailure, bridgeSame } from "./validation.js";
import { adaptLegacyBridgeOperation, isLegacyBridgeOperation } from "./legacy-operation.js";
export class BridgeOperationRepository extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => {
            await super.initialize();
            await this.ensureDirectory("bridge-operations");
            await this.ensureDirectory("bridge-receipts");
        })();
        await this.initialized;
    }
    async loadOperation(profileHash, operationId) {
        const stored = await this.loadStoredOperation(profileHash, operationId);
        if (stored === null)
            return null;
        if (isLegacyBridgeOperation(stored))
            bridgeCorrupt();
        return stored;
    }
    async loadStoredOperation(profileHash, operationId) {
        const value = await this.readJson(this.path("bridge-operations", profileHash, operationId));
        if (value === null)
            return null;
        let op;
        try {
            op = validateBridgeOperation(value);
        }
        catch (error) {
            if (!(error instanceof ApnError) || error.code !== "APN_STATE_CORRUPT")
                throw error;
            op = adaptLegacyBridgeOperation(value);
        }
        if (op.profileHash !== profileHash || op.operationId !== operationId)
            bridgeCorrupt();
        return op;
    }
    async findStoredOperation(operationId) {
        stateIdentifier(operationId, "bridge operation ID");
        const matches = (await this.listAllStoredOperations()).filter((op) => op.operationId === operationId);
        if (matches.length > 1)
            bridgeCorrupt();
        return matches[0] ?? null;
    }
    async listStoredOperations(profileHash) {
        stateIdentifier(profileHash, "bridge profile hash");
        const directory = `bridge-operations/${profileHash}`;
        const result = [];
        for (const entry of await this.readDirectory(directory)) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                bridgeCorrupt();
            const op = await this.loadStoredOperation(profileHash, entry.name.slice(0, -5));
            if (op === null)
                bridgeCorrupt();
            result.push(op);
        }
        return result;
    }
    async listAllStoredOperations() {
        const result = [];
        for (const entry of await this.readDirectory("bridge-operations")) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name))
                bridgeCorrupt();
            result.push(...await this.listStoredOperations(entry.name));
        }
        if (new Set(result.map((op) => op.operationId)).size !== result.length)
            bridgeCorrupt();
        return result;
    }
    async findOperation(operationId) {
        const stored = await this.findStoredOperation(operationId);
        if (stored === null)
            return null;
        if (isLegacyBridgeOperation(stored))
            bridgeCorrupt();
        return stored;
    }
    async listOperations(profileHash) {
        return (await this.listStoredOperations(profileHash)).filter((op) => !isLegacyBridgeOperation(op));
    }
    async listAllOperations() {
        return (await this.listAllStoredOperations()).filter((op) => !isLegacyBridgeOperation(op));
    }
    async writeOperation(op) {
        validateBridgeOperation(op);
        await this.ready();
        if (Buffer.byteLength(canonicalJson(op), "utf8") + 1 > 1024 * 1024)
            bridgeFailure("APN_OPERATION_BLOCKED", "bridge_record_capacity");
        const previous = await this.loadOperation(op.profileHash, op.operationId);
        if (previous !== null)
            validateBridgeContinuity(previous, op);
        else if (op.state !== "awaiting_approval" || op.transitions.length !== 1)
            bridgeCorrupt();
        if (previous !== null && bridgeSame(previous, op))
            return;
        await this.ensureDirectory(`bridge-operations/${op.profileHash}`);
        await this.writeJson(this.path("bridge-operations", op.profileHash, op.operationId), op);
    }
    /** Caller holds the same profile/operation locks as every other money service. */
    async persist(op) {
        await this.writeOperation(op);
        await this.repairReceipt(op);
    }
    async repairReceipt(op) {
        await this.ready();
        const stored = await this.loadOperation(op.profileHash, op.operationId);
        if (stored === null || !bridgeSame(stored, op))
            bridgeCorrupt();
        const path = this.path("bridge-receipts", op.profileHash, op.operationId), previous = await this.readJson(path);
        if (previous !== null)
            validateReceipt(previous, op);
        const receipt = bridgeReceipt(op);
        if (bridgeSame(previous, receipt))
            return;
        await this.ensureDirectory(`bridge-receipts/${op.profileHash}`);
        await this.writeJson(path, receipt);
    }
    async loadReceipt(profileHash, operationId) {
        const op = await this.loadOperation(profileHash, operationId);
        if (op === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "The bridge operation was not found.");
        const value = await this.readJson(this.path("bridge-receipts", profileHash, operationId));
        if (value !== null)
            validateReceipt(value, op);
        if (value === null || !bridgeSame(value, bridgeReceipt(op)))
            throw new ApnError("APN_OPERATION_BLOCKED", "The bridge receipt needs recovery from its saved operation.", {
                operationId, nextActions: [`apn operation resume --operation ${operationId}`],
            });
        return value;
    }
    async loadLegacyReceipt(op) {
        const value = await this.readJson(this.path("bridge-receipts", op.profileHash, op.operationId));
        if (!isPlainRecord(value) || !legacyBridgeReceiptCandidates(op).some((candidate) => bridgeSame(value, candidate)))
            bridgeCorrupt();
        return value;
    }
    path(root, profileHash, operationId) {
        stateIdentifier(profileHash, "bridge profile hash");
        stateIdentifier(operationId, "bridge operation ID");
        return `${root}/${profileHash}/${operationId}.json`;
    }
}
function validateReceipt(value, op) {
    if (!isPlainRecord(value) || value.operation_id !== op.operationId || value.fingerprint !== op.fingerprint)
        bridgeCorrupt();
    const { receipt_hash, ...body } = value;
    if (hashObject(body) !== receipt_hash)
        bridgeCorrupt();
    const index = op.transitions.findIndex((_, i) => bridgeAtTransition(op, i).integrityHash === value.operation_binding_hash);
    if (index < 0 || !bridgeSame(value, bridgeReceipt(bridgeAtTransition(op, index))))
        bridgeCorrupt();
}
//# sourceMappingURL=operation-repository.js.map