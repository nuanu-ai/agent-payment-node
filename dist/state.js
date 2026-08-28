import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink, } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { MacosAdvisoryLock } from "./macos-advisory-lock.js";
import { validateOperation, validateReceipt, validateWallet } from "./state-integrity.js";
import { x402OperationBindingHash, x402TransactionHintSourceBindingHash, validateX402Operation, validateX402Receipt, validateX402Result, } from "./x402-state-integrity.js";
export { appendTransition, sealOperation, sealReceipt, sealWallet } from "./state-integrity.js";
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_STATE_BYTES = 1024 * 1024;
const STATE_IDENTIFIER = /^[a-f0-9]{64}$/u;
function uid() {
    const value = process.geteuid?.();
    if (value === undefined)
        throw new ApnError("APN_STATE_SECURITY", "Effective user identity is unavailable.");
    return value;
}
function permissions(stats) {
    return stats.mode & 0o777;
}
function stateSecurity(message) {
    throw new ApnError("APN_STATE_SECURITY", message);
}
function stateCorrupt(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
function stateIdentifier(value, label) {
    if (!STATE_IDENTIFIER.test(value))
        stateSecurity(`${label} is not a canonical state identifier.`);
}
function validateDirectory(stats, root) {
    if (!stats.isDirectory() || stats.isSymbolicLink())
        stateSecurity("State directory is not a real directory.");
    if (stats.uid !== uid())
        stateSecurity("State directory has the wrong owner.");
    if (root && permissions(stats) !== DIRECTORY_MODE)
        stateSecurity("State root must have mode 0700.");
    if (!root && (permissions(stats) & 0o077) !== 0)
        stateSecurity("State directory is accessible by another user.");
}
function validateFile(stats) {
    if (!stats.isFile() || stats.isSymbolicLink())
        stateSecurity("State entry is not a regular file.");
    if (stats.uid !== uid())
        stateSecurity("State file has the wrong owner.");
    if (permissions(stats) !== FILE_MODE)
        stateSecurity("State file must have mode 0600.");
    if (stats.nlink !== 1)
        stateSecurity("State file must have exactly one link.");
}
export class StateStore {
    root;
    lockWaitMs;
    lockPort;
    constructor(root, options = {}) {
        if (!isAbsolute(root) || normalize(root) !== root || resolve(root) !== root) {
            throw new ApnError("APN_STATE_SECURITY", "State root must be a canonical absolute path.");
        }
        this.root = root;
        this.lockWaitMs = options.lockWaitMs ?? 5_000;
        if (!Number.isSafeInteger(this.lockWaitMs) || this.lockWaitMs < 0 || this.lockWaitMs > 60_000) {
            throw new ApnError("APN_STATE_SECURITY", "State lock wait must be between 0 and 60000 milliseconds.");
        }
        this.lockPort = options.lockPort ?? new MacosAdvisoryLock();
    }
    async initialize() {
        await this.assertNoSymlinkAncestors(this.root);
        try {
            await mkdir(this.root, { mode: DIRECTORY_MODE });
        }
        catch (error) {
            if (!isCode(error, "EEXIST"))
                throw error;
        }
        validateDirectory(await lstat(this.root), true);
        const canonical = await realpath(this.root);
        if (canonical !== this.root)
            stateSecurity("State root resolves through an alias or symbolic link.");
        for (const name of ["wallets", "operations", "receipts", "x402-operations", "x402-results", "x402-receipts", "locks"]) {
            await this.ensureDirectory(name);
        }
    }
    profileHash(profile) {
        return sha256(`profile\0${profile}`);
    }
    operationId(profile, idempotencyKey) {
        return sha256(`operation\0${profile}\0${idempotencyKey}`);
    }
    idempotencyHash(idempotencyKey) {
        return sha256(`idempotency\0${idempotencyKey}`);
    }
    async loadWallet(profileHash) {
        const value = await this.readJson(join("wallets", profileHash, "wallet.json"));
        return value === null ? null : validateWallet(value);
    }
    async writeWallet(wallet) {
        await this.ensureDirectory(join("wallets", wallet.profileHash));
        await this.writeJson(join("wallets", wallet.profileHash, "wallet.json"), wallet);
    }
    async loadEncryptedWalletEnvelope(profile) {
        return await this.readJson(join("wallets", `${profile}.json`));
    }
    async writeEncryptedWalletEnvelope(profile, envelope) {
        await this.writeJson(join("wallets", `${profile}.json`), envelope);
    }
    async loadOperation(profileHash, operationId) {
        const value = await this.readJson(join("operations", profileHash, `${operationId}.json`));
        return value === null ? null : validateOperation(value);
    }
    async findOperation(operationId) {
        const operationsRoot = this.resolveRelative("operations");
        const entries = await readdir(operationsRoot, { withFileTypes: true });
        let found = null;
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) {
                stateSecurity("Operations root contains an unsafe profile entry.");
            }
            const candidate = await this.loadOperation(entry.name, operationId);
            if (candidate !== null) {
                if (found !== null)
                    stateCorrupt("Operation ID is duplicated across profiles.");
                found = candidate;
            }
        }
        return found;
    }
    async writeOperation(operation) {
        await this.ensureDirectory(join("operations", operation.profileHash));
        await this.writeJson(join("operations", operation.profileHash, `${operation.operationId}.json`), operation);
    }
    async listOperations(profileHash) {
        const directory = join("operations", profileHash);
        await this.ensureDirectory(directory);
        const entries = await readdir(this.resolveRelative(directory), { withFileTypes: true });
        const operations = [];
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
                stateSecurity("Operations directory contains an unsafe entry.");
            }
            const value = await this.readJson(join(directory, entry.name));
            if (value === null)
                stateCorrupt("Operation disappeared during validation.");
            operations.push(validateOperation(value));
        }
        return operations;
    }
    async listAllOperations() {
        const profiles = await this.operationProfiles("operations");
        const operations = [];
        for (const profileHash of profiles)
            operations.push(...await this.listOperations(profileHash));
        return operations;
    }
    async loadX402Operation(profileHash, operationId) {
        stateIdentifier(profileHash, "x402 profile hash");
        stateIdentifier(operationId, "x402 operation ID");
        const value = await this.readJson(join("x402-operations", profileHash, `${operationId}.json`));
        if (value === null)
            return null;
        const operation = validateX402Operation(value);
        if (operation.profileHash !== profileHash || operation.operationId !== operationId) {
            stateCorrupt("x402 operation path binding is invalid.");
        }
        await this.validateX402TerminalGraph(operation);
        return operation;
    }
    async findX402Operation(operationId) {
        stateIdentifier(operationId, "x402 operation ID");
        const profiles = await this.operationProfiles("x402-operations");
        let found = null;
        for (const profileHash of profiles) {
            const candidate = await this.loadX402Operation(profileHash, operationId);
            if (candidate !== null) {
                if (found !== null)
                    stateCorrupt("x402 operation ID is duplicated across profiles.");
                found = candidate;
            }
        }
        return found;
    }
    async writeX402Operation(operation) {
        validateX402Operation(operation);
        stateIdentifier(operation.profileHash, "x402 profile hash");
        stateIdentifier(operation.operationId, "x402 operation ID");
        const previous = await this.loadX402Operation(operation.profileHash, operation.operationId);
        if (previous !== null) {
            validateX402AppendOnly(previous, operation);
            validateX402ScanContinuity(previous, operation);
        }
        await this.validateX402TerminalGraph(operation);
        await this.ensureDirectory(join("x402-operations", operation.profileHash));
        await this.writeJson(join("x402-operations", operation.profileHash, `${operation.operationId}.json`), operation);
    }
    async listX402Operations(profileHash) {
        stateIdentifier(profileHash, "x402 profile hash");
        const directory = join("x402-operations", profileHash);
        await this.ensureDirectory(directory);
        const entries = await readdir(this.resolveRelative(directory), { withFileTypes: true });
        const operations = [];
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
                stateSecurity("x402 operations directory contains an unsafe entry.");
            }
            const value = await this.readJson(join(directory, entry.name));
            if (value === null)
                stateCorrupt("x402 operation disappeared during validation.");
            const operation = validateX402Operation(value);
            const operationId = entry.name.slice(0, -".json".length);
            if (operation.profileHash !== profileHash || operation.operationId !== operationId) {
                stateCorrupt("x402 operation path binding is invalid.");
            }
            await this.validateX402TerminalGraph(operation);
            operations.push(operation);
        }
        return operations;
    }
    async listAllX402Operations() {
        const profiles = await this.operationProfiles("x402-operations");
        const operations = [];
        for (const profileHash of profiles)
            operations.push(...await this.listX402Operations(profileHash));
        return operations;
    }
    async loadX402Result(profileHash, operationId) {
        stateIdentifier(profileHash, "x402 profile hash");
        stateIdentifier(operationId, "x402 operation ID");
        const operation = await this.findX402Operation(operationId);
        if (operation === null || operation.resultLink === undefined)
            return null;
        if (operation.profileHash !== profileHash)
            stateCorrupt("x402 result profile does not bind its authoritative operation.");
        const value = await this.readJson(join("x402-results", profileHash, `${operationId}.json`));
        if (value === null)
            return null;
        const result = validateX402Result(value);
        if (result.operationId !== operationId)
            stateCorrupt("x402 result path binding is invalid.");
        return result;
    }
    /** Exact-path crash recovery only; ordinary result readers intentionally hide unlinked artifacts. */
    async loadX402RecoveryResult(profileHash, operationId) {
        stateIdentifier(profileHash, "x402 profile hash");
        stateIdentifier(operationId, "x402 operation ID");
        const operation = await this.loadX402Operation(profileHash, operationId);
        if (operation === null || operation.terminal || operation.resultLink !== undefined)
            return null;
        const value = await this.readJson(join("x402-results", profileHash, `${operationId}.json`));
        if (value === null)
            return null;
        const result = validateX402Result(value);
        if (result.operationId !== operationId)
            stateCorrupt("x402 recovery result path binding is invalid.");
        return result;
    }
    async findX402Result(operationId) {
        stateIdentifier(operationId, "x402 operation ID");
        const profiles = await this.operationProfiles("x402-results");
        let found = null;
        for (const profileHash of profiles) {
            const candidate = await this.loadX402Result(profileHash, operationId);
            if (candidate !== null) {
                if (found !== null)
                    stateCorrupt("x402 result ID is duplicated across profiles.");
                found = candidate;
            }
        }
        return found;
    }
    async writeX402Result(profileHash, result) {
        stateIdentifier(profileHash, "x402 profile hash");
        stateIdentifier(result.operationId, "x402 operation ID");
        validateX402Result(result);
        const operation = await this.findX402Operation(result.operationId);
        if (operation === null)
            stateCorrupt("x402 result has no authoritative operation.");
        if (operation.profileHash !== profileHash)
            stateCorrupt("x402 result profile does not bind its authoritative operation.");
        if (operation.terminal)
            stateCorrupt("x402 result cannot overwrite a terminal operation graph.");
        if (operation.resultLink !== undefined)
            stateCorrupt("x402 result cannot overwrite a linked result graph.");
        await this.ensureDirectory(join("x402-results", profileHash));
        await this.writeJson(join("x402-results", profileHash, `${result.operationId}.json`), result);
    }
    async listX402Results(profileHash) {
        stateIdentifier(profileHash, "x402 profile hash");
        const directory = join("x402-results", profileHash);
        await this.ensureDirectory(directory);
        const entries = await readdir(this.resolveRelative(directory), { withFileTypes: true });
        const results = [];
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name))
                stateSecurity("x402 results directory contains an unsafe entry.");
            const operationId = entry.name.slice(0, -".json".length);
            const result = await this.loadX402Result(profileHash, operationId);
            if (result !== null)
                results.push(result);
        }
        return results;
    }
    async loadX402Receipt(profileHash, operationId) {
        stateIdentifier(profileHash, "x402 profile hash");
        stateIdentifier(operationId, "x402 operation ID");
        const operation = await this.findX402Operation(operationId);
        if (operation === null || !operation.terminal || operation.receiptLink === undefined)
            return null;
        if (operation.profileHash !== profileHash)
            stateCorrupt("x402 receipt profile does not bind its authoritative operation.");
        const value = await this.readJson(join("x402-receipts", profileHash, `${operationId}.json`));
        if (value === null)
            return null;
        const receipt = validateX402Receipt(value);
        if (receipt.operationId !== operationId)
            stateCorrupt("x402 receipt path binding is invalid.");
        return receipt;
    }
    /** Exact-path crash recovery only; ordinary receipt readers intentionally hide unlinked artifacts. */
    async loadX402RecoveryReceipt(profileHash, operationId) {
        stateIdentifier(profileHash, "x402 profile hash");
        stateIdentifier(operationId, "x402 operation ID");
        const operation = await this.loadX402Operation(profileHash, operationId);
        if (operation === null || operation.terminal || operation.receiptLink !== undefined)
            return null;
        const value = await this.readJson(join("x402-receipts", profileHash, `${operationId}.json`));
        if (value === null)
            return null;
        const receipt = validateX402Receipt(value);
        if (receipt.operationId !== operationId)
            stateCorrupt("x402 recovery receipt path binding is invalid.");
        this.validateX402RecoveryReceiptAuthority(operation, receipt);
        if (receipt.result !== undefined) {
            const resultValue = await this.readJson(join("x402-results", profileHash, `${operationId}.json`));
            if (resultValue === null)
                stateCorrupt("x402 recovery receipt has a dangling result.");
            const result = validateX402Result(resultValue);
            if (result.operationId !== operationId || result.resultHash !== receipt.result.resultHash ||
                result.integrityHash !== receipt.result.resultIntegrityHash || result.mediaType !== receipt.result.mediaType ||
                result.byteLength !== receipt.result.byteLength)
                stateCorrupt("x402 recovery receipt result binding is invalid.");
        }
        return receipt;
    }
    async findX402Receipt(operationId) {
        stateIdentifier(operationId, "x402 operation ID");
        const profiles = await this.operationProfiles("x402-receipts");
        let found = null;
        for (const profileHash of profiles) {
            const candidate = await this.loadX402Receipt(profileHash, operationId);
            if (candidate !== null) {
                if (found !== null)
                    stateCorrupt("x402 receipt ID is duplicated across profiles.");
                found = candidate;
            }
        }
        return found;
    }
    async writeX402Receipt(profileHash, receipt) {
        stateIdentifier(profileHash, "x402 profile hash");
        stateIdentifier(receipt.operationId, "x402 operation ID");
        validateX402Receipt(receipt);
        const operation = await this.findX402Operation(receipt.operationId);
        if (operation === null)
            stateCorrupt("x402 receipt has no authoritative operation.");
        if (operation.profileHash !== profileHash)
            stateCorrupt("x402 receipt profile does not bind its authoritative operation.");
        if (operation.terminal)
            stateCorrupt("x402 receipt cannot overwrite a terminal operation graph.");
        this.validateX402RecoveryReceiptAuthority(operation, receipt);
        await this.ensureDirectory(join("x402-receipts", profileHash));
        await this.writeJson(join("x402-receipts", profileHash, `${receipt.operationId}.json`), receipt);
    }
    async listX402Receipts(profileHash) {
        stateIdentifier(profileHash, "x402 profile hash");
        const directory = join("x402-receipts", profileHash);
        await this.ensureDirectory(directory);
        const entries = await readdir(this.resolveRelative(directory), { withFileTypes: true });
        const receipts = [];
        for (const entry of entries) {
            if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/.test(entry.name))
                stateSecurity("x402 receipts directory contains an unsafe entry.");
            const operationId = entry.name.slice(0, -".json".length);
            const receipt = await this.loadX402Receipt(profileHash, operationId);
            if (receipt !== null)
                receipts.push(receipt);
        }
        return receipts;
    }
    async loadReceipt(profileHash, operationId) {
        const value = await this.readJson(join("receipts", profileHash, `${operationId}.json`));
        return value === null ? null : validateReceipt(value);
    }
    async writeReceipt(profileHash, receipt) {
        await this.ensureDirectory(join("receipts", profileHash));
        await this.writeJson(join("receipts", profileHash, `${receipt.operationId}.json`), receipt);
    }
    async withLocks(keys, action) {
        const held = [];
        try {
            for (const key of [...new Set(keys)].sort(compareLockKeys)) {
                await this.beforeLockAcquire(key);
                held.push(await this.acquireLock(key));
            }
            return await action();
        }
        finally {
            for (const lock of held.reverse())
                await this.releaseLock(lock);
        }
    }
    async beforeLockAcquire(_key) { }
    async validateX402TerminalGraph(operation) {
        let linkedResult;
        if (operation.resultLink !== undefined) {
            const resultValue = await this.readJson(join("x402-results", operation.profileHash, `${operation.operationId}.json`));
            if (resultValue === null)
                stateCorrupt("x402 operation has a dangling result link.");
            const result = validateX402Result(resultValue);
            linkedResult = result;
            const response = operation.settlementResponseObservation;
            const attemptIndex = Number(response?.httpAttemptNumber ?? "0") - 1;
            const attempt = Number.isSafeInteger(attemptIndex) && attemptIndex >= 0
                ? operation.attempts[attemptIndex]
                : undefined;
            if (linkedResult.operationId !== operation.operationId || linkedResult.integrityHash !== operation.resultLink.resultIntegrityHash ||
                linkedResult.resultHash !== operation.resultLink.resultHash || response?.classification !== "success" ||
                attempt?.phase !== "observed" || attempt.observation?.status !== "200" ||
                attempt.observation.bodyHash !== result.resultHash || attempt.observation.bodyByteLength !== result.byteLength ||
                attempt.observation.mediaType !== result.mediaType)
                stateCorrupt("x402 linked result graph is inconsistent.");
        }
        if (!operation.terminal)
            return;
        const receiptValue = await this.readJson(join("x402-receipts", operation.profileHash, `${operation.operationId}.json`));
        if (receiptValue === null)
            stateCorrupt("Terminal x402 operation has no durable receipt.");
        const receipt = validateX402Receipt(receiptValue);
        if (receipt.operationId !== operation.operationId || receipt.integrityHash !== operation.receiptLink?.receiptIntegrityHash ||
            receipt.terminalState !== operation.state || receipt.reason !== operation.reason || receipt.proofClass !== operation.proofClass ||
            receipt.resource.origin !== operation.resource.origin || receipt.resource.path !== operation.resource.path ||
            receipt.resource.urlHash !== operation.resource.urlHash || receipt.fingerprint !== operation.fingerprint ||
            receipt.offerHash !== operation.selectedOffer.offerHash || receipt.payer !== operation.wallet || receipt.payee !== operation.payee ||
            receipt.amountAtomic !== operation.amountAtomic || receipt.network !== operation.network || receipt.token !== operation.token ||
            receipt.paymentIdentifier !== operation.paymentIdentifier?.value ||
            receipt.operationBindingHash !== x402OperationBindingHash(operation) || receipt.createdAt !== operation.updatedAt ||
            receipt.previousLinkHash !== operation.transitions.at(-1)?.previousHash ||
            receipt.settlementResponseHash !== operation.settlementResponseObservation?.settlementResponseHash ||
            !sameOptionalCanonical(receipt.settlementEvidence, operation.settlementEvidence) ||
            !sameOptionalCanonical(receipt.unusedExpiryEvidence, operation.unusedExpiryEvidence))
            stateCorrupt("Terminal x402 receipt does not bind the protected operation.");
        if (operation.resultLink === undefined) {
            if (receipt.result !== undefined)
                stateCorrupt("Terminal x402 receipt has an unexpected result link.");
            return;
        }
        const result = linkedResult;
        if (result === undefined)
            stateCorrupt("Terminal x402 operation has a dangling result link.");
        const responseAttemptNumber = Number(operation.settlementResponseObservation?.httpAttemptNumber ?? "0");
        const responseObservation = operation.attempts[responseAttemptNumber - 1]?.observation;
        if (result.operationId !== operation.operationId || result.integrityHash !== operation.resultLink.resultIntegrityHash ||
            result.resultHash !== operation.resultLink.resultHash || receipt.result === undefined ||
            receipt.result.resultHash !== result.resultHash || receipt.result.resultIntegrityHash !== result.integrityHash ||
            receipt.result.mediaType !== result.mediaType || receipt.result.byteLength !== result.byteLength ||
            responseObservation?.bodyHash !== result.resultHash || responseObservation.bodyByteLength !== result.byteLength ||
            responseObservation.mediaType !== result.mediaType)
            stateCorrupt("Terminal x402 result graph is inconsistent.");
    }
    validateX402RecoveryReceiptAuthority(operation, receipt) {
        if (receipt.operationId !== operation.operationId ||
            receipt.resource.origin !== operation.resource.origin || receipt.resource.path !== operation.resource.path ||
            receipt.resource.urlHash !== operation.resource.urlHash || receipt.fingerprint !== operation.fingerprint ||
            receipt.offerHash !== operation.selectedOffer.offerHash || receipt.payer !== operation.wallet || receipt.payee !== operation.payee ||
            receipt.amountAtomic !== operation.amountAtomic || receipt.network !== operation.network || receipt.token !== operation.token ||
            receipt.paymentIdentifier !== operation.paymentIdentifier?.value ||
            receipt.operationBindingHash !== x402OperationBindingHash(operation) ||
            receipt.previousLinkHash !== operation.transitions.at(-1)?.hash ||
            receipt.settlementResponseHash !== operation.settlementResponseObservation?.settlementResponseHash ||
            !sameOptionalCanonical(receipt.settlementEvidence, operation.settlementEvidence) ||
            !sameOptionalCanonical(receipt.unusedExpiryEvidence, operation.unusedExpiryEvidence))
            stateCorrupt("x402 recovery receipt does not bind its authoritative operation.");
    }
    async operationProfiles(rootName) {
        const entries = await readdir(this.resolveRelative(rootName), { withFileTypes: true });
        const profiles = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name)) {
                stateSecurity(`${rootName} root contains an unsafe profile entry.`);
            }
            profiles.push(entry.name);
        }
        return profiles.sort();
    }
    async ensureDirectory(relativePath) {
        const target = this.resolveRelative(relativePath);
        const parent = dirname(target);
        if (target !== this.root && parent !== this.root) {
            const parentRelative = relative(this.root, parent);
            if (parentRelative.length > 0)
                await this.ensureDirectory(parentRelative);
        }
        await this.assertNoSymlinkAncestors(target);
        try {
            await mkdir(target, { mode: DIRECTORY_MODE });
        }
        catch (error) {
            if (!isCode(error, "EEXIST"))
                throw error;
        }
        validateDirectory(await lstat(target), target === this.root);
    }
    resolveRelative(relativePath) {
        if (relativePath === "" || isAbsolute(relativePath))
            stateSecurity("State path must be relative.");
        const target = resolve(this.root, relativePath);
        if (!target.startsWith(`${this.root}${sep}`))
            stateSecurity("State path escapes the state root.");
        return target;
    }
    async assertNoSymlinkAncestors(target) {
        const rootPath = parse(target).root;
        const components = target.slice(rootPath.length).split(sep).filter(Boolean);
        let current = rootPath;
        for (const component of components) {
            current = join(current, component);
            try {
                const info = await lstat(current);
                if (info.isSymbolicLink())
                    stateSecurity("State path traverses a symbolic link.");
            }
            catch (error) {
                if (isCode(error, "ENOENT"))
                    return;
                throw error;
            }
        }
    }
    async readJson(relativePath) {
        const target = this.resolveRelative(relativePath);
        const parent = dirname(target);
        await this.assertNoSymlinkAncestors(target);
        let parentBefore;
        try {
            parentBefore = await stat(parent);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                return null;
            throw error;
        }
        validateDirectory(parentBefore, parent === this.root);
        let handle;
        try {
            handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                return null;
            if (isCode(error, "ELOOP"))
                stateSecurity("State file is a symbolic link.");
            throw error;
        }
        try {
            const info = await handle.stat();
            validateFile(info);
            const parentAfter = await stat(parent);
            if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) {
                stateSecurity("State parent changed during a protected read.");
            }
            if (info.size > MAX_STATE_BYTES)
                stateCorrupt("State file exceeds the size limit.");
            const bytes = await handle.readFile();
            let text;
            try {
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            }
            catch {
                stateCorrupt("State file is not strict UTF-8.");
            }
            let value;
            try {
                value = JSON.parse(text);
            }
            catch {
                stateCorrupt("State file is not valid JSON.");
            }
            const canonical = canonicalJson(value);
            if (text !== canonical && text !== `${canonical}\n`)
                stateCorrupt("State file is not canonical JSON.");
            return value;
        }
        finally {
            await handle.close();
        }
    }
    async writeJson(relativePath, value) {
        const target = this.resolveRelative(relativePath);
        const parent = dirname(target);
        const serialized = `${canonicalJson(value)}\n`;
        if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES)
            stateCorrupt("State file exceeds the size limit.");
        await this.assertNoSymlinkAncestors(target);
        validateDirectory(await lstat(parent), parent === this.root);
        const parentBefore = await stat(parent);
        let targetBefore = null;
        try {
            targetBefore = await lstat(target);
            validateFile(targetBefore);
        }
        catch (error) {
            if (!isCode(error, "ENOENT"))
                throw error;
        }
        const temporary = join(parent, `.${sha256(target).slice(0, 12)}.${randomBytes(12).toString("hex")}.tmp`);
        const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, FILE_MODE);
        let writeFailure;
        try {
            await handle.writeFile(serialized, { encoding: "utf8" });
            await handle.sync();
        }
        catch (error) {
            writeFailure = error;
        }
        finally {
            await handle.close();
        }
        if (writeFailure !== undefined) {
            await unlink(temporary).catch(() => undefined);
            throw writeFailure;
        }
        try {
            const parentAfter = await stat(parent);
            if (parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) {
                stateSecurity("State parent changed during an atomic write.");
            }
            if (targetBefore !== null) {
                const current = await lstat(target);
                if (current.dev !== targetBefore.dev || current.ino !== targetBefore.ino) {
                    stateSecurity("State target changed during an atomic write.");
                }
            }
            else {
                try {
                    await lstat(target);
                    stateSecurity("State target appeared during an atomic write.");
                }
                catch (error) {
                    if (!isCode(error, "ENOENT"))
                        throw error;
                }
            }
            await rename(temporary, target);
            const directory = await open(parent, constants.O_RDONLY);
            try {
                await directory.sync();
            }
            finally {
                await directory.close();
            }
            validateFile(await lstat(target));
        }
        catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }
    }
    async acquireLock(key) {
        const lockName = `${sha256(`lock\0${key}`)}.lock`;
        const path = this.resolveRelative(join("locks", lockName));
        const started = Date.now();
        do {
            let handle;
            try {
                handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, FILE_MODE);
            }
            catch (error) {
                if (isCode(error, "ELOOP"))
                    stateSecurity("State lock file is a symbolic link.");
                throw error;
            }
            try {
                await this.validateOpenedLock(path, handle);
                if (await this.lockPort.tryAcquire(handle.fd)) {
                    await this.validateOpenedLock(path, handle);
                    return { handle };
                }
            }
            catch (error) {
                await handle.close().catch(() => undefined);
                throw error;
            }
            await handle.close();
            const elapsed = Date.now() - started;
            if (elapsed >= this.lockWaitMs)
                break;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(10, this.lockWaitMs - elapsed)));
        } while (true);
        throw new ApnError("APN_STATE_BUSY", `State remained busy for ${this.lockWaitMs} milliseconds; retry the operation.`);
    }
    async validateOpenedLock(path, handle) {
        const opened = await handle.stat();
        let current;
        try {
            current = await lstat(path);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                stateSecurity("State lock file changed while it was open.");
            throw error;
        }
        if (current.dev !== opened.dev || current.ino !== opened.ino) {
            stateSecurity("State lock file changed while it was open.");
        }
        validateFile(opened);
        validateFile(current);
    }
    async releaseLock(lock) {
        await lock.handle.close();
    }
}
function isCode(error, code) {
    return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
function compareLockKeys(left, right) {
    const rank = (key) => key.startsWith("profile:") ? 0 : key.startsWith("operation:") ? 1 : 2;
    return rank(left) - rank(right) || left.localeCompare(right);
}
function validateX402AppendOnly(previous, next) {
    const immutableKeys = [
        "schemaVersion", "kind", "operationId", "idempotencyHash", "profile", "profileHash", "requestHash", "fingerprint",
        "resource", "sellerWire", "chainId", "network", "token", "wallet", "payee", "amountAtomic", "capAtomic",
        "selectedOffer", "preparedBlock", "paymentIdentifier", "authorization", "createdAt",
    ];
    for (const key of immutableKeys) {
        if (!sameOptionalCanonical(previous[key], next[key]))
            stateCorrupt(`x402 overwrite changed frozen member ${key}.`);
    }
    const freezeOnceKeys = [
        "signatureHash", "paymentPayloadHash", "paymentHeaderHash", "settlementResponseObservation", "transactionHint",
        "settlementEvidence", "unusedExpiryEvidence", "resultLink", "receiptLink",
    ];
    const recoveryObservationAdvance = isExactX402RecoveryObservationAdvance(previous, next);
    const scanReorgReset = isExactX402ScanReorgReset(previous, next);
    for (const key of freezeOnceKeys) {
        if (previous[key] !== undefined && !sameOptionalCanonical(previous[key], next[key])) {
            if (recoveryObservationAdvance && (key === "settlementResponseObservation" || key === "transactionHint"))
                continue;
            if (scanReorgReset && (key === "transactionHint" || key === "settlementEvidence"))
                continue;
            stateCorrupt(`x402 overwrite removed or replaced durable member ${key}.`);
        }
    }
    if (next.attempts.length < previous.attempts.length)
        stateCorrupt("x402 attempt history is not append-only.");
    for (let index = 0; index < previous.attempts.length; index += 1) {
        const prior = previous.attempts[index];
        const current = next.attempts[index];
        if (prior === undefined || current === undefined)
            stateCorrupt("x402 attempt history is not append-only.");
        if (canonicalJson(prior) === canonicalJson(current))
            continue;
        const pendingBody = {
            attemptNumber: prior.attemptNumber,
            purpose: prior.purpose,
            requestHeaderHash: prior.requestHeaderHash,
            persistedAt: prior.persistedAt,
        };
        const currentBody = {
            attemptNumber: current.attemptNumber,
            purpose: current.purpose,
            requestHeaderHash: current.requestHeaderHash,
            persistedAt: current.persistedAt,
        };
        if (prior.phase !== "pending" || (current.phase !== "observed" && current.phase !== "ambiguous") ||
            canonicalJson(pendingBody) !== canonicalJson(currentBody))
            stateCorrupt("x402 attempt history replaced a durable attempt.");
    }
    for (let index = previous.attempts.length; index < next.attempts.length; index += 1) {
        if (next.attempts[index]?.phase !== "pending") {
            stateCorrupt("A newly persisted x402 attempt must begin with an exact pending marker.");
        }
    }
    if (next.transitions.length < previous.transitions.length ||
        previous.transitions.some((item, index) => canonicalJson(item) !== canonicalJson(next.transitions[index])))
        stateCorrupt("x402 transition history is not append-only.");
    if (next.transitions.length > previous.transitions.length + 1) {
        stateCorrupt("x402 overwrite appended more than one durable transition.");
    }
}
function isExactX402RecoveryObservationAdvance(previous, next) {
    if (previous.state !== "seller_result_recovery_pending" || next.state !== "seller_result_recovery_pending" ||
        previous.resultLink !== undefined || next.resultLink !== undefined ||
        previous.receiptLink !== undefined || next.receiptLink !== undefined ||
        previous.paymentIdentifier === undefined || next.paymentIdentifier === undefined ||
        next.attempts.length !== previous.attempts.length ||
        next.transitions.length !== previous.transitions.length + 1 ||
        next.transitions.at(-1)?.state !== "seller_result_recovery_pending")
        return false;
    const response = next.settlementResponseObservation;
    const hint = next.transactionHint;
    if (response === undefined || hint?.source !== "payment_response")
        return false;
    if (hint.sourceBindingHash !== x402TransactionHintSourceBindingHash("payment_response", response.settlementResponseHash) ||
        hint.transactionHash !== next.settlementEvidence?.transactionHash)
        return false;
    const attemptIndex = Number(response.httpAttemptNumber) - 1;
    if (!Number.isSafeInteger(attemptIndex) || attemptIndex < 0 || attemptIndex !== previous.attempts.length - 1)
        return false;
    const priorAttempt = previous.attempts[attemptIndex];
    const currentAttempt = next.attempts[attemptIndex];
    if (priorAttempt?.purpose !== "result_recovery" || priorAttempt.phase !== "pending" ||
        currentAttempt?.purpose !== "result_recovery" || currentAttempt.phase !== "observed" ||
        currentAttempt.observation === undefined ||
        currentAttempt.observation.paymentResponseHeaderHash !== response.paymentResponseHeaderHash)
        return false;
    const pendingBody = {
        attemptNumber: priorAttempt.attemptNumber,
        purpose: priorAttempt.purpose,
        requestHeaderHash: priorAttempt.requestHeaderHash,
        persistedAt: priorAttempt.persistedAt,
    };
    const observedBody = {
        attemptNumber: currentAttempt.attemptNumber,
        purpose: currentAttempt.purpose,
        requestHeaderHash: currentAttempt.requestHeaderHash,
        persistedAt: currentAttempt.persistedAt,
    };
    if (canonicalJson(pendingBody) !== canonicalJson(observedBody))
        return false;
    const priorHint = previous.transactionHint;
    if (priorHint?.transactionHash !== hint.transactionHash)
        return false;
    if (priorHint.source === "authorization_used_log") {
        return previous.settlementResponseObservation === undefined;
    }
    const priorResponse = previous.settlementResponseObservation;
    return priorHint.source === "payment_response" && priorResponse !== undefined &&
        priorHint.sourceBindingHash === x402TransactionHintSourceBindingHash("payment_response", priorResponse.settlementResponseHash) &&
        Number(priorResponse.httpAttemptNumber) < Number(response.httpAttemptNumber);
}
function isExactX402ScanReorgReset(previous, next) {
    const priorScan = previous.authorizationUsedScan;
    const nextScan = next.authorizationUsedScan;
    if (priorScan === undefined || nextScan === undefined ||
        previous.transactionHint?.source !== "authorization_used_log" || next.transactionHint !== undefined ||
        next.settlementEvidence !== undefined ||
        !sameOptionalCanonical(previous.settlementResponseObservation, next.settlementResponseObservation) ||
        previous.unusedExpiryEvidence !== undefined || next.unusedExpiryEvidence !== undefined ||
        previous.resultLink !== undefined || next.resultLink !== undefined ||
        previous.receiptLink !== undefined || next.receiptLink !== undefined ||
        next.state !== "effect_unknown" || next.terminal ||
        next.attempts.length !== previous.attempts.length ||
        next.transitions.length !== previous.transitions.length + 1 ||
        next.transitions.at(-1)?.state !== "effect_unknown")
        return false;
    return nextScan.searchStartBlock === priorScan.searchStartBlock &&
        nextScan.nextFromBlock === nextScan.searchStartBlock &&
        nextScan.lastCompletedChunk === undefined && nextScan.candidates.length === 0 &&
        nextScan.status === "active";
}
function isExactX402ScanOnlyTransition(previous, next) {
    const { integrityHash: _previousIntegrityHash, authorizationUsedScan: _previousScan, updatedAt: _previousUpdatedAt, transitions: _previousTransitions, nextActions: _previousNextActions, ...previousBody } = previous;
    const { integrityHash: _nextIntegrityHash, authorizationUsedScan: _nextScan, updatedAt: _nextUpdatedAt, transitions: _nextTransitions, nextActions: _nextNextActions, ...nextBody } = next;
    const appendedSelfTransition = next.transitions.length === previous.transitions.length + 1 &&
        next.transitions.at(-1)?.state === previous.state &&
        next.transitions.at(-1)?.at === next.updatedAt;
    return canonicalJson(previousBody) === canonicalJson(nextBody) && appendedSelfTransition;
}
function isExactX402CompletedZeroScanExtension(previous, next) {
    const priorScan = previous.authorizationUsedScan;
    const nextScan = next.authorizationUsedScan;
    if (priorScan === undefined || nextScan === undefined ||
        priorScan.status !== "complete" || priorScan.candidates.length !== 0 || nextScan.status !== "active" ||
        previous.transactionHint !== undefined || previous.settlementEvidence !== undefined || previous.resultLink !== undefined ||
        !((previous.state === "effect_unknown" && (previous.attempts.some((attempt) => attempt.purpose === "payment") ||
            isZeroAttemptPreSendReorgLineage(previous))) ||
            (previous.state === "authorized_not_sent" && !previous.attempts.some((attempt) => attempt.purpose === "payment"))) ||
        !isExactX402ScanOnlyTransition(previous, next))
        return false;
    return nextScan.searchStartBlock === priorScan.searchStartBlock &&
        nextScan.nextFromBlock === priorScan.nextFromBlock &&
        sameOptionalCanonical(nextScan.lastCompletedChunk, priorScan.lastCompletedChunk) &&
        canonicalJson(nextScan.candidates) === canonicalJson(priorScan.candidates) &&
        BigInt(nextScan.targetSafeHead.number) > BigInt(priorScan.targetSafeHead.number);
}
function isZeroAttemptPreSendReorgLineage(operation) {
    return operation.state === "effect_unknown" && operation.attempts.length === 0 &&
        operation.transitions.at(-2)?.state === "effect_unknown" &&
        operation.transitions.at(-1)?.state === "effect_unknown";
}
function isExactX402UnavailableScanResume(previous, next) {
    const priorScan = previous.authorizationUsedScan;
    const nextScan = next.authorizationUsedScan;
    if (priorScan === undefined || nextScan === undefined || priorScan.status !== "unavailable" || nextScan.status !== "active" ||
        !isExactX402ScanOnlyTransition(previous, next))
        return false;
    return nextScan.searchStartBlock === priorScan.searchStartBlock &&
        nextScan.nextFromBlock === priorScan.nextFromBlock &&
        sameOptionalCanonical(nextScan.lastCompletedChunk, priorScan.lastCompletedChunk) &&
        canonicalJson(nextScan.candidates) === canonicalJson(priorScan.candidates) &&
        canonicalJson(nextScan.targetSafeHead) === canonicalJson(priorScan.targetSafeHead);
}
function validateX402ScanContinuity(previous, next) {
    const priorScan = previous.authorizationUsedScan;
    const nextScan = next.authorizationUsedScan;
    if (priorScan === undefined) {
        if (nextScan?.lastCompletedChunk !== undefined &&
            nextScan.lastCompletedChunk.fromBlock !== nextScan.searchStartBlock)
            stateCorrupt("The first x402 authorization-used chunk does not begin at the frozen search start.");
        return;
    }
    if (nextScan === undefined)
        stateCorrupt("x402 authorization-used scan cannot be silently discarded.");
    if (canonicalJson(nextScan) === canonicalJson(priorScan))
        return;
    const unavailableWithoutAdvance = nextScan.status === "unavailable" &&
        nextScan.nextFromBlock === priorScan.nextFromBlock &&
        sameOptionalCanonical(nextScan.lastCompletedChunk, priorScan.lastCompletedChunk) &&
        canonicalJson(nextScan.candidates) === canonicalJson(priorScan.candidates) &&
        canonicalJson(nextScan.targetSafeHead) === canonicalJson(priorScan.targetSafeHead) &&
        (priorScan.status !== "unavailable" || nextScan.unavailableReason === priorScan.unavailableReason) &&
        isExactX402ScanOnlyTransition(previous, next);
    if (unavailableWithoutAdvance)
        return;
    if (isExactX402UnavailableScanResume(previous, next) || isExactX402CompletedZeroScanExtension(previous, next))
        return;
    const reset = nextScan.nextFromBlock === nextScan.searchStartBlock &&
        nextScan.lastCompletedChunk === undefined && nextScan.candidates.length === 0 && nextScan.status === "active";
    if (nextScan.searchStartBlock !== priorScan.searchStartBlock ||
        (!reset && canonicalJson(nextScan.targetSafeHead) !== canonicalJson(priorScan.targetSafeHead)))
        stateCorrupt("x402 authorization-used scan provenance changed during continuation.");
    if (reset) {
        if (next.transitions.length !== previous.transitions.length + 1) {
            stateCorrupt("x402 authorization-used scan reset lacks its durable state transition.");
        }
        return;
    }
    if (nextScan.lastCompletedChunk !== undefined && nextScan.lastCompletedChunk.fromBlock !== priorScan.nextFromBlock) {
        stateCorrupt("x402 authorization-used scan skipped or repeated a cursor range.");
    }
    if (BigInt(nextScan.nextFromBlock) < BigInt(priorScan.nextFromBlock))
        stateCorrupt("x402 authorization-used scan cursor moved backward.");
    const nextCandidates = new Map(nextScan.candidates.map((candidate) => [
        `${candidate.blockHash}\0${candidate.transactionHash}\0${candidate.logIndex}`,
        canonicalJson(candidate),
    ]));
    for (const candidate of priorScan.candidates) {
        const key = `${candidate.blockHash}\0${candidate.transactionHash}\0${candidate.logIndex}`;
        if (nextCandidates.get(key) !== canonicalJson(candidate))
            stateCorrupt("x402 authorization-used scan discarded or changed a prior candidate.");
    }
    const priorCandidates = canonicalJson(priorScan.candidates);
    if (nextScan.status === "unavailable" && (nextScan.nextFromBlock !== priorScan.nextFromBlock || canonicalJson(nextScan.candidates) !== priorCandidates))
        stateCorrupt("Unavailable x402 authorization-used scan advanced or accepted new candidates.");
}
function sameOptionalCanonical(left, right) {
    if (left === undefined || right === undefined)
        return left === right;
    return canonicalJson(left) === canonicalJson(right);
}
//# sourceMappingURL=state.js.map