import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { openNested, sealNested } from "./custody-envelope.js";
import { ApnError } from "./errors.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";
import { loadOrCreateWrappingSecret, sealedRecordWrappingSecretMissing } from "./wrapping-secret-custody.js";
const ENVELOPE_VERSION = "apn.provider-request-reference-envelope.v1";
const RECORD_VERSION = "apn.provider-request-reference.v1";
/**
 * Each lane's own directory. The MetaMask native transfers and the provider direct transfers (`apn pay transfer`) keep one
 * sealed record per operation, `<directory>/<profile hash>/<operation id>.json`. The MetaMask gasless delegation disable
 * (`apn gasless transfer revoke`) sends a new request on every run, so its lane keeps one sealed record per request,
 * `<directory>/<profile hash>/<operation id>/<reference hash>.json`, never replaced, and removed (`discard`) only for a
 * request that provably never left the machine. Every lane counts for the wrapping-secret guard (wrapping-secret-custody.ts).
 */
export const PROVIDER_REQUEST_REFERENCE_DIRECTORIES = {
    "metamask-native": "metamask-native-request-references",
    "provider-direct": "provider-direct-request-references",
    "metamask-revocation": "metamask-revocation-request-references",
};
/** The lanes that keep one sealed record per request of an operation, listed by `listProviderRequestReferences`. */
const PER_REQUEST_LANES = new Set(["metamask-revocation"]);
/** The form every provider request id APN accepts has (the MetaMask `pollingId` and `--provider-request-id`). */
const REFERENCE = /^[A-Za-z0-9._:-]{1,256}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
/**
 * The hash that names a provider request in journals and output in place of its id. It is the value
 * `provider_request_reference_hash` has always shown for a direct transfer, so a record that keeps the id and a record
 * that seals it project the same hash.
 */
export function providerRequestReferenceHash(providerId, reference) {
    return sha256(`provider-effect-reference\0${providerId}\0${reference}`);
}
/** The lane, provider, operation, profile and the hash its journal keeps are in the HKDF info and the AAD. */
function envelopeSpec(binding) {
    return {
        info: header => [ENVELOPE_VERSION, header.binding.lane, header.binding.providerId, header.binding.profileHash,
            header.binding.operationId, header.binding.referenceHash].join("\0"),
        aad: header => header,
        maxFieldBytes: 1024,
        fail: () => unmatched(binding),
    };
}
/**
 * The provider request ids of MetaMask native and provider direct transfers and of MetaMask gasless delegation disables,
 * sealed under the login-Keychain wrapping secret with the custody envelope every APN store uses. A journal written by a
 * release after 0.5.106 keeps only the id's hash; the id is sealed here once, before the journal names its hash: right
 * after the provider named it, or, for a MetaMask native transfer from 0.5.108 on, when APN names it itself, before the
 * request is sent. A delegation disable (0.5.109 on) records nothing in its operation; APN names its id and seals it here
 * before the request is sent, and its output names the hash. An id is opened only to read that request again (observe
 * and resume). Status, receipts and abandonment never open it.
 */
export class EncryptedProviderRequestReferenceStore {
    wrappingSecret;
    files;
    constructor(state, wrappingSecret) {
        this.wrappingSecret = wrappingSecret;
        this.files = new ReferenceFiles(state.root);
    }
    async ready() {
        (await loadOrCreateWrappingSecret(this.files, this.wrappingSecret)).fill(0);
    }
    /**
     * The journal does not name this operation's hash yet, so a record found here is only what an interrupted earlier
     * seal of the same operation left; it is replaced. A per-request lane never replaces a record: each request has a new
     * id, so a record already at its hash refuses (`APN_STATE_SECURITY`) and nothing is sealed.
     */
    async seal(bindingInput, reference) {
        const binding = referenceBinding(bindingInput);
        if (typeof reference !== "string" || !REFERENCE.test(reference) ||
            providerRequestReferenceHash(binding.providerId, reference) !== binding.referenceHash)
            internal();
        const wrapping = await loadOrCreateWrappingSecret(this.files, this.wrappingSecret);
        try {
            const envelope = sealNested(wrapping, envelopeSpec(binding), { schemaVersion: ENVELOPE_VERSION, binding }, { schemaVersion: RECORD_VERSION, reference });
            await this.files.write(binding, envelope);
        }
        finally {
            wrapping.fill(0);
        }
    }
    async open(bindingInput) {
        const binding = referenceBinding(bindingInput), value = await this.files.load(binding);
        if (value === null)
            return unmatched(binding);
        const envelope = parseEnvelope(value, binding);
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            throw sealedRecordWrappingSecretMissing("The wrapping secret that seals this provider request reference is missing.");
        try {
            return await openNested(wrapping, envelopeSpec(binding), envelope, plaintext => referenceOf(plaintext, binding));
        }
        finally {
            wrapping.fill(0);
        }
    }
    async discard(bindingInput) {
        const binding = referenceBinding(bindingInput);
        if (!PER_REQUEST_LANES.has(binding.lane))
            internal();
        await this.files.remove(binding);
    }
}
class ReferenceFiles extends SecureStateStore {
    async load(binding) {
        return await this.readJson(this.path(binding));
    }
    /** A per-operation record may replace what an interrupted seal left; a per-request record is created only once. */
    async write(binding, envelope) {
        const path = this.path(binding);
        await this.ensureDirectory(dirname(path));
        await this.writeJson(path, envelope, PER_REQUEST_LANES.has(binding.lane));
    }
    /** The protected delete of exactly this record's file (a regular, owner-only, single-link file); its directory stays. */
    async remove(binding) {
        await this.removeFile(this.path(binding));
    }
    path(binding) {
        stateIdentifier(binding.profileHash, "Provider request reference profile hash");
        stateIdentifier(binding.operationId, "Provider request reference operation ID");
        const directory = PROVIDER_REQUEST_REFERENCE_DIRECTORIES[binding.lane];
        if (!PER_REQUEST_LANES.has(binding.lane))
            return join(directory, binding.profileHash, `${binding.operationId}.json`);
        stateIdentifier(binding.referenceHash, "Provider request reference hash");
        return join(directory, binding.profileHash, binding.operationId, `${binding.referenceHash}.json`);
    }
}
const SEALED_FILE = /^[a-f0-9]{64}\.json$/u;
/**
 * The requests sealed for one operation in a per-request lane, newest first (by the record file's modification time,
 * then by hash). A directory listing of the state root the store writes to, with one `lstat` per record: no Keychain
 * read, nothing opened. An absent directory holds none; a directory that is not the owner's own refuses
 * (`APN_STATE_SECURITY`), as every state read does. Atomic-write stages and regular files whose name starts with a dot
 * (Finder's .DS_Store) are not records, as the wrapping-secret guard reads them. Every other entry must be a regular
 * file named `<64 hex>.json`, the only name the store writes; anything else (another name, a link, a directory, a
 * dot-named link or directory) refuses the whole listing with `APN_STATE_CORRUPT /
 * provider_request_reference_listing_invalid`, and is never skipped.
 */
export async function listProviderRequestReferences(state, scopeInput) {
    const scope = referenceScope(scopeInput);
    const directory = join(PROVIDER_REQUEST_REFERENCE_DIRECTORIES[scope.lane], scope.profileHash, scope.operationId);
    const unlisted = () => {
        throw new ApnError("APN_STATE_CORRUPT", `The sealed provider request references of this operation (${directory}) hold an entry APN never writes.`, { reason: "provider_request_reference_listing_invalid", operationId: scope.operationId,
            nextActions: [`apn operation status --operation ${scope.operationId}`] });
    };
    const records = [];
    for (const entry of await state.recordEntries(directory)) {
        if (entry.isFile() && entry.name.startsWith("."))
            continue;
        if (!entry.isFile() || !SEALED_FILE.test(entry.name))
            unlisted();
        const info = await lstat(join(state.root, directory, entry.name));
        if (!info.isFile())
            unlisted();
        records.push({ referenceHash: entry.name.slice(0, -".json".length), writtenAtMs: info.mtimeMs });
    }
    return records.sort((left, right) => right.writtenAtMs - left.writtenAtMs ||
        (left.referenceHash < right.referenceHash ? -1 : left.referenceHash > right.referenceHash ? 1 : 0));
}
function referenceScope(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["lane", "profileHash", "operationId"]) ||
        !Object.hasOwn(PROVIDER_REQUEST_REFERENCE_DIRECTORIES, String(value.lane)) ||
        !PER_REQUEST_LANES.has(value.lane) ||
        ![value.profileHash, value.operationId].every(item => typeof item === "string" && HASH.test(item)))
        internal();
    return { lane: value.lane, profileHash: value.profileHash, operationId: value.operationId };
}
function referenceBinding(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["lane", "providerId", "profileHash", "operationId", "referenceHash"]) ||
        !Object.hasOwn(PROVIDER_REQUEST_REFERENCE_DIRECTORIES, String(value.lane)) ||
        typeof value.providerId !== "string" || !PROVIDER.test(value.providerId) ||
        ![value.profileHash, value.operationId, value.referenceHash].every(item => typeof item === "string" && HASH.test(item)))
        internal();
    return { lane: value.lane, providerId: value.providerId, profileHash: value.profileHash, operationId: value.operationId,
        referenceHash: value.referenceHash };
}
/** The file's own layout and binding; the cipher fields are checked by the envelope code when it opens them. */
function parseEnvelope(value, binding) {
    if (!isPlainRecord(value))
        return unmatched(binding);
    const kdf = value.kdf, cipher = value.cipher;
    if (!isPlainRecord(kdf) || !isPlainRecord(cipher) ||
        !exactKeys(value, ["schemaVersion", "binding", "kdf", "cipher"]) || !exactKeys(kdf, ["name", "salt"]) ||
        !exactKeys(cipher, ["name", "nonce", "ciphertext", "tag"]) || value.schemaVersion !== ENVELOPE_VERSION ||
        canonicalJson(value.binding) !== canonicalJson(binding) || kdf.name !== "HKDF-SHA-256" || cipher.name !== "AES-256-GCM" ||
        [kdf.salt, cipher.nonce, cipher.ciphertext, cipher.tag].some(item => typeof item !== "string"))
        return unmatched(binding);
    return value;
}
function referenceOf(value, binding) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "reference"]) || value.schemaVersion !== RECORD_VERSION ||
        typeof value.reference !== "string" || !REFERENCE.test(value.reference) ||
        providerRequestReferenceHash(binding.providerId, value.reference) !== binding.referenceHash)
        return unmatched(binding);
    return value.reference;
}
/**
 * A sealed reference that is absent, damaged, sealed under another secret or for another operation. Nothing is read
 * with it; the transfer keeps its state, and its status still answers.
 */
function unmatched(binding) {
    throw new ApnError("APN_STATE_CORRUPT", "The sealed provider request reference of this transfer is missing, damaged or belongs to another transfer.", { reason: "provider_request_reference_unmatched", operationId: binding.operationId,
        nextActions: [`apn operation status --operation ${binding.operationId}`] });
}
function internal() {
    throw new ApnError("APN_INTERNAL", "A provider request reference is sealed only for its own operation and under its own hash.");
}
//# sourceMappingURL=provider-request-reference-store.js.map