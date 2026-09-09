import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { validateGaslessMaterial } from "./material-validation.js";
import { gaslessExact, gaslessFailure, gaslessHash, gaslessSame } from "./validation.js";
const VERSION = "apn.gasless-effect-envelope.v1";
export class GaslessEffectStore extends SecureStateStore {
    wrappingSecret;
    constructor(root, wrappingSecret) {
        super(root);
        this.wrappingSecret = wrappingSecret;
    }
    async load(operation, role) {
        const raw = await this.readJson(this.path(operation, role));
        if (raw === null)
            return null;
        const envelope = parseEnvelope(raw, operation, role);
        const value = await this.decrypt(envelope);
        const original = role === "user_operation" ? await this.load(operation, "bootstrap") : undefined;
        if (role === "user_operation" && original?.role !== "bootstrap")
            corrupt("gasless_bootstrap_seal_missing");
        return await validateGaslessMaterial(value, operation, role, original);
    }
    async seal(operation, material) {
        const original = material.role === "user_operation" ? await this.load(operation, "bootstrap") : undefined;
        if (material.role === "user_operation" && original?.role !== "bootstrap")
            corrupt("gasless_bootstrap_seal_missing");
        const valid = await validateGaslessMaterial(material, operation, material.role, original);
        const existing = await this.load(operation, material.role);
        if (existing !== null) {
            if (!gaslessSame(existing, valid))
                corrupt("gasless_effect_already_sealed");
            return existing;
        }
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            unavailable("gasless_wrapping_secret_missing");
        const salt = randomBytes(32), nonce = randomBytes(12);
        const header = headerFor(operation, valid, salt, nonce);
        const key = deriveKey(wrapping, salt, header);
        const plaintext = Buffer.from(canonicalJson(valid), "utf8");
        let ciphertext = Buffer.alloc(0);
        try {
            const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
            cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
            ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            await this.initialize();
            await this.ensureDirectory(`gasless-effects/${operation.profileHash}`);
            await this.writeJson(this.path(operation, material.role), {
                ...header,
                cipher: {
                    ...header.cipher,
                    ciphertext: ciphertext.toString("base64"),
                    tag: cipher.getAuthTag().toString("base64"),
                },
            });
            return valid;
        }
        finally {
            wrapping.fill(0);
            salt.fill(0);
            nonce.fill(0);
            key.fill(0);
            plaintext.fill(0);
            ciphertext.fill(0);
        }
    }
    async decrypt(envelope) {
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            unavailable("gasless_wrapping_secret_missing");
        const salt = base64(envelope.kdf.salt, 32), nonce = base64(envelope.cipher.nonce, 12);
        const tag = base64(envelope.cipher.tag, 16), ciphertext = base64(envelope.cipher.ciphertext);
        const key = deriveKey(wrapping, salt, headerOf(envelope));
        let plaintext = Buffer.alloc(0);
        try {
            const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
            decipher.setAAD(Buffer.from(canonicalJson(headerOf(envelope)), "utf8"));
            decipher.setAuthTag(tag);
            plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
            const value = JSON.parse(text);
            if (canonicalJson(value) !== text)
                corrupt("gasless_effect_canonical_plaintext");
            return value;
        }
        catch (error) {
            if (error instanceof ApnError)
                throw error;
            return unavailable("gasless_effect_authentication");
        }
        finally {
            wrapping.fill(0);
            salt.fill(0);
            nonce.fill(0);
            tag.fill(0);
            ciphertext.fill(0);
            key.fill(0);
            plaintext.fill(0);
        }
    }
    path(operation, role) {
        stateIdentifier(operation.profileHash, "gasless effect profile");
        stateIdentifier(operation.operationId, "gasless effect operation");
        if (role !== "bootstrap" && role !== "user_operation")
            corrupt("gasless_effect_role");
        return `gasless-effects/${operation.profileHash}/${operation.operationId}-${role}.json`;
    }
}
function headerFor(operation, material, salt, nonce) {
    const final = material.role === "user_operation" ? material : null;
    return {
        schemaVersion: VERSION,
        profileHash: operation.profileHash,
        operationId: operation.operationId,
        fingerprint: operation.fingerprint,
        role: material.role,
        envelopeHash: operation.intent.unsignedEnvelopeHash,
        bootstrapMaterialHash: final?.bootstrapMaterialHash ?? null,
        estimateHash: final?.estimateHash ?? null,
        kdf: { name: "HKDF-SHA-256", salt: salt.toString("base64") },
        cipher: { name: "AES-256-GCM", nonce: nonce.toString("base64") },
    };
}
function parseEnvelope(value, operation, role) {
    const record = gaslessExact(value, [
        "schemaVersion", "profileHash", "operationId", "fingerprint", "role", "envelopeHash",
        "bootstrapMaterialHash", "estimateHash", "kdf", "cipher",
    ]);
    const kdf = gaslessExact(record.kdf, ["name", "salt"]);
    const cipher = gaslessExact(record.cipher, ["name", "nonce", "ciphertext", "tag"]);
    const bootstrapHash = role === "user_operation" ? operation.bootstrap.materialHash : null;
    const estimateHash = role === "user_operation" && operation.bootstrap.estimate !== null
        ? hashObject(operation.bootstrap.estimate) : null;
    if (record.schemaVersion !== VERSION || record.profileHash !== operation.profileHash ||
        record.operationId !== operation.operationId || record.fingerprint !== operation.fingerprint ||
        record.role !== role || record.envelopeHash !== operation.intent.unsignedEnvelopeHash ||
        record.bootstrapMaterialHash !== bootstrapHash || record.estimateHash !== estimateHash ||
        kdf.name !== "HKDF-SHA-256" || cipher.name !== "AES-256-GCM" ||
        [kdf.salt, cipher.nonce, cipher.ciphertext, cipher.tag].some((item) => typeof item !== "string")) {
        corrupt("gasless_effect_envelope");
    }
    gaslessHash(record.profileHash);
    gaslessHash(record.operationId);
    gaslessHash(record.fingerprint);
    gaslessHash(record.envelopeHash);
    if (role === "user_operation" && (bootstrapHash === null || estimateHash === null)) {
        corrupt("gasless_final_effect_prerequisite");
    }
    return record;
}
function headerOf(envelope) {
    return { ...envelope, cipher: { name: envelope.cipher.name, nonce: envelope.cipher.nonce } };
}
function deriveKey(wrapping, salt, header) {
    const info = [VERSION, "gasless-effects", header.profileHash, header.operationId, header.fingerprint,
        header.role, header.envelopeHash, header.bootstrapMaterialHash ?? "", header.estimateHash ?? ""].join("\0");
    return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(info, "utf8"), 32));
}
function base64(value, length) {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 0 || decoded.length > 64 * 1024 || decoded.toString("base64") !== value ||
        (length !== undefined && decoded.length !== length)) {
        decoded.fill(0);
        corrupt("gasless_effect_encoding");
    }
    return decoded;
}
function corrupt(reason) { return gaslessFailure("APN_STATE_CORRUPT", reason); }
function unavailable(reason) { return gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", reason); }
//# sourceMappingURL=effect-store.js.map