import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink, } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { canonicalJson, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { MacosAdvisoryLock } from "./macos-advisory-lock.js";
import { validateProviderProfile } from "./provider-profile.js";
import { validateOperation, validateReceipt, validateWallet } from "./state-integrity.js";
import { isCode, SecureStateStore, stateCorrupt, stateIdentifier, stateSecurity, validateDirectory, } from "./secure-state-store.js";
import { sameOptionalCanonical, validateX402AppendOnly, validateX402ScanContinuity, } from "./x402-state-continuity.js";
import { x402OperationBindingHash, x402TransactionHintSourceBindingHash, validateX402Operation, validateX402Receipt, validateX402Result, } from "./x402-state-integrity.js";
export { appendTransition, sealOperation, sealReceipt, sealWallet } from "./state-integrity.js";
export class StateStore extends SecureStateStore {
    async loadWallet(profileHash) {
        const value = await this.readJson(join("wallets", profileHash, "wallet.json"));
        return value === null ? null : validateWallet(value);
    }
    async loadWalletArtifacts(profile, profileHash) {
        stateIdentifier(profileHash, "profile hash");
        await this.assertNoSymlinkAncestors(this.root);
        let rootStats;
        try {
            rootStats = await lstat(this.root);
        }
        catch (error) {
            if (isCode(error, "ENOENT"))
                return { stored: null, encrypted: null };
            throw error;
        }
        validateDirectory(rootStats, true);
        if (await realpath(this.root) !== this.root)
            stateSecurity("State root resolves through an alias or symbolic link.");
        const [stored, encrypted] = await Promise.all([
            this.loadWallet(profileHash),
            this.loadEncryptedWalletEnvelope(profile),
        ]);
        return { stored, encrypted };
    }
    async writeWallet(wallet) {
        await this.ensureDirectory(join("wallets", wallet.profileHash));
        await this.writeJson(join("wallets", wallet.profileHash, "wallet.json"), wallet);
    }
    async loadProviderProfile(profileHash) {
        stateIdentifier(profileHash, "profile hash");
        const value = await this.readJson(join("profiles", profileHash, "profile.json"));
        if (value === null)
            return null;
        const profile = validateProviderProfile(value);
        if (profile.profile_hash !== profileHash)
            stateCorrupt("Provider profile path does not match its identity.");
        return profile;
    }
    async writeProviderProfile(profile) {
        validateProviderProfile(profile);
        await this.ensureDirectory(join("profiles", profile.profile_hash));
        await this.writeJson(join("profiles", profile.profile_hash, "profile.json"), profile);
    }
    async loadEncryptedWalletEnvelope(profile) {
        return await this.readJson(join("wallets", `${profile}.json`));
    }
    async writeEncryptedWalletEnvelope(profile, envelope) {
        await this.writeJson(join("wallets", `${profile}.json`), envelope);
    }
    async loadEncryptedPolicyEnvelope(profile) {
        return await this.readJson(join("policies", `${profile}.json`));
    }
    async writeEncryptedPolicyEnvelope(profile, envelope) {
        await this.writeJson(join("policies", `${profile}.json`), envelope);
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
}
//# sourceMappingURL=state.js.map