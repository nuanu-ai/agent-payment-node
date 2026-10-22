import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { openNested, sealNested, type EnvelopeSpec, type NestedHeader } from "./custody-envelope.js";
import { ApnError } from "./errors.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { ClockPort } from "./ports.js";
import type { Address } from "./model.js";
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
import { policyStorageIdentity, solanaAccount, validPolicyNetwork, validSolanaPolicyNetwork } from "./x402-network.js";

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

const ENVELOPE: EnvelopeSpec<{ readonly schemaVersion: typeof ENVELOPE_VERSION; readonly binding: ProfilePolicyBinding } & NestedHeader> = {
  info: header => `${ENVELOPE_VERSION}\0${policyStorageIdentity(header.binding)}`,
  aad: header => header,
  maxFieldBytes: null,
  fail: (failure, field) => corrupt(failure === "authentication" ? "Profile policy authentication or decryption failed."
    : failure === "canonical_plaintext" ? "Profile policy plaintext is not canonical."
      : `Profile policy ${field} ${failure === "encoding" ? "encoding" : "length"} is invalid.`),
};

export class EncryptedProfilePolicy implements ProfilePolicyPort {
  constructor(
    private readonly state: StateStore,
    private readonly wrappingSecret: WrappingSecretPort,
    private readonly approval: ProfilePolicyApprovalPort,
    private readonly clock: ClockPort = { now: () => new Date() },
  ) {}

  async load(binding: ProfilePolicyBinding): Promise<ProfilePolicyRecord | null> {
    const value = await this.state.loadEncryptedPolicyEnvelope(policyStorageIdentity(binding));
    if (value === null) return null;
    const envelope = parseEnvelope(value, binding);
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) {
      throw new ApnError("APN_STATE_CORRUPT", "The encrypted profile policy exists but its wrapping secret is missing.");
    }
    try {
      return await decryptEnvelope(envelope, wrapping, binding);
    } finally {
      wrapping.fill(0);
    }
  }

  async set(binding: ProfilePolicyBinding, input: ProfilePolicySetInput): Promise<ProfilePolicyRecord> {
    const current = await this.loadForSet(binding);
    const { x402Payees: suppliedPayees, ...supplied } = canonicalPolicyInput(input, binding);
    // An omitted payee pin keeps the current one; null removes it.
    const x402Payees = suppliedPayees === undefined ? current?.x402Payees : suppliedPayees ?? undefined;
    const effective: Omit<ProfilePolicySetInput, "x402Payees"> & { readonly x402Payees?: readonly Address[] } = {
      ...supplied,
      ...(supplied.maxBalanceEthWei === undefined && current?.maxBalanceEthWei !== undefined
        ? { maxBalanceEthWei: current.maxBalanceEthWei }
        : {}),
      ...(x402Payees === undefined ? {} : { x402Payees: x402Payees as readonly Address[] }),
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
        ...(binding.x402Network === undefined ? {} : { x402Network: binding.x402Network }),
        ...(binding.x402Solana === undefined ? {} : { x402Solana: binding.x402Solana }),
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
    const value = await this.state.loadEncryptedPolicyEnvelope(policyStorageIdentity(binding));
    if (value === null) return null;
    const envelope = parseEnvelope(value);
    if (canonicalJson(envelope.binding) === canonicalJson(binding)) return await this.load(binding);
    if (
      envelope.binding.profile !== binding.profile || envelope.binding.profileHash !== binding.profileHash ||
      canonicalJson(envelope.binding.x402Network ?? null) !== canonicalJson(binding.x402Network ?? null) ||
      canonicalJson(envelope.binding.x402Solana ?? null) !== canonicalJson(binding.x402Solana ?? null)
    ) corrupt("Profile policy envelope profile binding is invalid.");
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) corrupt("The rebound profile policy wrapping secret is missing.");
    try {
      await decryptEnvelope(envelope, wrapping, envelope.binding);
      return null;
    } finally { wrapping.fill(0); }
  }

  private async save(binding: ProfilePolicyBinding, policy: ProfilePolicyRecord, wrapping: Buffer): Promise<void> {
    const envelope: PolicyEnvelope = sealNested(wrapping, ENVELOPE, { schemaVersion: ENVELOPE_VERSION, binding }, policy);
    await this.state.writeEncryptedPolicyEnvelope(policyStorageIdentity(binding), envelope);
  }
}

async function decryptEnvelope(
  envelope: PolicyEnvelope,
  wrapping: Buffer,
  binding: ProfilePolicyBinding,
): Promise<ProfilePolicyRecord> {
  return await openNested(wrapping, ENVELOPE, envelope, value => validateProfilePolicy(value, binding));
}

function parseEnvelope(value: unknown, binding?: ProfilePolicyBinding): PolicyEnvelope {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "binding", "kdf", "cipher"])) {
    corrupt("Profile policy envelope schema is invalid.");
  }
  if (value.schemaVersion !== ENVELOPE_VERSION) corrupt("Profile policy envelope version is unsupported.");
  if (!isPlainRecord(value.binding) || !exactKeys(value.binding, ["profile", "profileHash", "walletAddress", "walletBindingHash",
    ...(value.binding.x402Network === undefined ? [] : ["x402Network"]), ...(value.binding.x402Solana === undefined ? [] : ["x402Solana"])]) ||
    !validPolicyNetwork(value.binding.x402Network) || (value.binding.x402Solana !== undefined &&
      (value.binding.x402Network !== undefined || !validSolanaPolicyNetwork(value.binding.x402Solana)))) {
    corrupt("Profile policy binding schema is invalid.");
  }
  const storedBinding = value.binding as unknown as ProfilePolicyBinding;
  if (
    typeof storedBinding.profile !== "string" || typeof storedBinding.profileHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(storedBinding.profileHash) || typeof storedBinding.walletAddress !== "string" ||
    !(storedBinding.x402Solana === undefined ? /^0x[0-9a-fA-F]{40}$/u.test(storedBinding.walletAddress) : solanaAccount(storedBinding.walletAddress)) ||
    typeof storedBinding.walletBindingHash !== "string" ||
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

function corrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
