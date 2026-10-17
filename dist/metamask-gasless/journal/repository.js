import { canonicalJson } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { MM_FILE_LIMIT } from "../operation-model.js";
import { mmFail } from "../reasons.js";
import { mmSame } from "../validation.js";
import { metaMaskGaslessReceipt, validateMetaMaskGaslessReceipt } from "./receipt.js";
import { validateMetaMaskGaslessContinuity, validateMetaMaskGaslessOperation } from "./validation.js";
const OPERATIONS = "metamask-gasless-operations";
const RECEIPTS = "metamask-gasless-receipts";
function corrupt() { return mmFail("mm_gasless_state_corrupt"); }
function capacity() { return mmFail("mm_gasless_record_capacity"); }
export class MetaMaskGaslessOperationRepository extends SecureStateStore {
    initialized;
    async ready() {
        this.initialized ??= (async () => {
            await super.initialize();
            await this.ensureDirectory(OPERATIONS);
        })();
        await this.initialized;
    }
    async loadOperation(profileHash, operationId) {
        const value = await this.readJson(this.path(OPERATIONS, profileHash, operationId));
        if (value === null)
            return null;
        const operation = validateMetaMaskGaslessOperation(value);
        if (operation.profileHash !== profileHash || operation.operationId !== operationId)
            corrupt();
        return operation;
    }
    /** Reads only files named by this ID, so another saved operation can never break this lookup. */
    async findOperation(operationId) {
        stateIdentifier(operationId, "MetaMask gasless operation ID");
        const matches = [];
        for (const entry of await this.readDirectory(OPERATIONS)) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name))
                corrupt();
            const operation = await this.loadOperation(entry.name, operationId);
            if (operation !== null)
                matches.push(operation);
        }
        if (matches.length > 1)
            corrupt();
        return matches[0] ?? null;
    }
    async listOperations(profileHash) {
        stateIdentifier(profileHash, "MetaMask gasless profile hash");
        const directory = `${OPERATIONS}/${profileHash}`;
        const result = [];
        for (const entry of await this.readDirectory(directory)) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name))
                corrupt();
            const operation = await this.loadOperation(profileHash, entry.name.slice(0, -5));
            if (operation === null)
                corrupt();
            result.push(operation);
        }
        return result;
    }
    async listAllOperations() {
        const result = [];
        for (const entry of await this.readDirectory(OPERATIONS)) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name))
                corrupt();
            result.push(...await this.listOperations(entry.name));
        }
        if (new Set(result.map(operation => operation.operationId)).size !== result.length ||
            new Set(result.map(operation => operation.idempotencyHash)).size !== result.length)
            corrupt();
        return result;
    }
    async writeOperation(operationInput) {
        const operation = validateMetaMaskGaslessOperation(operationInput);
        if (Buffer.byteLength(canonicalJson(operation), "utf8") + 1 > MM_FILE_LIMIT)
            capacity();
        await this.ready();
        const previous = await this.loadOperation(operation.profileHash, operation.operationId);
        if (previous === null) {
            if (operation.state !== "awaiting_approval" || operation.transitions.length !== 1)
                corrupt();
            const duplicate = (await this.listAllOperations()).find(candidate => candidate.operationId === operation.operationId || candidate.idempotencyHash === operation.idempotencyHash);
            if (duplicate !== undefined)
                corrupt();
        }
        else {
            validateMetaMaskGaslessContinuity(previous, operation);
            if (mmSame(previous, operation))
                return;
        }
        await this.ensureDirectory(`${OPERATIONS}/${operation.profileHash}`);
        await this.writeJson(this.path(OPERATIONS, operation.profileHash, operation.operationId), operation);
    }
    /** Caller holds the shared profile and operation locks. The operation is the only record; its receipt is derived. */
    async persist(operation) {
        await this.writeOperation(operation);
    }
    /** A receipt file a released version wrote for the current transition is returned as written; otherwise it is derived. */
    async loadReceipt(profileHash, operationId) {
        const operation = await this.loadOperation(profileHash, operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "The MetaMask gasless operation was not found.");
        const value = await this.readJson(this.path(RECEIPTS, profileHash, operationId));
        const stored = value === null ? null : validateMetaMaskGaslessReceipt(value, operation);
        return stored !== null && stored.transition_hash === operation.transitions.at(-1).transitionHash ? stored : metaMaskGaslessReceipt(operation);
    }
    path(root, profileHash, operationId) {
        stateIdentifier(profileHash, "MetaMask gasless profile hash");
        stateIdentifier(operationId, "MetaMask gasless operation ID");
        return `${root}/${profileHash}/${operationId}.json`;
    }
}
//# sourceMappingURL=repository.js.map