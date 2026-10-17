import { hashObject } from "../canonical.js";
import { openNested, sealNested } from "../custody-envelope.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { validateGaslessMaterial } from "./material-validation.js";
import { gaslessExact, gaslessFailure, gaslessHash, gaslessSame } from "./validation.js";
const VERSION = "apn.gasless-effect-envelope.v1";
const ENVELOPE = {
    info: header => [VERSION, "gasless-effects", header.profileHash, header.operationId, header.fingerprint,
        header.role, header.envelopeHash, header.bootstrapMaterialHash ?? "", header.estimateHash ?? ""].join("\0"),
    aad: header => header,
    maxFieldBytes: 64 * 1024,
    fail: failure => failure === "authentication" ? unavailable("gasless_effect_authentication")
        : corrupt(failure === "canonical_plaintext" ? "gasless_effect_canonical_plaintext" : "gasless_effect_encoding"),
};
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
        try {
            const envelope = sealNested(wrapping, ENVELOPE, headerFor(operation, valid), valid);
            await this.initialize();
            await this.ensureDirectory(`gasless-effects/${operation.profileHash}`);
            await this.writeJson(this.path(operation, material.role), envelope);
            return valid;
        }
        finally {
            wrapping.fill(0);
        }
    }
    async decrypt(envelope) {
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            unavailable("gasless_wrapping_secret_missing");
        try {
            return await openNested(wrapping, ENVELOPE, envelope, value => value);
        }
        finally {
            wrapping.fill(0);
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
function headerFor(operation, material) {
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
function corrupt(reason) { return gaslessFailure("APN_STATE_CORRUPT", reason); }
function unavailable(reason) { return gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", reason); }
//# sourceMappingURL=effect-store.js.map