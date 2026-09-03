import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { keccak256 } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";
const RECORD_VERSION = "apn.metamask-smart-account-direct-effect.v1";
const ENVELOPE_VERSION = "apn.metamask-smart-account-direct-effect-envelope.v1";
export class EncryptedSmartAccountDirectEffectStore {
    wrappingSecret;
    files;
    constructor(state, wrappingSecret) {
        this.wrappingSecret = wrappingSecret;
        this.files = new EffectEnvelopeState(state.root);
    }
    async load(operationId) {
        const value = await this.files.load(operationId);
        if (value === null)
            return null;
        const envelope = parseEnvelope(value, operationId);
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            corrupt("The Smart Account effect wrapping secret is missing.");
        try {
            return decrypt(envelope, wrapping);
        }
        finally {
            wrapping.fill(0);
        }
    }
    async seal(record) {
        const sealed = validateRecord({ ...record, integrity_hash: hashObject(record) });
        const existing = await this.load(record.operation_id);
        if (existing !== null) {
            if (existing.integrity_hash !== sealed.integrity_hash) {
                throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Smart Account operation already has different sealed effect material.");
            }
            return existing;
        }
        await this.write(sealed);
        return sealed;
    }
    async transition(operationId, phase, submissionAttempts, updatedAt) {
        const current = await this.load(operationId);
        if (current === null)
            corrupt("The Smart Account sealed effect is missing.");
        if (!validTransition(current.phase, phase) || !Number.isSafeInteger(submissionAttempts) ||
            submissionAttempts < current.submission_attempts || submissionAttempts > 2 || !canonicalTimestamp(updatedAt)) {
            corrupt("The Smart Account effect transition is invalid.");
        }
        const { integrity_hash: _old, ...body } = current;
        const nextBody = { ...body, phase, submission_attempts: submissionAttempts, updated_at: updatedAt };
        const next = validateRecord({ ...nextBody, integrity_hash: hashObject(nextBody) });
        await this.write(next);
        return next;
    }
    async write(record) {
        const wrapping = await this.wrappingSecret.load() ?? await this.wrappingSecret.create();
        const salt = randomBytes(32);
        const nonce = randomBytes(12);
        const key = deriveKey(wrapping, salt, record.operation_id);
        const header = {
            schema_version: ENVELOPE_VERSION,
            operation_id: record.operation_id,
            kdf: { name: "HKDF-SHA-256", salt: salt.toString("base64") },
            cipher: { name: "AES-256-GCM", nonce: nonce.toString("base64") },
        };
        const plaintext = Buffer.from(canonicalJson(record), "utf8");
        try {
            const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
            cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
            const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            try {
                await this.files.write(record.operation_id, {
                    ...header,
                    cipher: {
                        ...header.cipher,
                        ciphertext: ciphertext.toString("base64"),
                        tag: cipher.getAuthTag().toString("base64"),
                    },
                });
            }
            finally {
                ciphertext.fill(0);
            }
        }
        finally {
            plaintext.fill(0);
            key.fill(0);
            salt.fill(0);
            nonce.fill(0);
            wrapping.fill(0);
        }
    }
}
class EffectEnvelopeState extends SecureStateStore {
    async load(operationId) {
        stateIdentifier(operationId, "Smart Account operation ID");
        return await this.readJson(join("smart-account-effects", `${operationId}.json`));
    }
    async write(operationId, value) {
        stateIdentifier(operationId, "Smart Account operation ID");
        await this.ensureDirectory("smart-account-effects");
        await this.writeJson(join("smart-account-effects", `${operationId}.json`), value);
    }
}
function decrypt(envelope, wrapping) {
    const salt = decodeBase64(envelope.kdf.salt, 32);
    const nonce = decodeBase64(envelope.cipher.nonce, 12);
    const ciphertext = decodeBase64(envelope.cipher.ciphertext);
    const tag = decodeBase64(envelope.cipher.tag, 16);
    const key = deriveKey(wrapping, salt, envelope.operation_id);
    let plaintext = Buffer.alloc(0);
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
        decipher.setAAD(Buffer.from(canonicalJson({
            schema_version: envelope.schema_version,
            operation_id: envelope.operation_id,
            kdf: envelope.kdf,
            cipher: { name: envelope.cipher.name, nonce: envelope.cipher.nonce },
        }), "utf8"));
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        const value = JSON.parse(text);
        if (canonicalJson(value) !== text)
            corrupt("Smart Account effect plaintext is not canonical.");
        return validateRecord(value);
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        corrupt("Smart Account effect authentication or decryption failed.");
    }
    finally {
        salt.fill(0);
        nonce.fill(0);
        ciphertext.fill(0);
        tag.fill(0);
        key.fill(0);
        plaintext.fill(0);
    }
}
function validateRecord(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schema_version", "operation_id", "profile_hash", "intent_fingerprint", "root_grant_fingerprint",
        "child_fingerprint", "owner_address", "session_address", "recipient", "amount_atomic", "delegation_manager",
        "child_context", "redemption_calldata", "raw_transaction", "transaction_hash", "nonce_atomic", "economics",
        "phase", "submission_attempts", "sealed_at", "updated_at", "integrity_hash",
    ]))
        corrupt("Smart Account effect record schema is invalid.");
    const record = value;
    const { integrity_hash: _hash, ...body } = record;
    if (record.schema_version !== RECORD_VERSION || !/^[a-f0-9]{64}$/u.test(record.operation_id) ||
        !/^[a-f0-9]{64}$/u.test(record.profile_hash) || !/^[a-f0-9]{64}$/u.test(record.intent_fingerprint) ||
        !/^[a-f0-9]{64}$/u.test(record.root_grant_fingerprint) || !/^[a-f0-9]{64}$/u.test(record.child_fingerprint) ||
        ![record.owner_address, record.session_address, record.recipient, record.delegation_manager]
            .every((item) => /^0x[0-9a-fA-F]{40}$/u.test(item)) ||
        !/^[1-9][0-9]*$/u.test(record.amount_atomic) || !/^(?:0|[1-9][0-9]*)$/u.test(record.nonce_atomic) ||
        ![record.child_context, record.redemption_calldata, record.raw_transaction]
            .every((item) => /^0x(?:[0-9a-fA-F]{2})+$/u.test(item)) ||
        !/^0x[0-9a-fA-F]{64}$/u.test(record.transaction_hash) ||
        record.transaction_hash.toLowerCase() !== keccak256(record.raw_transaction).toLowerCase() ||
        record.child_fingerprint !== sha256(`apn.smart-account.child\0${record.child_context}`) ||
        !["sealed", "submission_pending", "submission_ambiguous", "submitted"].includes(record.phase) ||
        !Number.isSafeInteger(record.submission_attempts) || record.submission_attempts < 0 || record.submission_attempts > 2 ||
        !canonicalTimestamp(record.sealed_at) || !canonicalTimestamp(record.updated_at) ||
        Date.parse(record.updated_at) < Date.parse(record.sealed_at) ||
        !validEconomics(record.economics) || record.integrity_hash !== hashObject(body))
        corrupt("Smart Account effect record integrity is invalid.");
    return record;
}
function validEconomics(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "maximumGasCostAtomic",
    ]))
        return false;
    if (![value.nonceAtomic, value.maxPriorityFeePerGasAtomic].every((item) => /^(?:0|[1-9][0-9]*)$/u.test(item)) ||
        ![value.gasLimitAtomic, value.maxFeePerGasAtomic, value.maximumGasCostAtomic].every((item) => /^[1-9][0-9]*$/u.test(item))) {
        return false;
    }
    return BigInt(value.maxPriorityFeePerGasAtomic) <= BigInt(value.maxFeePerGasAtomic) &&
        BigInt(value.maximumGasCostAtomic) === BigInt(value.gasLimitAtomic) * BigInt(value.maxFeePerGasAtomic);
}
function validTransition(from, to) {
    return from === to || (from === "sealed" && to === "submission_pending") ||
        (from === "submission_pending" && ["submission_ambiguous", "submitted"].includes(to)) ||
        (from === "submission_ambiguous" && ["submission_pending", "submitted"].includes(to));
}
function parseEnvelope(value, operationId) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schema_version", "operation_id", "kdf", "cipher"]) ||
        value.schema_version !== ENVELOPE_VERSION || value.operation_id !== operationId ||
        !isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) ||
        value.kdf.name !== "HKDF-SHA-256" || typeof value.kdf.salt !== "string" ||
        !isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) ||
        value.cipher.name !== "AES-256-GCM" || typeof value.cipher.nonce !== "string" ||
        typeof value.cipher.ciphertext !== "string" || typeof value.cipher.tag !== "string")
        corrupt("Smart Account effect envelope is invalid.");
    return value;
}
function deriveKey(wrapping, salt, operationId) {
    return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${ENVELOPE_VERSION}\0${operationId}`), 32));
}
function decodeBase64(value, length) {
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value || decoded.length === 0 || (length !== undefined && decoded.length !== length)) {
        decoded.fill(0);
        corrupt("Smart Account effect envelope encoding is invalid.");
    }
    return decoded;
}
function canonicalTimestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=encrypted-smart-account-direct-effect-store.js.map