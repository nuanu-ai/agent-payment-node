import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { join } from "node:path";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { Address, Hex } from "./model.js";
import type { StateStore } from "./state.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";

const ENVELOPE_VERSION = "apn.provider-authorization-envelope.v1" as const;
const RECORD_VERSION = "apn.provider-authorization.v1" as const;
const KDF_NAME = "HKDF-SHA-256" as const;
const CIPHER_NAME = "AES-256-GCM" as const;
const HASH = /^[a-f0-9]{64}$/u;
const SIGNATURE = /^0x[0-9a-f]{130}$/u;

export interface ProviderAuthorizationBinding {
  readonly profile: string;
  readonly profileHash: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly wallet: Address;
  readonly providerId: string;
  readonly profileRevision: number;
  readonly capabilityHash: string;
  readonly accountBindingHash: string;
}

interface ProviderAuthorizationBase {
  readonly schemaVersion: typeof RECORD_VERSION;
  readonly requestHash: string;
  readonly updatedAt: string;
}

export type ProviderAuthorizationRecord =
  | ProviderAuthorizationBase & { readonly phase: "invocation_started" }
  | ProviderAuthorizationBase & {
    readonly phase: "pending";
    readonly recoveryToken: string;
    readonly providerState: string;
  }
  | ProviderAuthorizationBase & {
    readonly phase: "signed";
    readonly signature: Hex;
    readonly signatureHash: string;
  }
  | ProviderAuthorizationBase & {
    readonly phase: "rejected";
    readonly rejection: "provider_denied" | "provider_expired";
  };

interface ProviderAuthorizationEnvelope {
  readonly schemaVersion: typeof ENVELOPE_VERSION;
  readonly binding: ProviderAuthorizationBinding;
  readonly kdf: { readonly name: typeof KDF_NAME; readonly salt: string };
  readonly cipher: {
    readonly name: typeof CIPHER_NAME;
    readonly nonce: string;
    readonly ciphertext: string;
    readonly tag: string;
  };
}

export interface ProviderAuthorizationStorePort {
  load(binding: ProviderAuthorizationBinding): Promise<ProviderAuthorizationRecord | null>;
  save(binding: ProviderAuthorizationBinding, record: ProviderAuthorizationRecord): Promise<void>;
}

export class EncryptedProviderAuthorizationStore implements ProviderAuthorizationStorePort {
  private readonly envelopes: ProviderAuthorizationEnvelopeState;

  constructor(
    state: StateStore,
    private readonly wrappingSecret: WrappingSecretPort,
  ) {
    this.envelopes = new ProviderAuthorizationEnvelopeState(state.root);
  }

  async load(binding: ProviderAuthorizationBinding): Promise<ProviderAuthorizationRecord | null> {
    const value = await this.envelopes.load(binding.profileHash, binding.operationId);
    if (value === null) return null;
    const envelope = parseEnvelope(value, binding);
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) corrupt("The provider authorization wrapping secret is missing.");
    try { return decryptEnvelope(envelope, wrapping); }
    finally { wrapping.fill(0); }
  }

  async save(binding: ProviderAuthorizationBinding, record: ProviderAuthorizationRecord): Promise<void> {
    validateRecord(record);
    const previous = await this.load(binding);
    if (previous !== null) validateAdvance(previous, record);
    const wrapping = await this.loadOrCreateWrappingSecret();
    const salt = randomBytes(32);
    const nonce = randomBytes(12);
    const key = deriveKey(wrapping, salt, binding);
    const header = {
      schemaVersion: ENVELOPE_VERSION,
      binding,
      kdf: { name: KDF_NAME, salt: salt.toString("base64") },
      cipher: { name: CIPHER_NAME, nonce: nonce.toString("base64") },
    } as const;
    const plaintext = Buffer.from(canonicalJson(record), "utf8");
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope: ProviderAuthorizationEnvelope = {
        ...header,
        cipher: {
          ...header.cipher,
          ciphertext: ciphertext.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
        },
      };
      await this.envelopes.write(binding.profileHash, binding.operationId, envelope);
      ciphertext.fill(0);
    } finally {
      plaintext.fill(0);
      key.fill(0);
      salt.fill(0);
      nonce.fill(0);
      wrapping.fill(0);
    }
  }

  private async loadOrCreateWrappingSecret(): Promise<Buffer> {
    const existing = await this.wrappingSecret.load();
    return existing ?? await this.wrappingSecret.create();
  }
}

class ProviderAuthorizationEnvelopeState extends SecureStateStore {
  async load(profileHash: string, operationId: string): Promise<unknown | null> {
    stateIdentifier(profileHash, "provider authorization profile hash");
    stateIdentifier(operationId, "provider authorization operation ID");
    return await this.readJson(join("provider-authorizations", profileHash, `${operationId}.json`));
  }

  async write(profileHash: string, operationId: string, envelope: unknown): Promise<void> {
    stateIdentifier(profileHash, "provider authorization profile hash");
    stateIdentifier(operationId, "provider authorization operation ID");
    await this.ensureDirectory(join("provider-authorizations", profileHash));
    await this.writeJson(join("provider-authorizations", profileHash, `${operationId}.json`), envelope);
  }
}

function decryptEnvelope(envelope: ProviderAuthorizationEnvelope, wrapping: Buffer): ProviderAuthorizationRecord {
  const salt = decodeBase64(envelope.kdf.salt, 32, "salt");
  const nonce = decodeBase64(envelope.cipher.nonce, 12, "nonce");
  const ciphertext = decodeBase64(envelope.cipher.ciphertext, undefined, "ciphertext");
  const tag = decodeBase64(envelope.cipher.tag, 16, "tag");
  const key = deriveKey(wrapping, salt, envelope.binding);
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
    const value = JSON.parse(text) as unknown;
    if (canonicalJson(value) !== text) corrupt("Provider authorization plaintext is not canonical.");
    return validateRecord(value);
  } catch (error) {
    if (error instanceof ApnError) throw error;
    corrupt("Provider authorization authentication or decryption failed.");
  } finally {
    salt.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
    tag.fill(0);
    key.fill(0);
    plaintext.fill(0);
  }
}

function parseEnvelope(value: unknown, binding: ProviderAuthorizationBinding): ProviderAuthorizationEnvelope {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "binding", "kdf", "cipher"])) {
    corrupt("Provider authorization envelope schema is invalid.");
  }
  if (value.schemaVersion !== ENVELOPE_VERSION || canonicalJson(value.binding) !== canonicalJson(binding)) {
    corrupt("Provider authorization envelope binding is invalid.");
  }
  validateBinding(value.binding);
  if (!isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) || value.kdf.name !== KDF_NAME || typeof value.kdf.salt !== "string") {
    corrupt("Provider authorization KDF metadata is invalid.");
  }
  if (!isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) || value.cipher.name !== CIPHER_NAME) {
    corrupt("Provider authorization cipher metadata is invalid.");
  }
  for (const key of ["nonce", "ciphertext", "tag"] as const) {
    if (typeof value.cipher[key] !== "string") corrupt("Provider authorization cipher encoding is invalid.");
  }
  return value as unknown as ProviderAuthorizationEnvelope;
}

function validateBinding(value: unknown): ProviderAuthorizationBinding {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "profile", "profileHash", "operationId", "fingerprint", "wallet", "providerId", "profileRevision",
    "capabilityHash", "accountBindingHash",
  ])) corrupt("Provider authorization binding schema is invalid.");
  if (
    typeof value.profile !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.profile) ||
    typeof value.profileHash !== "string" || !HASH.test(value.profileHash) ||
    value.profileHash !== sha256(`profile\0${value.profile}`) ||
    typeof value.operationId !== "string" || !HASH.test(value.operationId) ||
    typeof value.fingerprint !== "string" || !HASH.test(value.fingerprint) ||
    typeof value.wallet !== "string" || !/^0x[0-9a-f]{40}$/u.test(value.wallet) ||
    typeof value.providerId !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.providerId) ||
    value.providerId === "local" ||
    !Number.isSafeInteger(value.profileRevision) || Number(value.profileRevision) < 1 ||
    typeof value.capabilityHash !== "string" || !HASH.test(value.capabilityHash) ||
    typeof value.accountBindingHash !== "string" || !HASH.test(value.accountBindingHash)
  ) corrupt("Provider authorization binding is invalid.");
  return value as unknown as ProviderAuthorizationBinding;
}

function validateRecord(value: unknown): ProviderAuthorizationRecord {
  if (!isPlainRecord(value)) corrupt("Provider authorization record is invalid.");
  const base = ["schemaVersion", "requestHash", "phase", "updatedAt"];
  const keys = value.phase === "pending" ? [...base, "recoveryToken", "providerState"]
    : value.phase === "signed" ? [...base, "signature", "signatureHash"]
      : value.phase === "rejected" ? [...base, "rejection"] : base;
  if (!exactKeys(value, keys) || value.schemaVersion !== RECORD_VERSION || ![
    "invocation_started", "pending", "signed", "rejected",
  ].includes(String(value.phase))) corrupt("Provider authorization record schema is invalid.");
  if (
    typeof value.requestHash !== "string" || !HASH.test(value.requestHash) ||
    typeof value.updatedAt !== "string" || !canonicalTimestamp(value.updatedAt)
  ) corrupt("Provider authorization record fields are invalid.");
  if (value.phase === "pending" && (
    typeof value.recoveryToken !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(value.recoveryToken) ||
    typeof value.providerState !== "string" || !/^[A-Z_]{1,64}$/u.test(value.providerState)
  )) corrupt("Provider authorization recovery state is invalid.");
  if (value.phase === "signed") {
    if (
      typeof value.signature !== "string" || !SIGNATURE.test(value.signature) ||
      typeof value.signatureHash !== "string" || !HASH.test(value.signatureHash) ||
      value.signatureHash !== domainHash("apn.x402.signature.v1", Buffer.from(value.signature.slice(2), "hex"))
    ) corrupt("Provider authorization signature is invalid.");
  }
  if (value.phase === "rejected" && !["provider_denied", "provider_expired"].includes(String(value.rejection))) {
    corrupt("Provider authorization rejection is invalid.");
  }
  return value as unknown as ProviderAuthorizationRecord;
}

function validateAdvance(previous: ProviderAuthorizationRecord, next: ProviderAuthorizationRecord): void {
  if (previous.requestHash !== next.requestHash || Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) {
    corrupt("Provider authorization record changed its frozen identity.");
  }
  if (previous.phase === "signed" || previous.phase === "rejected") {
    if (canonicalJson(previous) !== canonicalJson(next)) corrupt("Provider authorization terminal material was replaced.");
    return;
  }
  if (previous.phase === "pending" && next.phase === "pending" && previous.recoveryToken !== next.recoveryToken) {
    corrupt("Provider authorization recovery token changed.");
  }
}

function deriveKey(wrapping: Buffer, salt: Buffer, binding: ProviderAuthorizationBinding): Buffer {
  return Buffer.from(hkdfSync(
    "sha256",
    wrapping,
    salt,
    Buffer.from(`${ENVELOPE_VERSION}\0${binding.profileHash}\0${binding.operationId}`, "utf8"),
    32,
  ));
}

function decodeBase64(value: string, expectedLength: number | undefined, label: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (expectedLength === undefined ? decoded.length === 0 : decoded.length !== expectedLength)) {
    decoded.fill(0);
    corrupt(`Provider authorization ${label} encoding is invalid.`);
  }
  return decoded;
}

function canonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function corrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
