import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { canonicalPolicyInput, policyIncrease, sealProfilePolicy, validateProfilePolicy, } from "./profile-policy.js";
const ENVELOPE_VERSION = "apn.profile-policy-envelope.v1";
const KDF_NAME = "HKDF-SHA-256";
const CIPHER_NAME = "AES-256-GCM";
export class EncryptedProfilePolicy {
    state;
    wrappingSecret;
    approval;
    clock;
    constructor(state, wrappingSecret, approval, clock = { now: () => new Date() }) {
        this.state = state;
        this.wrappingSecret = wrappingSecret;
        this.approval = approval;
        this.clock = clock;
    }
    async load(binding) {
        const value = await this.state.loadEncryptedPolicyEnvelope(binding.profile);
        if (value === null)
            return null;
        const envelope = parseEnvelope(value, binding);
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null) {
            throw new ApnError("APN_STATE_CORRUPT", "The encrypted profile policy exists but its wrapping secret is missing.");
        }
        try {
            return decryptEnvelope(envelope, wrapping, binding);
        }
        finally {
            wrapping.fill(0);
        }
    }
    async set(binding, input) {
        const current = await this.load(binding);
        const supplied = canonicalPolicyInput(input);
        const effective = {
            ...supplied,
            ...(supplied.maxBalanceEthWei === undefined && current?.maxBalanceEthWei !== undefined
                ? { maxBalanceEthWei: current.maxBalanceEthWei }
                : {}),
        };
        const increase = policyIncrease(current, effective);
        const now = this.clock.now().toISOString();
        if (increase) {
            const fingerprint = hashObject({
                method: "wallet.policy.set",
                binding,
                limits: effective,
                change: current === null ? "create" : "increase",
            });
            await this.approval.approve({
                profile: binding.profile,
                walletAddress: binding.walletAddress,
                fingerprint,
                change: current === null ? "create" : "increase",
                ...effective,
            });
        }
        const policy = sealProfilePolicy({
            schemaVersion: "apn.profile-policy.v1",
            ...binding,
            ...effective,
            approvedAt: increase ? now : current?.approvedAt ?? now,
            updatedAt: now,
        });
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null) {
            throw new ApnError("APN_STATE_CORRUPT", "The wallet wrapping secret is missing.");
        }
        try {
            await this.save(binding, policy, wrapping);
            return policy;
        }
        finally {
            wrapping.fill(0);
        }
    }
    async save(binding, policy, wrapping) {
        const salt = randomBytes(32);
        const nonce = randomBytes(12);
        const key = deriveKey(wrapping, salt, binding.profile);
        const header = {
            schemaVersion: ENVELOPE_VERSION,
            binding,
            kdf: { name: KDF_NAME, salt: salt.toString("base64") },
            cipher: { name: CIPHER_NAME, nonce: nonce.toString("base64") },
        };
        const plaintext = Buffer.from(canonicalJson(policy), "utf8");
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
            await this.state.writeEncryptedPolicyEnvelope(binding.profile, envelope);
            ciphertext.fill(0);
        }
        finally {
            plaintext.fill(0);
            key.fill(0);
            salt.fill(0);
            nonce.fill(0);
        }
    }
}
function decryptEnvelope(envelope, wrapping, binding) {
    const salt = decodeBase64(envelope.kdf.salt, 32, "salt");
    const nonce = decodeBase64(envelope.cipher.nonce, 12, "nonce");
    const ciphertext = decodeBase64(envelope.cipher.ciphertext, undefined, "ciphertext");
    const tag = decodeBase64(envelope.cipher.tag, 16, "tag");
    const key = deriveKey(wrapping, salt, binding.profile);
    const header = {
        schemaVersion: envelope.schemaVersion,
        binding: envelope.binding,
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
            corrupt("Profile policy plaintext is not canonical.");
        return validateProfilePolicy(value, binding);
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        corrupt("Profile policy authentication or decryption failed.");
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
function parseEnvelope(value, binding) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "binding", "kdf", "cipher"])) {
        corrupt("Profile policy envelope schema is invalid.");
    }
    if (value.schemaVersion !== ENVELOPE_VERSION)
        corrupt("Profile policy envelope version is unsupported.");
    if (!isPlainRecord(value.binding) || !exactKeys(value.binding, ["profile", "profileHash", "walletAddress", "walletBindingHash"])) {
        corrupt("Profile policy binding schema is invalid.");
    }
    if (canonicalJson(value.binding) !== canonicalJson(binding))
        corrupt("Profile policy envelope binding is invalid.");
    if (!isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) || value.kdf.name !== KDF_NAME || typeof value.kdf.salt !== "string") {
        corrupt("Profile policy KDF metadata is invalid.");
    }
    if (!isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) || value.cipher.name !== CIPHER_NAME) {
        corrupt("Profile policy cipher metadata is invalid.");
    }
    for (const key of ["nonce", "ciphertext", "tag"]) {
        if (typeof value.cipher[key] !== "string")
            corrupt("Profile policy cipher encoding is invalid.");
    }
    return value;
}
function deriveKey(wrapping, salt, profile) {
    return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${ENVELOPE_VERSION}\0${profile}`, "utf8"), 32));
}
function decodeBase64(value, expectedLength, label) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
        corrupt(`Profile policy ${label} encoding is invalid.`);
    }
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value || (expectedLength !== undefined && decoded.length !== expectedLength)) {
        decoded.fill(0);
        corrupt(`Profile policy ${label} length is invalid.`);
    }
    return decoded;
}
function corrupt(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
//# sourceMappingURL=encrypted-profile-policy.js.map