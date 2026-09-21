import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import {} from "./operation-model.js";
import { bridgeCorrupt, validateBridgeContinuity, validateBridgeOperation, validateLegacyBridgeOperation } from "./operation-validation.js";
import { bridgeReceipt, currentBridgeReceiptCandidates } from "./receipt.js";
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
            await this.ensureDirectory("bridge-migrations");
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
    /** Caller holds the profile and operation locks. The audit-first order makes an interrupted repair resumable. */
    async migrateDeployment(previous, next, audit) {
        validateBridgeOperation(previous);
        validateBridgeOperation(next);
        await this.ready();
        const current = await this.loadOperation(previous.profileHash, previous.operationId);
        if (current === null || (current.integrityHash !== previous.integrityHash && current.integrityHash !== next.integrityHash))
            bridgeCorrupt();
        const auditPath = `bridge-migrations/${previous.profileHash}/${previous.operationId}.json`;
        const savedAudit = await this.readJson(auditPath);
        if (savedAudit !== null && !bridgeSame(savedAudit, audit))
            bridgeCorrupt();
        const receiptPath = this.path("bridge-receipts", previous.profileHash, previous.operationId);
        if (current.integrityHash === previous.integrityHash) {
            const oldReceipt = await this.readJson(receiptPath);
            if (oldReceipt !== null)
                validateReceipt(oldReceipt, previous);
            await this.ensureDirectory(`bridge-migrations/${previous.profileHash}`);
            if (savedAudit === null)
                await this.writeJson(auditPath, audit);
            await this.writeJson(this.path("bridge-operations", previous.profileHash, previous.operationId), next);
        }
        else if (savedAudit === null)
            bridgeCorrupt();
        await this.ensureDirectory(`bridge-receipts/${previous.profileHash}`);
        await this.writeJson(receiptPath, bridgeReceipt(next));
    }
    /** Complete or verify the derived receipt after an audit-first migration was interrupted. */
    async repairMigratedDeployment(previous, op, audit) {
        validateBridgeOperation(previous);
        validateBridgeOperation(op);
        await this.ready();
        if (op.fingerprint !== audit.newFingerprint || op.integrityHash !== audit.newIntegrityHash ||
            op.transitions.at(-1)?.transitionHash !== audit.newTransitionRoot || previous.fingerprint !== audit.oldFingerprint ||
            previous.integrityHash !== audit.oldIntegrityHash || previous.transitions.at(-1)?.transitionHash !== audit.oldTransitionRoot)
            bridgeCorrupt();
        const savedAudit = await this.readJson(`bridge-migrations/${op.profileHash}/${op.operationId}.json`);
        if (!bridgeSame(savedAudit, audit))
            bridgeCorrupt();
        const receiptPath = this.path("bridge-receipts", op.profileHash, op.operationId), savedReceipt = await this.readJson(receiptPath);
        if (savedReceipt !== null && !bridgeSame(savedReceipt, bridgeReceipt(previous)) && !bridgeSame(savedReceipt, bridgeReceipt(op)))
            bridgeCorrupt();
        await this.ensureDirectory(`bridge-receipts/${op.profileHash}`);
        if (!bridgeSame(savedReceipt, bridgeReceipt(op)))
            await this.writeJson(receiptPath, bridgeReceipt(op));
    }
    /** One exact pre-allowlist Base journal can be promoted without relaxing normal legacy loading. */
    async migrateLegacyDeployment(previous, next, audit) {
        validateLegacyBridgeOperation(previous);
        validateBridgeOperation(next);
        await this.ready();
        const legacy = adaptLegacyBridgeOperation(previous), current = await this.loadStoredOperation(previous.profileHash, previous.operationId);
        if (current === null || (isLegacyBridgeOperation(current) ? current.raw.integrityHash !== previous.integrityHash
            : current.integrityHash !== next.integrityHash))
            bridgeCorrupt();
        const auditPath = `bridge-migrations/${previous.profileHash}/${previous.operationId}.json`, savedAudit = await this.readJson(auditPath);
        if (savedAudit !== null && !bridgeSame(savedAudit, audit))
            bridgeCorrupt();
        const receiptPath = this.path("bridge-receipts", previous.profileHash, previous.operationId);
        if (isLegacyBridgeOperation(current)) {
            const oldReceipt = await this.readJson(receiptPath);
            if (oldReceipt !== null && !legacyBridgeReceiptCandidates(legacy).some((candidate) => bridgeSame(oldReceipt, candidate)))
                bridgeCorrupt();
            await this.ensureDirectory(`bridge-migrations/${previous.profileHash}`);
            if (savedAudit === null)
                await this.writeJson(auditPath, audit);
            await this.writeJson(this.path("bridge-operations", previous.profileHash, previous.operationId), next);
        }
        else if (savedAudit === null)
            bridgeCorrupt();
        await this.ensureDirectory(`bridge-receipts/${previous.profileHash}`);
        await this.writeJson(receiptPath, bridgeReceipt(next));
    }
    /** Finish or verify the receipt replacement after the legacy operation was atomically replaced. */
    async repairMigratedLegacyDeployment(previous, op, audit) {
        validateLegacyBridgeOperation(previous);
        validateBridgeOperation(op);
        await this.ready();
        if (op.fingerprint !== audit.newFingerprint || op.integrityHash !== audit.newIntegrityHash ||
            op.transitions.at(-1)?.transitionHash !== audit.newTransitionRoot || previous.fingerprint !== audit.oldFingerprint ||
            previous.integrityHash !== audit.oldIntegrityHash || previous.transitions.at(-1)?.transitionHash !== audit.oldTransitionRoot)
            bridgeCorrupt();
        const savedAudit = await this.readJson(`bridge-migrations/${op.profileHash}/${op.operationId}.json`);
        if (!bridgeSame(savedAudit, audit))
            bridgeCorrupt();
        const receiptPath = this.path("bridge-receipts", op.profileHash, op.operationId), savedReceipt = await this.readJson(receiptPath);
        const legacy = adaptLegacyBridgeOperation(previous);
        if (savedReceipt !== null && !legacyBridgeReceiptCandidates(legacy).some((candidate) => bridgeSame(savedReceipt, candidate)) &&
            !bridgeSame(savedReceipt, bridgeReceipt(op)))
            bridgeCorrupt();
        await this.ensureDirectory(`bridge-receipts/${op.profileHash}`);
        if (!bridgeSame(savedReceipt, bridgeReceipt(op)))
            await this.writeJson(receiptPath, bridgeReceipt(op));
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
    if (index < 0 || !currentBridgeReceiptCandidates(bridgeAtTransition(op, index))
        .some((candidate) => bridgeSame(value, candidate)))
        bridgeCorrupt();
}
//# sourceMappingURL=operation-repository.js.map