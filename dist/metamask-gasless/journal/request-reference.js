import { join } from "node:path";
import { canonicalJson, exactKeys, isPlainRecord } from "../../canonical.js";
import { openNested, sealNested } from "../../custody-envelope.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import { loadOrCreateWrappingSecret, sealedRecordWrappingSecretMissing } from "../../wrapping-secret-custody.js";
import { mmDispatchIntent } from "../dispatch.js";
import { mmPrivateHash, mmRequestIdHash } from "../identity.js";
import { mmFail } from "../reasons.js";
import { mmExact, mmHash, mmUuid } from "../validation.js";
const ENVELOPE_VERSION = "apn.metamask-gasless-request-reference-envelope.v1";
const RECORD_VERSION = "apn.metamask-gasless-request-reference.v1";
/** One sealed record per operation, `<directory>/<profile hash>/<operation id>.json`, beside its plaintext journal. */
export const MM_REQUEST_REFERENCE_DIRECTORY = "metamask-gasless-request-references";
/** The operation, its profile and the request id hash its journal keeps are in the HKDF info and the AAD. */
const ENVELOPE = {
    info: header => [ENVELOPE_VERSION, header.binding.profileHash, header.binding.operationId, header.binding.requestIdHash].join("\0"),
    aad: header => header,
    maxFieldBytes: 1024,
    fail: () => unmatched(),
};
/**
 * The provider request id of a MetaMask gasless transfer (MetaMask's id for its relay job, which the owner's MFA approval
 * waits on), sealed under the login-Keychain wrapping secret with the custody envelope every APN store uses. A journal
 * written by a release after 0.5.106 keeps only the id's hash; the id itself is sealed here once, at prepare, before that
 * journal is written, and is opened only to send the request and to read its job (resume, and the observation an
 * abandonment runs first). Status, receipts and the delegation disable never open it.
 */
export class EncryptedMetaMaskGaslessRequestReferenceStore {
    wrappingSecret;
    files;
    constructor(state, wrappingSecret) {
        this.wrappingSecret = wrappingSecret;
        this.files = new RequestReferenceFiles(state.root);
    }
    async ready() {
        (await loadOrCreateWrappingSecret(this.files, this.wrappingSecret)).fill(0);
    }
    /**
     * The caller holds the operation's lock and no journal exists for it yet, so a record found here is only what an
     * interrupted earlier prepare of the same operation left; it is replaced, and its id was never sent or saved anywhere.
     */
    async seal(bindingInput, requestIdInput) {
        const binding = requestBinding(bindingInput), requestId = mmUuid(requestIdInput, "mm_gasless_internal");
        if (mmPrivateHash("request-id", requestId) !== binding.requestIdHash)
            mmFail("mm_gasless_internal");
        const wrapping = await loadOrCreateWrappingSecret(this.files, this.wrappingSecret);
        try {
            const envelope = sealNested(wrapping, ENVELOPE, { schemaVersion: ENVELOPE_VERSION, binding }, { schemaVersion: RECORD_VERSION, requestId });
            await this.files.write(binding, envelope);
        }
        finally {
            wrapping.fill(0);
        }
    }
    async open(bindingInput) {
        const binding = requestBinding(bindingInput), value = await this.files.load(binding);
        if (value === null)
            return unmatched(binding);
        const envelope = parseEnvelope(value, binding);
        const wrapping = await this.wrappingSecret.load();
        if (wrapping === null)
            throw sealedRecordWrappingSecretMissing("The wrapping secret that seals this MetaMask gasless request reference is missing.");
        try {
            return await openNested(wrapping, ENVELOPE, envelope, plaintext => requestIdOf(plaintext, binding));
        }
        finally {
            wrapping.fill(0);
        }
    }
}
/** The provider request id of `op`: kept in its intent by an earlier release, or opened from its seal. */
export async function mmRequestId(references, op) {
    const { requestId, requestIdHash } = op.intent;
    if (requestIdHash === undefined)
        return requestId === undefined ? mmFail("mm_gasless_state_corrupt") : requestId;
    return await references.open({ profileHash: op.profileHash, operationId: op.operationId, requestIdHash });
}
/** The dispatched intent as the provider helper is handed it: the request id in place of its hash, never both. */
export function mmProviderIntent(op, requestId) {
    if (mmPrivateHash("request-id", requestId) !== mmRequestIdHash(op.intent))
        mmFail("mm_gasless_state_corrupt");
    const { requestId: _kept, requestIdHash: _hash, ...dispatched } = mmDispatchIntent(op);
    return { ...dispatched, requestId };
}
class RequestReferenceFiles extends SecureStateStore {
    async load(binding) {
        return await this.readJson(this.path(binding));
    }
    async write(binding, envelope) {
        await this.ensureDirectory(join(MM_REQUEST_REFERENCE_DIRECTORY, binding.profileHash));
        await this.writeJson(this.path(binding), envelope);
    }
    path(binding) {
        stateIdentifier(binding.profileHash, "MetaMask gasless request reference profile hash");
        stateIdentifier(binding.operationId, "MetaMask gasless request reference operation ID");
        return join(MM_REQUEST_REFERENCE_DIRECTORY, binding.profileHash, `${binding.operationId}.json`);
    }
}
function requestBinding(value) {
    const b = mmExact(value, ["profileHash", "operationId", "requestIdHash"]);
    return { profileHash: mmHash(b.profileHash), operationId: mmHash(b.operationId), requestIdHash: mmHash(b.requestIdHash) };
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
function requestIdOf(value, binding) {
    const record = mmExact(value, ["schemaVersion", "requestId"]);
    if (record.schemaVersion !== RECORD_VERSION)
        return unmatched(binding);
    const requestId = mmUuid(record.requestId);
    if (mmPrivateHash("request-id", requestId) !== binding.requestIdHash)
        return unmatched(binding);
    return requestId;
}
/**
 * A sealed reference that is absent, damaged, sealed under another secret or for another operation. Nothing is sent
 * without it; the transfer ends from its own approval window or from the chain.
 */
function unmatched(binding) {
    throw new ApnError("APN_STATE_CORRUPT", "The sealed MetaMask request reference of this gasless transfer is missing, damaged or belongs to another transfer.", { reason: "mm_gasless_state_corrupt", ...(binding === undefined ? {} : { operationId: binding.operationId,
            nextActions: [`apn operation status --operation ${binding.operationId}`] }) });
}
//# sourceMappingURL=request-reference.js.map