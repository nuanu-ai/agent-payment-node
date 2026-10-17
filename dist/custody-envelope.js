import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
const LENGTH = { salt: 32, nonce: 12, ciphertext: null, tag: 16 };
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
/** Encrypts `plaintext` and zeroes it. The caller loads, and zeroes, the wrapping secret. */
export function sealEnvelope(secret, spec, header, plaintext) {
    const salt = randomBytes(32), nonce = randomBytes(12);
    let key, ciphertext;
    try {
        const sealedHeader = header(salt.toString("base64"), nonce.toString("base64"));
        key = derive(secret, salt, spec.info(sealedHeader));
        const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
        cipher.setAAD(Buffer.from(canonicalJson(spec.aad(sealedHeader)), "utf8"));
        ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return { header: sealedHeader, salt: salt.toString("base64"), nonce: nonce.toString("base64"),
            ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
    }
    finally {
        salt.fill(0);
        nonce.fill(0);
        key?.fill(0);
        ciphertext?.fill(0);
        plaintext.fill(0);
    }
}
export function sealCanonicalJson(secret, spec, header, value) {
    return sealEnvelope(secret, spec, header, Buffer.from(canonicalJson(value), "utf8"));
}
/**
 * Decrypts and hands the plaintext to `use`, then zeroes it. An APN error from `use` passes through unchanged; any
 * other error is the store's "authentication" failure, as decryption errors are.
 */
export async function openEnvelope(secret, spec, header, parts, use) {
    const decoded = [];
    try {
        const field = (name) => { const bytes = decode(spec, name, parts[name]); decoded.push(bytes); return bytes; };
        const salt = field("salt"), nonce = field("nonce"), ciphertext = field("ciphertext"), tag = field("tag");
        const key = derive(secret, salt, spec.info(header));
        decoded.push(key);
        let plaintext = Buffer.alloc(0);
        try {
            const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
            decipher.setAAD(Buffer.from(canonicalJson(spec.aad(header)), "utf8"));
            decipher.setAuthTag(tag);
            plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            return await use(plaintext);
        }
        catch (error) {
            if (error instanceof ApnError)
                throw error;
            return spec.fail("authentication", null, error);
        }
        finally {
            plaintext.fill(0);
        }
    }
    finally {
        for (const bytes of decoded)
            bytes.fill(0);
    }
}
/** Opens strict UTF-8 canonical JSON and passes the value to `accept`, under the same error rules as openEnvelope. */
export async function openCanonicalJson(secret, spec, header, parts, accept) {
    return await openEnvelope(secret, spec, header, parts, async (plaintext) => {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        const value = JSON.parse(text);
        if (canonicalJson(value) !== text)
            spec.fail("canonical_plaintext", null, null);
        return await accept(value);
    });
}
/** Seals canonical JSON under `base` in the nested layout; the AAD is the file without ciphertext and tag. */
export function sealNested(secret, spec, base, value) {
    const sealed = sealCanonicalJson(secret, spec, (salt, nonce) => ({ ...base,
        kdf: { name: "HKDF-SHA-256", salt }, cipher: { name: "AES-256-GCM", nonce } }), value);
    return { ...sealed.header, cipher: { ...sealed.header.cipher, ciphertext: sealed.ciphertext, tag: sealed.tag } };
}
/** Opens a nested-layout envelope whose shape the store has already checked. */
export async function openNested(secret, spec, envelope, accept) {
    const header = { ...envelope, cipher: { name: envelope.cipher.name, nonce: envelope.cipher.nonce } };
    return await openCanonicalJson(secret, spec, header, { salt: envelope.kdf.salt, nonce: envelope.cipher.nonce,
        ciphertext: envelope.cipher.ciphertext, tag: envelope.cipher.tag }, accept);
}
function derive(secret, salt, info) {
    return Buffer.from(hkdfSync("sha256", secret, salt, Buffer.from(info, "utf8"), 32));
}
function decode(spec, field, value) {
    if (typeof value !== "string" || !BASE64.test(value))
        spec.fail("encoding", field, null);
    const bytes = Buffer.from(value, "base64"), length = LENGTH[field];
    if (bytes.toString("base64") !== value || bytes.length === 0 || (length !== null && bytes.length !== length) ||
        (spec.maxFieldBytes !== null && bytes.length > spec.maxFieldBytes)) {
        bytes.fill(0);
        spec.fail("decoding", field, null);
    }
    return bytes;
}
//# sourceMappingURL=custody-envelope.js.map