import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { ClockPort } from "./ports.js";
import {
  canonicalPolicyInput,
  policyIncrease,
  sealProfilePolicy,
  validateProfilePolicy,
  type ProfilePolicyBinding,
  type ProfilePolicyPort,
  type ProfilePolicyRecord,
  type ProfilePolicySetInput,
} from "./profile-policy.js";
import type { ProfilePolicyApprovalPort } from "./policy-approval.js";
import type { StateStore } from "./state.js";

const ENVELOPE_VERSION = "apn.profile-policy-envelope.v1";
const KDF_NAME = "HKDF-SHA-256";
const CIPHER_NAME = "AES-256-GCM";

interface PolicyEnvelope {
  readonly schemaVersion: typeof ENVELOPE_VERSION;
  readonly binding: ProfilePolicyBinding;
  readonly kdf: { readonly name: typeof KDF_NAME; readonly salt: string };
  readonly cipher: {
    readonly name: typeof CIPHER_NAME;
    readonly nonce: string;
    readonly ciphertext: string;
    readonly tag: string;
  };
}

export class EncryptedProfilePolicy implements ProfilePolicyPort {
  constructor(
    private readonly state: StateStore,
    private readonly wrappingSecret: WrappingSecretPort,
    private readonly approval: ProfilePolicyApprovalPort,
    private readonly clock: ClockPort = { now: () => new Date() },
  ) {}

  async load(binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null> {
    const value = await this.state.loadEncryptedPolicyEnvelope(binding.profile);
    if (value === null) return null;
    const envelope = parseEnvelope(value, binding);
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) {
      throw new ApnError("APN_STATE_CORRUPT", "The encrypted profile policy exists but its wrapping secret is missing.");
    }
    try {
      return decryptEnvelope(envelope, wrapping, binding);
    } finally {
      wrapping.fill(0);
    }
  }

  async set(binding: ProfilePolicyBinding, input: ProfilePolicySetInput): Promise<ProfilePolicyRecord> {
    const current = await this.loadForSet(binding);
    const supplied = canonicalPolicyInput(input);
    const effective: ProfilePolicySetInput = {
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
    const wrapping = await this.wrappingSecret.load() ?? await this.wrappingSecret.create();
    try {
      await this.save(binding, policy, wrapping);
      return policy;
    } finally {
      wrapping.fill(0);
    }
  }

  private async loadForSet(binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null> {
    const value = await this.state.loadEncryptedPolicyEnvelope(binding.profile);
    if (value === null) return null;
    const envelope = parseEnvelope(value);
    if (canonicalJson(envelope.binding) === canonicalJson(binding)) return await this.load(binding);
    if (
      envelope.binding.profile !== binding.profile || envelope.binding.profileHash !== binding.profileHash
    ) corrupt("Profile policy envelope profile binding is invalid.");
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) corrupt("The rebound profile policy wrapping secret is missing.");
    try {
      decryptEnvelope(envelope, wrapping, envelope.binding);
      return null;
    } finally { wrapping.fill(0); }
  }

  private async save(binding: ProfilePolicyBinding, policy: ProfilePolicyRecord, wrapping: Buffer): Promise<void> {
    const salt = randomBytes(32);
    const nonce = randomBytes(12);
    const key = deriveKey(wrapping, salt, binding.profile);
    const header = {
      schemaVersion: ENVELOPE_VERSION,
      binding,
      kdf: { name: KDF_NAME, salt: salt.toString("base64") },
      cipher: { name: CIPHER_NAME, nonce: nonce.toString("base64") },
    } as const;
    const plaintext = Buffer.from(canonicalJson(policy), "utf8");
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope: PolicyEnvelope = {
        ...header,
        cipher: {
          ...header.cipher,
          ciphertext: ciphertext.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
        },
      };
      await this.state.writeEncryptedPolicyEnvelope(binding.profile, envelope);
      ciphertext.fill(0);
    } finally {
      plaintext.fill(0);
      key.fill(0);
      salt.fill(0);
      nonce.fill(0);
    }
  }
}

function decryptEnvelope(
  envelope: PolicyEnvelope,
  wrapping: Buffer,
  binding: ProfilePolicyBinding,
): ProfilePolicyRecord {
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
    const value = JSON.parse(text) as unknown;
    if (canonicalJson(value) !== text) corrupt("Profile policy plaintext is not canonical.");
    return validateProfilePolicy(value, binding);
  } catch (error) {
    if (error instanceof ApnError) throw error;
    corrupt("Profile policy authentication or decryption failed.");
  } finally {
    salt.fill(0);
    nonce.fill(0);
    ciphertext.fill(0);
    tag.fill(0);
    key.fill(0);
    plaintext.fill(0);
  }
}

function parseEnvelope(value: unknown, binding?: ProfilePolicyBinding): PolicyEnvelope {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "binding", "kdf", "cipher"])) {
    corrupt("Profile policy envelope schema is invalid.");
  }
  if (value.schemaVersion !== ENVELOPE_VERSION) corrupt("Profile policy envelope version is unsupported.");
  if (!isPlainRecord(value.binding) || !exactKeys(value.binding, ["profile", "profileHash", "walletAddress", "walletBindingHash"])) {
    corrupt("Profile policy binding schema is invalid.");
  }
  const storedBinding = value.binding as unknown as ProfilePolicyBinding;
  if (
    typeof storedBinding.profile !== "string" || typeof storedBinding.profileHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(storedBinding.profileHash) || typeof storedBinding.walletAddress !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/u.test(storedBinding.walletAddress) || typeof storedBinding.walletBindingHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(storedBinding.walletBindingHash)
  ) corrupt("Profile policy envelope binding is invalid.");
  if (binding !== undefined && canonicalJson(value.binding) !== canonicalJson(binding)) corrupt("Profile policy envelope binding is invalid.");
  if (!isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) || value.kdf.name !== KDF_NAME || typeof value.kdf.salt !== "string") {
    corrupt("Profile policy KDF metadata is invalid.");
  }
  if (!isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) || value.cipher.name !== CIPHER_NAME) {
    corrupt("Profile policy cipher metadata is invalid.");
  }
  for (const key of ["nonce", "ciphertext", "tag"] as const) {
    if (typeof value.cipher[key] !== "string") corrupt("Profile policy cipher encoding is invalid.");
  }
  return value as unknown as PolicyEnvelope;
}

function deriveKey(wrapping: Buffer, salt: Buffer, profile: string): Buffer {
  return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${ENVELOPE_VERSION}\0${profile}`, "utf8"), 32));
}

function decodeBase64(value: string, expectedLength: number | undefined, label: string): Buffer {
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

function corrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
