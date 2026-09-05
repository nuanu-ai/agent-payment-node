import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import {
  BASE_CHAIN_HEX,
  smartAccountEnvironment,
  validateSmartAccountObservation,
} from "./metamask-smart-account-grant.js";
import {
  isGrantedPermissionRecord,
  validateSmartAccountPermissionRecord,
  type SmartAccountPermissionRecord,
} from "./metamask-smart-account-record.js";
import type { StateStore } from "./state.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";

const ENVELOPE_VERSION = "apn.metamask-smart-account-permission-envelope.v1" as const;

interface PermissionEnvelope {
  readonly schema_version: typeof ENVELOPE_VERSION;
  readonly profile_hash: string;
  readonly kdf: { readonly name: "HKDF-SHA-256"; readonly salt: string };
  readonly cipher: {
    readonly name: "AES-256-GCM";
    readonly nonce: string;
    readonly ciphertext: string;
    readonly tag: string;
  };
}

export interface SmartAccountPermissionStorePort {
  load(profileHash: string): Promise<SmartAccountPermissionRecord | null>;
  save(record: SmartAccountPermissionRecord): Promise<void>;
  remove(profileHash: string): Promise<void>;
  compareAndSet(
    expected: SmartAccountPermissionRecord,
    replacement: SmartAccountPermissionRecord | null,
  ): Promise<boolean>;
}

export class EncryptedSmartAccountPermissionStore implements SmartAccountPermissionStorePort {
  private readonly files: PermissionEnvelopeState;

  constructor(private readonly state: StateStore, private readonly wrappingSecret: WrappingSecretPort) {
    this.files = new PermissionEnvelopeState(state.root);
  }

  async load(profileHash: string): Promise<SmartAccountPermissionRecord | null> {
    const value = await this.files.load(profileHash);
    if (value === null) return null;
    const envelope = parseEnvelope(value, profileHash);
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) corrupt("The Smart Account wrapping secret is missing.");
    try { return decrypt(envelope, wrapping); }
    finally { wrapping.fill(0); }
  }

  async save(record: SmartAccountPermissionRecord): Promise<void> {
    validateProtectedRecord(record);
    const wrapping = await this.wrappingSecret.load() ?? await this.wrappingSecret.create();
    const salt = randomBytes(32);
    const nonce = randomBytes(12);
    const key = deriveKey(wrapping, salt, record.profile_hash);
    const header = {
      schema_version: ENVELOPE_VERSION,
      profile_hash: record.profile_hash,
      kdf: { name: "HKDF-SHA-256", salt: salt.toString("base64") },
      cipher: { name: "AES-256-GCM", nonce: nonce.toString("base64") },
    } as const;
    const plaintext = Buffer.from(canonicalJson(record), "utf8");
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      try {
        await this.files.write(record.profile_hash, {
          ...header,
          cipher: {
            ...header.cipher,
            ciphertext: ciphertext.toString("base64"),
            tag: cipher.getAuthTag().toString("base64"),
          },
        });
      } finally { ciphertext.fill(0); }
    } finally {
      plaintext.fill(0);
      key.fill(0);
      salt.fill(0);
      nonce.fill(0);
      wrapping.fill(0);
    }
  }

  async remove(profileHash: string): Promise<void> {
    await this.files.remove(profileHash);
  }

  async compareAndSet(
    expected: SmartAccountPermissionRecord,
    replacement: SmartAccountPermissionRecord | null,
  ): Promise<boolean> {
    if (replacement !== null && replacement.profile_hash !== expected.profile_hash) {
      throw new ApnError("APN_INTERNAL", "Smart Account permission replacement identity is invalid.");
    }
    return await this.state.withLocks([`smart-account-permission:${expected.profile_hash}`], async () => {
      const current = await this.load(expected.profile_hash);
      if (current === null || canonicalJson(current) !== canonicalJson(expected)) return false;
      if (replacement === null) await this.remove(expected.profile_hash);
      else await this.save(replacement);
      return true;
    });
  }
}

class PermissionEnvelopeState extends SecureStateStore {
  async load(profileHash: string): Promise<unknown | null> {
    stateIdentifier(profileHash, "Smart Account profile hash");
    return await this.readJson(join("smart-account-permissions", `${profileHash}.json`));
  }

  async write(profileHash: string, value: unknown): Promise<void> {
    stateIdentifier(profileHash, "Smart Account profile hash");
    await this.ensureDirectory("smart-account-permissions");
    await this.writeJson(join("smart-account-permissions", `${profileHash}.json`), value);
  }

  async remove(profileHash: string): Promise<void> {
    stateIdentifier(profileHash, "Smart Account profile hash");
    await this.removeFile(join("smart-account-permissions", `${profileHash}.json`));
  }
}

function decrypt(envelope: PermissionEnvelope, wrapping: Buffer): SmartAccountPermissionRecord {
  const salt = decodeBase64(envelope.kdf.salt, 32);
  const nonce = decodeBase64(envelope.cipher.nonce, 12);
  const ciphertext = decodeBase64(envelope.cipher.ciphertext);
  const tag = decodeBase64(envelope.cipher.tag, 16);
  const key = deriveKey(wrapping, salt, envelope.profile_hash);
  const header = {
    schema_version: envelope.schema_version,
    profile_hash: envelope.profile_hash,
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
    if (canonicalJson(value) !== text) corrupt("Smart Account permission plaintext is not canonical.");
    return validateProtectedRecord(value);
  } catch (error) {
    if (error instanceof ApnError) throw error;
    corrupt("Smart Account permission authentication or decryption failed.");
  } finally {
    salt.fill(0); nonce.fill(0); ciphertext.fill(0); tag.fill(0); key.fill(0); plaintext.fill(0);
  }
}

function validateProtectedRecord(value: unknown): SmartAccountPermissionRecord {
  const record = validateSmartAccountPermissionRecord(value);
  try {
    if (privateKeyToAccount(record.session_private_key).address.toLowerCase() !== record.session_address.toLowerCase()) {
      corrupt("Smart Account session key binding is invalid.");
    }
    if (!isGrantedPermissionRecord(record)) return record;
    const implementation = smartAccountEnvironment().implementations.EIP7702StatelessDeleGatorImpl;
    if (implementation === undefined) corrupt("The pinned MetaMask environment is incomplete.");
    const grant = validateSmartAccountObservation({
      owner_address: record.owner_address,
      chain_id: BASE_CHAIN_HEX,
      account_code: `0xef0100${implementation.slice(2)}`,
      supported_permissions: { "erc20-token-allowance": { ruleTypes: ["expiry"] } },
      permission_responses: [record.permission_response],
    }, {
      sessionAddress: record.session_address,
      capAtomic: record.requested_cap_atomic,
      startsAtUnix: record.starts_at_unix,
      expiresAtUnix: record.requested_expires_at_unix,
      nowUnix: record.starts_at_unix,
    });
    if (grant.ownerAddress.toLowerCase() !== record.owner_address.toLowerCase() ||
      grant.grantedCapAtomic !== record.granted_cap_atomic ||
      grant.grantedExpiresAtUnix !== record.granted_expires_at_unix ||
      grant.context !== record.grant_context || grant.grantFingerprint !== record.grant_fingerprint ||
      grant.delegationManager.toLowerCase() !== record.delegation_manager.toLowerCase()) {
      corrupt("Smart Account protected grant binding is invalid.");
    }
    return record;
  } catch (error) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") throw error;
    corrupt("Smart Account protected material is invalid.");
  }
}

function parseEnvelope(value: unknown, profileHash: string): PermissionEnvelope {
  if (!isPlainRecord(value) || !exactKeys(value, ["schema_version", "profile_hash", "kdf", "cipher"]) ||
    value.schema_version !== ENVELOPE_VERSION || value.profile_hash !== profileHash ||
    !isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) ||
    value.kdf.name !== "HKDF-SHA-256" || typeof value.kdf.salt !== "string" ||
    !isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) ||
    value.cipher.name !== "AES-256-GCM" || typeof value.cipher.nonce !== "string" ||
    typeof value.cipher.ciphertext !== "string" || typeof value.cipher.tag !== "string") corrupt("Smart Account permission envelope is invalid.");
  return value as unknown as PermissionEnvelope;
}

function deriveKey(wrapping: Buffer, salt: Buffer, profileHash: string): Buffer {
  return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${ENVELOPE_VERSION}\0${profileHash}`), 32));
}

function decodeBase64(value: string, length?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || decoded.length === 0 || (length !== undefined && decoded.length !== length)) {
    decoded.fill(0);
    corrupt("Smart Account permission envelope encoding is invalid.");
  }
  return decoded;
}

function corrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
