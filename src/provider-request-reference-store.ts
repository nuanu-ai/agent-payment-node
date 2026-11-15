import { join } from "node:path";
import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { openNested, sealNested, type EnvelopeSpec, type NestedHeader } from "./custody-envelope.js";
import { ApnError } from "./errors.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";
import { loadOrCreateWrappingSecret, sealedRecordWrappingSecretMissing } from "./wrapping-secret-custody.js";

const ENVELOPE_VERSION = "apn.provider-request-reference-envelope.v1" as const;
const RECORD_VERSION = "apn.provider-request-reference.v1" as const;
/**
 * One sealed record per operation, `<directory>/<profile hash>/<operation id>.json`, in its lane's own directory: the
 * MetaMask native transfers and the provider direct transfers (`apn pay transfer`). Both count for the wrapping-secret
 * guard (SEALED_DIRECTORIES in wrapping-secret-custody.ts).
 */
export const PROVIDER_REQUEST_REFERENCE_DIRECTORIES = {
  "metamask-native": "metamask-native-request-references",
  "provider-direct": "provider-direct-request-references",
} as const;
export type ProviderRequestReferenceLane = keyof typeof PROVIDER_REQUEST_REFERENCE_DIRECTORIES;
/** The form every provider request id APN accepts has (the MetaMask `pollingId` and `--provider-request-id`). */
const REFERENCE = /^[A-Za-z0-9._:-]{1,256}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/**
 * The hash that names a provider request in journals and output in place of its id. It is the value
 * `provider_request_reference_hash` has always shown for a direct transfer, so a record that keeps the id and a record
 * that seals it project the same hash.
 */
export function providerRequestReferenceHash(providerId: string, reference: string): string {
  return sha256(`provider-effect-reference\0${providerId}\0${reference}`);
}

/** The operation a sealed provider request id belongs to, and the hash its journal keeps in place of the id. */
export interface ProviderRequestReferenceBinding {
  readonly lane: ProviderRequestReferenceLane;
  readonly providerId: string;
  readonly profileHash: string;
  readonly operationId: string;
  /** providerRequestReferenceHash(providerId, id). */
  readonly referenceHash: string;
}

/**
 * Custody of a provider's request id (the id of the request the owner's MFA approval waits on) for an operation whose
 * journal keeps only its hash.
 */
export interface ProviderRequestReferencePort {
  /**
   * Loads the wrapping secret, or creates the first one for a state root that holds nothing sealed, before an effect
   * whose request id is sealed after it. A refusal here is a refusal before any effect; the secret then stays in the
   * command's own Keychain copy, so the seal after the effect reads no Keychain again.
   */
  ready(): Promise<void>;
  /** Seals the id once, before the journal names its hash; the caller holds the operation lock. */
  seal(binding: ProviderRequestReferenceBinding, reference: string): Promise<void>;
  /** The sealed id, or a precise refusal: a missing, damaged or foreign record, another secret, or a refused Keychain. */
  open(binding: ProviderRequestReferenceBinding): Promise<string>;
}

interface ReferenceEnvelope {
  readonly schemaVersion: typeof ENVELOPE_VERSION;
  readonly binding: ProviderRequestReferenceBinding;
  readonly kdf: { readonly name: "HKDF-SHA-256"; readonly salt: string };
  readonly cipher: { readonly name: "AES-256-GCM"; readonly nonce: string; readonly ciphertext: string; readonly tag: string };
}
type ReferenceHeader = { readonly schemaVersion: typeof ENVELOPE_VERSION; readonly binding: ProviderRequestReferenceBinding } & NestedHeader;

/** The lane, provider, operation, profile and the hash its journal keeps are in the HKDF info and the AAD. */
function envelopeSpec(binding: ProviderRequestReferenceBinding): EnvelopeSpec<ReferenceHeader> {
  return {
    info: header => [ENVELOPE_VERSION, header.binding.lane, header.binding.providerId, header.binding.profileHash,
      header.binding.operationId, header.binding.referenceHash].join("\0"),
    aad: header => header,
    maxFieldBytes: 1024,
    fail: () => unmatched(binding),
  };
}

/**
 * The provider request ids of MetaMask native and provider direct transfers, sealed under the login-Keychain wrapping
 * secret with the custody envelope every APN store uses. A journal written by a release after 0.5.106 keeps only the
 * id's hash; the id is sealed here once, before the journal names its hash: right after the provider named it, or, for
 * a MetaMask native transfer from 0.5.108 on, when APN names it itself, before the request is sent. It is opened only
 * to read that request again (observe and resume). Status, receipts and abandonment never open it.
 */
export class EncryptedProviderRequestReferenceStore implements ProviderRequestReferencePort {
  private readonly files: ReferenceFiles;
  constructor(state: { readonly root: string }, private readonly wrappingSecret: WrappingSecretPort) {
    this.files = new ReferenceFiles(state.root);
  }

  async ready(): Promise<void> {
    (await loadOrCreateWrappingSecret(this.files, this.wrappingSecret)).fill(0);
  }

  /**
   * The journal does not name this operation's hash yet, so a record found here is only what an interrupted earlier
   * seal of the same operation left; it is replaced.
   */
  async seal(bindingInput: ProviderRequestReferenceBinding, reference: string): Promise<void> {
    const binding = referenceBinding(bindingInput);
    if (typeof reference !== "string" || !REFERENCE.test(reference) ||
      providerRequestReferenceHash(binding.providerId, reference) !== binding.referenceHash) internal();
    const wrapping = await loadOrCreateWrappingSecret(this.files, this.wrappingSecret);
    try {
      const envelope: ReferenceEnvelope = sealNested(wrapping, envelopeSpec(binding), { schemaVersion: ENVELOPE_VERSION, binding },
        { schemaVersion: RECORD_VERSION, reference });
      await this.files.write(binding, envelope);
    } finally {
      wrapping.fill(0);
    }
  }

  async open(bindingInput: ProviderRequestReferenceBinding): Promise<string> {
    const binding = referenceBinding(bindingInput), value = await this.files.load(binding);
    if (value === null) return unmatched(binding);
    const envelope = parseEnvelope(value, binding);
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) throw sealedRecordWrappingSecretMissing("The wrapping secret that seals this provider request reference is missing.");
    try { return await openNested(wrapping, envelopeSpec(binding), envelope, plaintext => referenceOf(plaintext, binding)); }
    finally { wrapping.fill(0); }
  }
}

class ReferenceFiles extends SecureStateStore {
  async load(binding: ProviderRequestReferenceBinding): Promise<unknown | null> {
    return await this.readJson(this.path(binding));
  }

  async write(binding: ProviderRequestReferenceBinding, envelope: ReferenceEnvelope): Promise<void> {
    await this.ensureDirectory(join(PROVIDER_REQUEST_REFERENCE_DIRECTORIES[binding.lane], binding.profileHash));
    await this.writeJson(this.path(binding), envelope);
  }

  private path(binding: ProviderRequestReferenceBinding): string {
    stateIdentifier(binding.profileHash, "Provider request reference profile hash");
    stateIdentifier(binding.operationId, "Provider request reference operation ID");
    return join(PROVIDER_REQUEST_REFERENCE_DIRECTORIES[binding.lane], binding.profileHash, `${binding.operationId}.json`);
  }
}

function referenceBinding(value: ProviderRequestReferenceBinding): ProviderRequestReferenceBinding {
  if (!isPlainRecord(value) || !exactKeys(value, ["lane", "providerId", "profileHash", "operationId", "referenceHash"]) ||
    !Object.hasOwn(PROVIDER_REQUEST_REFERENCE_DIRECTORIES, String(value.lane)) ||
    typeof value.providerId !== "string" || !PROVIDER.test(value.providerId) ||
    ![value.profileHash, value.operationId, value.referenceHash].every(item => typeof item === "string" && HASH.test(item))) internal();
  return { lane: value.lane, providerId: value.providerId, profileHash: value.profileHash, operationId: value.operationId,
    referenceHash: value.referenceHash };
}

/** The file's own layout and binding; the cipher fields are checked by the envelope code when it opens them. */
function parseEnvelope(value: unknown, binding: ProviderRequestReferenceBinding): ReferenceEnvelope {
  if (!isPlainRecord(value)) return unmatched(binding);
  const kdf = value.kdf, cipher = value.cipher;
  if (!isPlainRecord(kdf) || !isPlainRecord(cipher) ||
    !exactKeys(value, ["schemaVersion", "binding", "kdf", "cipher"]) || !exactKeys(kdf, ["name", "salt"]) ||
    !exactKeys(cipher, ["name", "nonce", "ciphertext", "tag"]) || value.schemaVersion !== ENVELOPE_VERSION ||
    canonicalJson(value.binding) !== canonicalJson(binding) || kdf.name !== "HKDF-SHA-256" || cipher.name !== "AES-256-GCM" ||
    [kdf.salt, cipher.nonce, cipher.ciphertext, cipher.tag].some(item => typeof item !== "string")) return unmatched(binding);
  return value as unknown as ReferenceEnvelope;
}

function referenceOf(value: unknown, binding: ProviderRequestReferenceBinding): string {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "reference"]) || value.schemaVersion !== RECORD_VERSION ||
    typeof value.reference !== "string" || !REFERENCE.test(value.reference) ||
    providerRequestReferenceHash(binding.providerId, value.reference) !== binding.referenceHash) return unmatched(binding);
  return value.reference;
}

/**
 * A sealed reference that is absent, damaged, sealed under another secret or for another operation. Nothing is read
 * with it; the transfer keeps its state, and its status still answers.
 */
function unmatched(binding: ProviderRequestReferenceBinding): never {
  throw new ApnError("APN_STATE_CORRUPT", "The sealed provider request reference of this transfer is missing, damaged or belongs to another transfer.",
    { reason: "provider_request_reference_unmatched", operationId: binding.operationId,
      nextActions: [`apn operation status --operation ${binding.operationId}`] });
}

function internal(): never {
  throw new ApnError("APN_INTERNAL", "A provider request reference is sealed only for its own operation and under its own hash.");
}
