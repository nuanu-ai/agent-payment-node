import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../../../canonical.js";
import { ApnError } from "../../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../../secure-state-store.js";
import { validateSwapOperation } from "../../model.js";
import { validateUniswapExecutionBinding, verifySignedUniswapTransaction } from "./binding.js";
const ENVELOPE_VERSION = "apn.uniswap-ethereum.execution-effect-envelope.v1";
const EFFECT_VERSION = "apn.uniswap-ethereum.execution-effect.v1";
/** Raw signed bytes exist only inside this authenticated encrypted store. */
export class EncryptedUniswapExecutionEffectStore extends SecureStateStore {
    state;
    wrappingSecret;
    constructor(state, wrappingSecret) {
        super(state.root);
        this.state = state;
        this.wrappingSecret = wrappingSecret;
    }
    async load(operationValue, bindingValue) {
        const operation = validateSwapOperation(operationValue), binding = validateUniswapExecutionBinding(bindingValue, operation);
        return await this.state.withLocks([`custody:${operation.ownerProfileHash}`, `uniswap-effect:${operation.operationId}`], async () => await this.loadUnlocked(operation, binding));
    }
    async seal(operationValue, bindingValue, effectValue) {
        const operation = validateSwapOperation(operationValue), binding = validateUniswapExecutionBinding(bindingValue, operation);
        const effect = await validateEffect(effectValue, operation, binding);
        return await this.state.withLocks([`custody:${operation.ownerProfileHash}`, `uniswap-effect:${operation.operationId}`], async () => {
            const existing = await this.loadUnlocked(operation, binding);
            if (existing !== null) {
                if (existing.integrityHash !== effect.integrityHash)
                    corrupt("Uniswap execution effect is already sealed to different material.");
                return existing;
            }
            await this.writeUnlocked(operation, binding, effect, true);
            return effect;
        });
    }
    async markSendStarted(operationValue, bindingValue, now) {
        return await this.transition(operationValue, bindingValue, "send_started", 1, now);
    }
    async markSendOutcome(operationValue, bindingValue, phase, now) {
        return await this.transition(operationValue, bindingValue, phase, 1, now);
    }
    async transition(operationValue, bindingValue, phase, attempts, now) {
        const operation = validateSwapOperation(operationValue), binding = validateUniswapExecutionBinding(bindingValue, operation), at = instant(now);
        return await this.state.withLocks([`custody:${operation.ownerProfileHash}`, `uniswap-effect:${operation.operationId}`], async () => {
            const current = await this.loadUnlocked(operation, binding);
            if (current === null)
                corrupt("Uniswap signed effect is missing.");
            const allowed = {
                sealed: ["send_started"], send_started: ["send_accepted", "send_ambiguous"], send_accepted: [], send_ambiguous: []
            };
            if (!allowed[current.phase].includes(phase) || current.sendAttempts > attempts || attempts !== (phase === "sealed" ? 0 : 1) || at < current.updatedAt) {
                throw new ApnError("APN_OPERATION_BLOCKED", "Uniswap signed effect cannot be sent or transitioned again.", { reason: "uniswap_single_send" });
            }
            const { integrityHash: _old, ...oldBody } = current, body = { ...oldBody, phase, sendAttempts: attempts, updatedAt: at };
            const next = await validateEffect({ ...body, integrityHash: hashObject(body) }, operation, binding);
            await this.writeUnlocked(operation, binding, next, false);
            return next;
        });
    }
    async loadUnlocked(operation, binding) {
        const raw = await this.readJson(this.path(operation));
        if (raw === null)
            return null;
        const envelope = parseEnvelope(raw, operation, binding), wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            corrupt("Uniswap execution wrapping secret is missing.");
        const salt = base64(envelope.kdf.salt, 32), nonce = base64(envelope.cipher.nonce, 12), tag = base64(envelope.cipher.tag, 16), ciphertext = base64(envelope.cipher.ciphertext), key = deriveKey(wrapping, salt, envelope);
        let plaintext = Buffer.alloc(0);
        try {
            const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
            decipher.setAAD(Buffer.from(canonicalJson(headerOf(envelope)), "utf8"));
            decipher.setAuthTag(tag);
            plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
            const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), value = JSON.parse(text);
            if (canonicalJson(value) !== text)
                corrupt("Uniswap execution effect plaintext is not canonical.");
            const effect = await validateEffect(value, operation, binding);
            if (effect.transactionHash !== envelope.transactionHash)
                corrupt("Uniswap execution effect transaction binding changed.");
            return effect;
        }
        catch (error) {
            if (error instanceof ApnError)
                throw error;
            return corrupt("Uniswap execution effect authentication failed.");
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
    async writeUnlocked(operation, binding, effect, createOnly) {
        const wrapping = await this.wrappingSecret.load() ?? await this.wrappingSecret.create(), salt = randomBytes(32), nonce = randomBytes(12);
        const header = { schemaVersion: ENVELOPE_VERSION, operationId: operation.operationId, profileHash: operation.ownerProfileHash,
            bindingHash: binding.bindingHash, envelopeHash: binding.envelopeHash, submissionMarkerHash: binding.submissionMarkerHash,
            transactionHash: effect.transactionHash, kdf: { name: "HKDF-SHA-256", salt: salt.toString("base64") },
            cipher: { name: "AES-256-GCM", nonce: nonce.toString("base64") } };
        const key = deriveKey(wrapping, salt, header), plaintext = Buffer.from(canonicalJson(effect), "utf8");
        let ciphertext = Buffer.alloc(0);
        try {
            const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
            cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
            ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            await this.initialize();
            await this.ensureDirectory(`uniswap-execution-effects/${operation.ownerProfileHash}`);
            await this.writeJson(this.path(operation), { ...header, cipher: { ...header.cipher,
                    ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") } }, createOnly);
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
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "Uniswap execution profile");
        stateIdentifier(operation.operationId, "Uniswap execution operation");
        return `uniswap-execution-effects/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
}
export function newUniswapExecutionEffect(input) {
    const body = { schemaVersion: EFFECT_VERSION, ...input };
    return { ...body, integrityHash: hashObject(body) };
}
export async function validateEffect(value, operation, binding) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profileHash", "bindingHash", "envelopeHash",
        "submissionMarkerHash", "rawTransaction", "transactionHash", "phase", "sendAttempts", "sealedAt", "updatedAt", "integrityHash"]) ||
        value.schemaVersion !== EFFECT_VERSION || !["sealed", "send_started", "send_accepted", "send_ambiguous"].includes(value.phase) ||
        (value.sendAttempts !== 0 && value.sendAttempts !== 1) || (value.phase === "sealed") !== (value.sendAttempts === 0) ||
        value.operationId !== operation.operationId || value.profileHash !== operation.ownerProfileHash || value.bindingHash !== binding.bindingHash ||
        value.envelopeHash !== binding.envelopeHash || value.submissionMarkerHash !== binding.submissionMarkerHash ||
        typeof value.rawTransaction !== "string" || !/^0x(?:[0-9a-f]{2}){16,16384}$/u.test(value.rawTransaction) ||
        typeof value.transactionHash !== "string" || !/^0x[a-f0-9]{64}$/u.test(value.transactionHash) ||
        typeof value.integrityHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.integrityHash) ||
        !canonicalInstant(value.sealedAt) || !canonicalInstant(value.updatedAt) || value.updatedAt < value.sealedAt)
        corrupt("Uniswap execution effect is invalid.");
    const effect = value, { integrityHash, ...body } = effect;
    if (integrityHash !== hashObject(body) || await verifySignedUniswapTransaction(effect.rawTransaction, binding, operation) !== effect.transactionHash) {
        corrupt("Uniswap execution effect integrity failed.");
    }
    return effect;
}
function parseEnvelope(value, operation, binding) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profileHash", "bindingHash", "envelopeHash",
        "submissionMarkerHash", "transactionHash", "kdf", "cipher"]) || value.schemaVersion !== ENVELOPE_VERSION ||
        value.operationId !== operation.operationId || value.profileHash !== operation.ownerProfileHash || value.bindingHash !== binding.bindingHash ||
        value.envelopeHash !== binding.envelopeHash || value.submissionMarkerHash !== binding.submissionMarkerHash ||
        typeof value.transactionHash !== "string" || !/^0x[a-f0-9]{64}$/u.test(value.transactionHash) ||
        !isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) ||
        value.kdf.name !== "HKDF-SHA-256" || !isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) ||
        value.cipher.name !== "AES-256-GCM")
        corrupt("Uniswap execution effect envelope is invalid.");
    return value;
}
function headerOf(e) { return { ...e, cipher: { name: e.cipher.name, nonce: e.cipher.nonce } }; }
function deriveKey(wrapping, salt, h) {
    return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${ENVELOPE_VERSION}\0${h.profileHash}\0${h.operationId}\0${h.bindingHash}\0${h.submissionMarkerHash}`), 32));
}
function base64(value, length) {
    if (typeof value !== "string")
        corrupt("Uniswap execution effect encoding is invalid.");
    const bytes = Buffer.from(value, "base64");
    if (bytes.length === 0 || bytes.length > 64 * 1024 || bytes.toString("base64") !== value ||
        (length !== undefined && bytes.length !== length)) {
        bytes.fill(0);
        corrupt("Uniswap execution effect encoding is invalid.");
    }
    return bytes;
}
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new ApnError("APN_INVALID_INPUT", "Uniswap execution time is invalid."); return value.toISOString(); }
function canonicalInstant(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=effect-store.js.map