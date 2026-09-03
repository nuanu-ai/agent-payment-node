import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { decodeDelegations, encodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";
import { decodePaymentSignatureHeader } from "./x402-codec.js";
import { isStrictErc7710Payload } from "./x402-erc7710-codec.js";
const RECORD_VERSION = "apn.metamask-smart-account-x402-material.v1";
const ENVELOPE_VERSION = "apn.metamask-smart-account-x402-material-envelope.v1";
export class EncryptedSmartAccountX402MaterialStore {
    wrappingSecret;
    files;
    constructor(state, wrappingSecret) {
        this.wrappingSecret = wrappingSecret;
        this.files = new MaterialEnvelopeState(state.root);
    }
    async load(operationId) {
        const value = await this.files.load(operationId);
        if (value === null)
            return null;
        const envelope = parseEnvelope(value, operationId);
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            corrupt("The Smart Account x402 wrapping secret is missing.");
        try {
            return decrypt(envelope, wrapping);
        }
        finally {
            wrapping.fill(0);
        }
    }
    async seal(record) {
        const identity = materialIdentity(record);
        const body = { ...record, material_identity_hash: identity };
        const sealed = validateRecord({ ...body, integrity_hash: hashObject(body) });
        const existing = await this.load(record.operation_id);
        if (existing !== null) {
            if (existing.material_identity_hash !== identity) {
                throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "The x402 operation already has different sealed delegated payment material.");
            }
            return existing;
        }
        await this.write(sealed);
        return sealed;
    }
    async markExposed(operationId, updatedAt) {
        const current = await this.load(operationId);
        if (current === null)
            corrupt("The sealed Smart Account x402 material is missing.");
        if (current.phase === "exposed")
            return current;
        if (!canonicalTimestamp(updatedAt) || Date.parse(updatedAt) < Date.parse(current.sealed_at)) {
            corrupt("The Smart Account x402 exposure transition is invalid.");
        }
        const { integrity_hash: _integrity, ...body } = current;
        const nextBody = { ...body, phase: "exposed", updated_at: updatedAt };
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
class MaterialEnvelopeState extends SecureStateStore {
    async load(operationId) {
        stateIdentifier(operationId, "Smart Account x402 operation ID");
        return await this.readJson(join("smart-account-x402-materials", `${operationId}.json`));
    }
    async write(operationId, value) {
        stateIdentifier(operationId, "Smart Account x402 operation ID");
        await this.ensureDirectory("smart-account-x402-materials");
        await this.writeJson(join("smart-account-x402-materials", `${operationId}.json`), value);
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
            corrupt("Smart Account x402 material plaintext is not canonical.");
        return validateRecord(value);
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        corrupt("Smart Account x402 material authentication or decryption failed.");
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
        "schema_version", "operation_id", "profile_hash", "fingerprint", "request_hash", "offer_hash",
        "root_grant_fingerprint", "child_hash", "permission_context_hash", "payment_payload_hash",
        "payment_header_hash", "material_identity_hash", "delegation_manager", "delegator",
        "child_permission_context", "payment_payload_canonical_json", "payment_header",
        "effective_expiry_unix", "phase", "sealed_at", "updated_at", "integrity_hash",
    ]))
        corrupt("Smart Account x402 material record schema is invalid.");
    const record = value;
    const { integrity_hash: _integrity, ...body } = record;
    if (record.schema_version !== RECORD_VERSION || !hashes(record.operation_id, record.profile_hash, record.fingerprint, record.request_hash, record.offer_hash, record.root_grant_fingerprint, record.child_hash, record.permission_context_hash, record.payment_payload_hash, record.payment_header_hash, record.material_identity_hash, record.integrity_hash) ||
        !addresses(record.delegation_manager, record.delegator) ||
        !/^0x(?:[0-9a-fA-F]{2})+$/u.test(record.child_permission_context) ||
        !/^[1-9][0-9]*$/u.test(record.effective_expiry_unix) ||
        (record.phase !== "sealed" && record.phase !== "exposed") ||
        !canonicalTimestamp(record.sealed_at) || !canonicalTimestamp(record.updated_at) ||
        Date.parse(record.updated_at) < Date.parse(record.sealed_at) ||
        record.permission_context_hash !== domainHash("apn.x402.erc7710.permission-context.v1", record.child_permission_context) ||
        record.payment_payload_hash !== domainHash("apn.x402.payment-payload.v1", record.payment_payload_canonical_json) ||
        record.payment_header_hash !== domainHash("apn.x402.payment-header.v1", Buffer.from(record.payment_header, "ascii")) ||
        record.material_identity_hash !== materialIdentity(record) || record.integrity_hash !== hashObject(body))
        corrupt("Smart Account x402 material record integrity is invalid.");
    let payload;
    try {
        payload = JSON.parse(record.payment_payload_canonical_json);
    }
    catch {
        corrupt("Smart Account x402 payment payload is not JSON.");
    }
    const decoded = decodePaymentSignatureHeader(record.payment_header);
    if (canonicalJson(payload) !== record.payment_payload_canonical_json || canonicalJson(decoded) !== record.payment_payload_canonical_json ||
        !isStrictErc7710Payload(decoded.payload) || decoded.payload.permissionContext.toLowerCase() !== record.child_permission_context.toLowerCase() ||
        decoded.payload.delegationManager.toLowerCase() !== record.delegation_manager.toLowerCase() ||
        decoded.payload.delegator.toLowerCase() !== record.delegator.toLowerCase()) {
        corrupt("Smart Account x402 payment header does not bind its canonical payload.");
    }
    let child;
    try {
        child = decodeDelegations(record.child_permission_context)[0];
    }
    catch {
        corrupt("Smart Account x402 child permission context is invalid.");
    }
    if (child === undefined || record.child_hash !== domainHash("apn.x402.erc7710.child.v1", encodeDelegations([child])))
        corrupt("Smart Account x402 child hash is invalid.");
    return record;
}
function materialIdentity(value) {
    return hashObject({
        operation_id: value.operation_id,
        profile_hash: value.profile_hash,
        fingerprint: value.fingerprint,
        request_hash: value.request_hash,
        offer_hash: value.offer_hash,
        root_grant_fingerprint: value.root_grant_fingerprint,
        child_hash: value.child_hash,
        permission_context_hash: value.permission_context_hash,
        payment_payload_hash: value.payment_payload_hash,
        payment_header_hash: value.payment_header_hash,
        delegation_manager: value.delegation_manager,
        delegator: value.delegator,
        child_permission_context: value.child_permission_context,
        payment_payload_canonical_json: value.payment_payload_canonical_json,
        payment_header: value.payment_header,
        effective_expiry_unix: value.effective_expiry_unix,
        sealed_at: value.sealed_at,
    });
}
function parseEnvelope(value, operationId) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schema_version", "operation_id", "kdf", "cipher"]) ||
        value.schema_version !== ENVELOPE_VERSION || value.operation_id !== operationId ||
        !isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) || value.kdf.name !== "HKDF-SHA-256" ||
        typeof value.kdf.salt !== "string" || !isPlainRecord(value.cipher) ||
        !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) || value.cipher.name !== "AES-256-GCM" ||
        typeof value.cipher.nonce !== "string" || typeof value.cipher.ciphertext !== "string" || typeof value.cipher.tag !== "string") {
        corrupt("Smart Account x402 material envelope is invalid.");
    }
    return value;
}
function deriveKey(wrapping, salt, operationId) {
    return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${ENVELOPE_VERSION}\0${operationId}`), 32));
}
function decodeBase64(value, length) {
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value || decoded.length === 0 || (length !== undefined && decoded.length !== length)) {
        decoded.fill(0);
        corrupt("Smart Account x402 material envelope encoding is invalid.");
    }
    return decoded;
}
function hashes(...values) { return values.every((value) => /^[a-f0-9]{64}$/u.test(value)); }
function addresses(...values) { return values.every((value) => /^0x[0-9a-fA-F]{40}$/u.test(value)); }
function canonicalTimestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=encrypted-smart-account-x402-material-store.js.map