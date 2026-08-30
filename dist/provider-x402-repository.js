import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, isPlainRecord } from "./canonical.js";
import { SecureStateStore, stateCorrupt, stateIdentifier, stateSecurity } from "./secure-state-store.js";
import { providerX402BindingHash, validateProviderX402Continuity, validateProviderX402Operation, validateProviderX402Receipt, } from "./provider-x402-model.js";
import { assertProviderX402ReceiptAuthority } from "./provider-x402-validation.js";
const OPERATIONS = "x402-operations";
const RECEIPTS = "x402-receipts";
const LOCAL_OPERATION_SCHEMA = "apn.x402.state.v1";
export class ProviderX402Repository extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= this.initializeRoots();
        await this.initialized;
    }
    async initializeRoots() {
        await super.initialize();
    }
    async loadOperation(profileHash, operationId) {
        await this.ready();
        stateIdentifier(profileHash, "provider x402 profile hash");
        stateIdentifier(operationId, "provider x402 operation ID");
        const value = await this.readJson(join(OPERATIONS, profileHash, `${operationId}.json`));
        if (value === null)
            return null;
        if (schemaVersion(value) === LOCAL_OPERATION_SCHEMA)
            return null;
        const operation = validateProviderX402Operation(value);
        if (operation.profileHash !== profileHash || operation.operationId !== operationId)
            stateCorrupt("Provider x402 path binding is invalid.");
        return operation;
    }
    async findOperation(operationId) {
        await this.ready();
        stateIdentifier(operationId, "provider x402 operation ID");
        let found = null;
        for (const profileHash of await this.profileDirectories(OPERATIONS)) {
            const candidate = await this.loadOperation(profileHash, operationId);
            if (candidate !== null) {
                if (found !== null)
                    stateCorrupt("Provider x402 operation ID is duplicated across profiles.");
                found = candidate;
            }
        }
        return found;
    }
    async listOperations(profileHash) {
        await this.ready();
        stateIdentifier(profileHash, "provider x402 profile hash");
        const directory = join(OPERATIONS, profileHash);
        await this.ensureDirectory(directory);
        const output = [];
        for (const entry of await readdir(this.resolveRelative(directory), { withFileTypes: true })) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) {
                stateSecurity("Provider x402 operations directory contains an unsafe entry.");
            }
            const value = await this.readJson(join(directory, entry.name));
            if (value === null)
                stateCorrupt("Provider x402 operation disappeared during validation.");
            if (schemaVersion(value) === LOCAL_OPERATION_SCHEMA)
                continue;
            const operation = validateProviderX402Operation(value);
            if (operation.profileHash !== profileHash || operation.operationId !== entry.name.slice(0, -5)) {
                stateCorrupt("Provider x402 operation path binding is invalid.");
            }
            output.push(operation);
        }
        return output;
    }
    async listAllOperations() {
        await this.ready();
        const output = [];
        for (const profileHash of await this.profileDirectories(OPERATIONS))
            output.push(...await this.listOperations(profileHash));
        return output;
    }
    async writeOperation(operation) {
        await this.ready();
        validateProviderX402Operation(operation);
        const path = join(OPERATIONS, operation.profileHash, `${operation.operationId}.json`);
        const stored = await this.readJson(path);
        if (stored !== null && schemaVersion(stored) === LOCAL_OPERATION_SCHEMA) {
            stateCorrupt("Provider x402 operation path is occupied by the local strategy.");
        }
        const previous = stored === null ? null : validateProviderX402Operation(stored);
        if (previous !== null)
            validateProviderX402Continuity(previous, operation);
        await this.ensureDirectory(join(OPERATIONS, operation.profileHash));
        await this.writeJson(path, operation);
    }
    async loadReceipt(profileHash, operationId) {
        await this.ready();
        stateIdentifier(profileHash, "provider x402 profile hash");
        stateIdentifier(operationId, "provider x402 operation ID");
        const operation = await this.loadOperation(profileHash, operationId);
        if (operation === null)
            return null;
        const value = await this.readJson(join(RECEIPTS, profileHash, `${operationId}.json`));
        if (value === null)
            return null;
        const receipt = validateProviderX402Receipt(value);
        if (receipt.operationId !== operationId)
            stateCorrupt("Provider x402 receipt path binding is invalid.");
        assertProviderX402ReceiptAuthority(operation, receipt);
        return receipt;
    }
    async writeReceipt(profileHash, receipt) {
        await this.ready();
        validateProviderX402Receipt(receipt);
        const operation = await this.loadOperation(profileHash, receipt.operationId);
        if (operation === null || receipt.fingerprint !== operation.fingerprint ||
            receipt.operationBindingHash !== providerX402BindingHash(operation))
            stateCorrupt("Provider x402 receipt authority is invalid.");
        assertProviderX402ReceiptAuthority(operation, receipt);
        const previous = await this.readJson(join(RECEIPTS, profileHash, `${receipt.operationId}.json`));
        if (previous !== null) {
            if (canonicalJson(previous) !== canonicalJson(receipt))
                stateCorrupt("Provider x402 receipt is immutable.");
            return;
        }
        await this.ensureDirectory(join(RECEIPTS, profileHash));
        await this.writeJson(join(RECEIPTS, profileHash, `${receipt.operationId}.json`), receipt);
    }
    async profileDirectories(rootName) {
        const profiles = [];
        for (const entry of await readdir(this.resolveRelative(rootName), { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) {
                stateSecurity(`${rootName} root contains an unsafe profile entry.`);
            }
            profiles.push(entry.name);
        }
        return profiles.sort();
    }
}
function schemaVersion(value) {
    return isPlainRecord(value) ? value.schemaVersion : undefined;
}
//# sourceMappingURL=provider-x402-repository.js.map