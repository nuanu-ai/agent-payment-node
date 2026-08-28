import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
const ENVELOPE_VERSION = "apn.wallet-envelope.v1";
const SECRET_VERSION = "apn.wallet-secret.v1";
const KDF_NAME = "HKDF-SHA-256";
const CIPHER_NAME = "AES-256-GCM";
const HASH = /^[a-f0-9]{64}$/u;
const PRIVATE_KEY = /^0x[0-9a-f]{64}$/u;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const SIGNATURE = /^0x[0-9a-f]{130}$/u;
const RAW_TRANSACTION = /^0x(?:[0-9a-f]{2})+$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
export class EncryptedWalletStore {
    state;
    wrappingSecret;
    constructor(state, wrappingSecret) {
        this.state = state;
        this.wrappingSecret = wrappingSecret;
    }
    async describe(profileInput) {
        const profile = canonicalProfile(profileInput);
        const value = await this.state.loadEncryptedWalletEnvelope(profile);
        if (value === null) {
            // An absent wallet must still exercise the production Keychain query so
            // `doctor keychain` distinguishes a usable-but-empty APN profile from a
            // missing/locked/unavailable Keychain command path.
            const probe = await this.wrappingSecret.load();
            probe?.fill(0);
            return null;
        }
        const envelope = parseEnvelope(value, profile);
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null) {
            throw new ApnError("APN_STATE_CORRUPT", "The encrypted wallet exists but its wrapping secret is missing.");
        }
        try {
            return { identity: envelope.identity, secret: decryptEnvelope(envelope, wrapping) };
        }
        finally {
            wrapping.fill(0);
        }
    }
    async ensure(profileInput) {
        const profile = canonicalProfile(profileInput);
        const current = await this.describe(profile);
        if (current !== null)
            return current;
        const wrapping = await this.wrappingSecret.create();
        let privateKey = randomPrivateKey();
        try {
            const account = privateKeyToAccount(privateKey);
            const createdAt = new Date().toISOString();
            const identity = {
                profile,
                address: account.address,
                chainId: CHAIN_ID,
                createdAt,
                bindingHash: hashObject({ profile, address: account.address, createdAt }),
            };
            const secret = {
                version: SECRET_VERSION,
                privateKey,
                directEffects: {},
                x402Effects: {},
            };
            await this.save(identity, secret, wrapping);
            return { identity, secret };
        }
        finally {
            privateKey = `0x${"0".repeat(64)}`;
            void privateKey;
            wrapping.fill(0);
        }
    }
    async save(identity, secret, wrappingInput) {
        const wrapping = wrappingInput === undefined ? await this.requiredWrappingSecret() : Buffer.from(wrappingInput);
        const salt = randomBytes(32);
        const nonce = randomBytes(12);
        const key = deriveKey(wrapping, salt, identity.profile);
        const header = {
            schemaVersion: ENVELOPE_VERSION,
            identity,
            kdf: { name: KDF_NAME, salt: salt.toString("base64") },
            cipher: { name: CIPHER_NAME, nonce: nonce.toString("base64") },
        };
        const plaintext = Buffer.from(canonicalJson(secret), "utf8");
        try {
            const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
            cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
            const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            const envelope = {
                ...header,
                cipher: {
                    ...header.cipher,
                    ciphertext: ciphertext.toString("base64"),
                    tag: cipher.getAuthTag().toString("base64"),
                },
            };
            await this.state.writeEncryptedWalletEnvelope(identity.profile, envelope);
            ciphertext.fill(0);
        }
        finally {
            plaintext.fill(0);
            key.fill(0);
            salt.fill(0);
            nonce.fill(0);
            wrapping.fill(0);
        }
    }
    clear(secret) {
        secret.privateKey = `0x${"0".repeat(64)}`;
        secret.directEffects = {};
        secret.x402Effects = {};
    }
    async requiredWrappingSecret() {
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            throw new ApnError("APN_STATE_CORRUPT", "The wallet wrapping secret is missing.");
        return wrapping;
    }
}
function decryptEnvelope(envelope, wrapping) {
    const salt = decodeBase64(envelope.kdf.salt, 32, "salt");
    const nonce = decodeBase64(envelope.cipher.nonce, 12, "nonce");
    const ciphertext = decodeBase64(envelope.cipher.ciphertext, undefined, "ciphertext");
    const tag = decodeBase64(envelope.cipher.tag, 16, "tag");
    const key = deriveKey(wrapping, salt, envelope.identity.profile);
    const header = {
        schemaVersion: envelope.schemaVersion,
        identity: envelope.identity,
        kdf: envelope.kdf,
        cipher: { name: envelope.cipher.name, nonce: envelope.cipher.nonce },
    };
    let plaintext = Buffer.alloc(0);
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
        decipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        const value = JSON.parse(text);
        if (canonicalJson(value) !== text)
            corrupt("Wallet plaintext is not canonical.");
        const secret = parseSecret(value);
        if (privateKeyToAccount(secret.privateKey).address !== envelope.identity.address) {
            corrupt("Wallet key does not match authenticated identity.");
        }
        return secret;
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        corrupt("Wallet authentication or decryption failed.");
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
function parseEnvelope(value, profile) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "identity", "kdf", "cipher"]))
        corrupt("Wallet envelope schema is invalid.");
    if (value.schemaVersion !== ENVELOPE_VERSION)
        corrupt("Wallet envelope version is unsupported.");
    if (!isPlainRecord(value.identity) || !exactKeys(value.identity, ["profile", "address", "chainId", "createdAt", "bindingHash"]))
        corrupt("Wallet identity schema is invalid.");
    const identity = value.identity;
    if (identity.profile !== profile || identity.chainId !== CHAIN_ID || typeof identity.address !== "string" ||
        canonicalAddress(identity.address) !== identity.address || typeof identity.createdAt !== "string" ||
        !Number.isFinite(Date.parse(identity.createdAt)) || typeof identity.bindingHash !== "string" || !HASH.test(identity.bindingHash))
        corrupt("Wallet identity fields are invalid.");
    if (identity.bindingHash !== hashObject({ profile, address: identity.address, createdAt: identity.createdAt })) {
        corrupt("Wallet identity binding is invalid.");
    }
    if (!isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) || value.kdf.name !== KDF_NAME || typeof value.kdf.salt !== "string")
        corrupt("Wallet KDF metadata is invalid.");
    if (!isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) || value.cipher.name !== CIPHER_NAME)
        corrupt("Wallet cipher metadata is invalid.");
    for (const key of ["nonce", "ciphertext", "tag"])
        if (typeof value.cipher[key] !== "string")
            corrupt("Wallet cipher encoding is invalid.");
    return value;
}
function parseSecret(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["version", "privateKey", "directEffects", "x402Effects"]) || value.version !== SECRET_VERSION)
        corrupt("Wallet secret schema is invalid.");
    if (typeof value.privateKey !== "string" || !PRIVATE_KEY.test(value.privateKey))
        corrupt("Wallet private key encoding is invalid.");
    const directEffects = parseDirectEffects(value.directEffects);
    const x402Effects = parseX402Effects(value.x402Effects);
    return { version: SECRET_VERSION, privateKey: value.privateKey, directEffects, x402Effects };
}
function parseDirectEffects(value) {
    if (!isPlainRecord(value))
        corrupt("Wallet effect map is invalid.");
    for (const [slot, item] of Object.entries(value)) {
        if (!HASH.test(slot) || !isPlainRecord(item) ||
            !exactKeys(item, ["payloadHash", "transactionHash", "rawTransaction", "rawTransactionHash"]) ||
            typeof item.payloadHash !== "string" || !HASH.test(item.payloadHash) ||
            typeof item.transactionHash !== "string" || !HEX32.test(item.transactionHash) ||
            typeof item.rawTransactionHash !== "string" || !HEX32.test(item.rawTransactionHash) ||
            typeof item.rawTransaction !== "string" || !RAW_TRANSACTION.test(item.rawTransaction) ||
            item.rawTransaction.length > 16_386)
            corrupt("Wallet direct-effect entry is invalid.");
        const computed = keccak256(item.rawTransaction);
        if (computed !== item.rawTransactionHash || computed !== item.transactionHash) {
            corrupt("Wallet direct-effect hashes are invalid.");
        }
    }
    return value;
}
function parseX402Effects(value) {
    if (!isPlainRecord(value))
        corrupt("Wallet effect map is invalid.");
    for (const [slot, item] of Object.entries(value)) {
        if (!HASH.test(slot) || !isPlainRecord(item) ||
            !exactKeys(item, ["createPayloadHash", "recoveryBindingHash", "authorization", "signature", "signatureHash"]) ||
            typeof item.createPayloadHash !== "string" || !HASH.test(item.createPayloadHash) ||
            typeof item.recoveryBindingHash !== "string" || !HASH.test(item.recoveryBindingHash) ||
            typeof item.signature !== "string" || !SIGNATURE.test(item.signature) ||
            typeof item.signatureHash !== "string" || !HASH.test(item.signatureHash) ||
            !validStoredAuthorization(item.authorization))
            corrupt("Wallet x402-effect entry is invalid.");
        const computed = domainHash("apn.x402.signature.v1", Buffer.from(item.signature.slice(2), "hex"));
        if (computed !== item.signatureHash)
            corrupt("Wallet x402 signature hash is invalid.");
    }
    return value;
}
function validStoredAuthorization(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["from", "to", "value", "validAfter", "validBefore", "nonce"]))
        return false;
    if (typeof value.from !== "string" || typeof value.to !== "string" ||
        value.from !== value.from.toLowerCase() || value.to !== value.to.toLowerCase() ||
        typeof value.value !== "string" || !DECIMAL.test(value.value) || value.value === "0" ||
        value.validAfter !== "0" || typeof value.validBefore !== "string" || !DECIMAL.test(value.validBefore) ||
        typeof value.nonce !== "string" || !HEX32.test(value.nonce))
        return false;
    try {
        canonicalAddress(value.from);
        canonicalAddress(value.to);
        return true;
    }
    catch {
        return false;
    }
}
function deriveKey(wrapping, salt, profile) {
    return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${ENVELOPE_VERSION}\0${profile}`, "utf8"), 32));
}
function decodeBase64(value, length, label) {
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value || (length !== undefined ? decoded.length !== length : decoded.length === 0)) {
        decoded.fill(0);
        corrupt(`Wallet ${label} encoding is invalid.`);
    }
    return decoded;
}
function randomPrivateKey() {
    for (let attempt = 0; attempt < 32; attempt += 1) {
        const candidate = `0x${randomBytes(32).toString("hex")}`;
        try {
            privateKeyToAccount(candidate);
            return candidate;
        }
        catch { /* try another valid secp256k1 scalar */ }
    }
    throw new ApnError("APN_INTERNAL", "Unable to create a wallet safely.");
}
function corrupt(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
//# sourceMappingURL=encrypted-wallet-store.js.map