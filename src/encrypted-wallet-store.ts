import { randomBytes } from "node:crypto";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { domainHash, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { CHAIN_ID } from "./constants.js";
import { openNested, sealNested, type EnvelopeSpec, type NestedHeader } from "./custody-envelope.js";
import { ApnError } from "./errors.js";
import type { Address, Hex } from "./model.js";
import type { StateStore } from "./state.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import { listEncryptedWalletEnvelopes, listLocalProviderProfiles, listLocalWallets } from "./wallet-import-collision.js";
import { releaseSettledWalletEffects } from "./wallet-effect-retention.js";

const ENVELOPE_VERSION = "apn.wallet-envelope.v1";
const SECRET_VERSION = "apn.wallet-secret.v1";
const KDF_NAME = "HKDF-SHA-256";
const CIPHER_NAME = "AES-256-GCM";
const HASH = /^[a-f0-9]{64}$/u;
const PRIVATE_KEY = /^0x[0-9a-f]{64}$/u;
const HEX32 = /^0x[0-9a-f]{64}$/u;
const SIGNATURE = /^0x[0-9a-f]{130}$/u;
const RAW_TRANSACTION = /^0x(?:[0-9a-f]{2})+$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

export interface WalletIdentity {
  readonly profile: string;
  readonly address: Address;
  readonly chainId: typeof CHAIN_ID;
  readonly createdAt: string;
  readonly bindingHash: string;
}

export interface DirectEffectMaterial {
  readonly payloadHash: string;
  readonly transactionHash: Hex;
  readonly rawTransaction: Hex;
  readonly rawTransactionHash: Hex;
  readonly primaryProviderId?: string | null;
  /** The generic direct-transfer operation that owns this slot; the slot is released once it is terminal. */
  readonly operationId?: string;
}

export interface X402EffectMaterial {
  readonly createPayloadHash: string;
  readonly recoveryBindingHash: string;
  readonly authorization: Readonly<Record<string, string>>;
  readonly signature: Hex;
  readonly signatureHash: string;
}

export interface WalletSecretState {
  version: typeof SECRET_VERSION;
  privateKey: Hex;
  directEffects: Record<string, DirectEffectMaterial>;
  x402Effects: Record<string, X402EffectMaterial>;
}

/** One kernel-backed critical section owns every encrypted local-wallet mutation for a profile. */
export function walletCustodyLock(state: StateStore, profileInput: string): string {
  return `custody:${state.profileHash(canonicalProfile(profileInput))}`;
}

interface WalletEnvelope {
  readonly schemaVersion: typeof ENVELOPE_VERSION;
  readonly identity: WalletIdentity;
  readonly kdf: { readonly name: typeof KDF_NAME; readonly salt: string };
  readonly cipher: {
    readonly name: typeof CIPHER_NAME;
    readonly nonce: string;
    readonly ciphertext: string;
    readonly tag: string;
  };
}

const ENVELOPE: EnvelopeSpec<{ readonly schemaVersion: typeof ENVELOPE_VERSION; readonly identity: WalletIdentity } & NestedHeader> = {
  info: header => `${ENVELOPE_VERSION}\0${header.identity.profile}`,
  aad: header => header,
  maxFieldBytes: null,
  fail: (failure, field) => corrupt(failure === "authentication" ? "Wallet authentication or decryption failed."
    : failure === "canonical_plaintext" ? "Wallet plaintext is not canonical." : `Wallet ${field} encoding is invalid.`),
};

export class EncryptedWalletStore {
  constructor(
    private readonly state: StateStore,
    private readonly wrappingSecret: WrappingSecretPort,
  ) {}

  async describe(profileInput: string, beforeDecrypt?: () => void, beforeKeyLoad?: (identity: WalletIdentity) => Promise<void>): Promise<{ readonly identity: WalletIdentity; readonly secret: WalletSecretState } | null> {
    const profile = canonicalProfile(profileInput);
    const value = await this.state.loadEncryptedWalletEnvelope(profile);
    if (value === null) {
      if (beforeKeyLoad !== undefined) throw new ApnError("APN_PROFILE_DRIFT", "Frozen native custody has no wallet envelope.");
      // A native describe against incomplete public state still exercises the
      // production Keychain query without creating a wrapping secret.
      const probe = await this.wrappingSecret.load();
      probe?.fill(0);
      return null;
    }
    const envelope = parseEnvelope(value, profile);
    if (beforeKeyLoad !== undefined) await beforeKeyLoad(envelope.identity);
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) {
      throw new ApnError("APN_STATE_CORRUPT", "The encrypted wallet exists but its wrapping secret is missing.");
    }
    try {
      if (beforeKeyLoad !== undefined) await beforeKeyLoad(envelope.identity);
      beforeDecrypt?.();
      return { identity: envelope.identity, secret: await decryptEnvelope(envelope, wrapping) };
    } finally {
      wrapping.fill(0);
    }
  }

  async ensure(profileInput: string): Promise<{ readonly identity: WalletIdentity; readonly secret: WalletSecretState }> {
    const profile = canonicalProfile(profileInput);
    const current = await this.describe(profile);
    if (current !== null) return current;

    const wrapping = await this.wrappingSecret.create();
    let privateKey = randomPrivateKey();
    try {
      const account = privateKeyToAccount(privateKey);
      const createdAt = new Date().toISOString();
      const identity: WalletIdentity = {
        profile,
        address: account.address,
        chainId: CHAIN_ID,
        createdAt,
        bindingHash: hashObject({ profile, address: account.address, createdAt }),
      };
      const secret: WalletSecretState = {
        version: SECRET_VERSION,
        privateKey,
        directEffects: {},
        x402Effects: {},
      };
      await this.save(identity, secret, wrapping);
      return { identity, secret };
    } finally {
      privateKey = `0x${"0".repeat(64)}` as Hex;
      void privateKey;
      wrapping.fill(0);
    }
  }

  async importNew(profileInput: string, privateKeyInput: string, expectedAddress: string): Promise<WalletIdentity> {
    const profile = canonicalProfile(profileInput);
    if (!PRIVATE_KEY.test(privateKeyInput)) throw new ApnError("APN_INVALID_INPUT", "Wallet key encoding is invalid.");
    let address: Address;
    try { address = privateKeyToAccount(privateKeyInput as Hex).address; }
    catch { throw new ApnError("APN_INVALID_INPUT", "Wallet key scalar is invalid."); }
    if (address !== canonicalAddress(expectedAddress) || expectedAddress !== address) {
      throw new ApnError("APN_WALLET_MISMATCH", "Imported wallet address does not match the expected checksum address.");
    }
    if (await this.state.loadEncryptedWalletEnvelope(profile) !== null) {
      throw new ApnError("APN_PROFILE_DRIFT", "Wallet profile is already occupied.");
    }
    for (const wallet of await listLocalWallets(this.state)) {
      if (wallet.address.toLowerCase() === address.toLowerCase()) {
        throw new ApnError("APN_PROFILE_DRIFT", "Wallet address already belongs to a local profile.");
      }
    }
    for (const provider of await listLocalProviderProfiles(this.state)) {
      if (provider.public_address.toLowerCase() === address.toLowerCase()) {
        throw new ApnError("APN_PROFILE_DRIFT", "Wallet address already belongs to a local profile.");
      }
    }
    for (const entry of await listEncryptedWalletEnvelopes(this.state)) {
      if (parseEnvelope(entry.value, entry.profile).identity.address.toLowerCase() === address.toLowerCase()) {
        throw new ApnError("APN_PROFILE_DRIFT", "Wallet address already belongs to a local profile.");
      }
    }
    const wrapping = await this.wrappingSecret.create();
    const createdAt = new Date().toISOString();
    const identity: WalletIdentity = { profile, address, chainId: CHAIN_ID, createdAt,
      bindingHash: hashObject({ profile, address, createdAt }) };
    const secret: WalletSecretState = { version: SECRET_VERSION, privateKey: privateKeyInput as Hex,
      directEffects: {}, x402Effects: {} };
    try {
      await this.save(identity, secret, wrapping, true);
      return identity;
    } finally {
      this.clear(secret);
      wrapping.fill(0);
    }
  }

  async save(identity: WalletIdentity, secret: WalletSecretState, wrappingInput?: Buffer, createOnly = false): Promise<void> {
    // Signed material is kept only while it can still be used, so the envelope stays bounded under the state-file cap.
    if (!createOnly) await releaseSettledWalletEffects(this.state, identity.profile, secret, Date.now());
    const wrapping = wrappingInput === undefined ? await this.requiredWrappingSecret() : Buffer.from(wrappingInput);
    try {
      const envelope: WalletEnvelope = sealNested(wrapping, ENVELOPE, { schemaVersion: ENVELOPE_VERSION, identity }, secret);
      if (createOnly) await this.state.writeNewEncryptedWalletEnvelope(identity.profile, envelope);
      else await this.state.writeEncryptedWalletEnvelope(identity.profile, envelope);
    } finally {
      wrapping.fill(0);
    }
  }

  clear(secret: WalletSecretState): void {
    secret.privateKey = `0x${"0".repeat(64)}` as Hex;
    secret.directEffects = {};
    secret.x402Effects = {};
  }

  private async requiredWrappingSecret(): Promise<Buffer> {
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) throw new ApnError("APN_STATE_CORRUPT", "The wallet wrapping secret is missing.");
    return wrapping;
  }
}

async function decryptEnvelope(envelope: WalletEnvelope, wrapping: Buffer): Promise<WalletSecretState> {
  return await openNested(wrapping, ENVELOPE, envelope, value => {
    const secret = parseSecret(value);
    if (privateKeyToAccount(secret.privateKey).address !== envelope.identity.address) {
      corrupt("Wallet key does not match authenticated identity.");
    }
    return secret;
  });
}

function parseEnvelope(value: unknown, profile: string): WalletEnvelope {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "identity", "kdf", "cipher"])) corrupt("Wallet envelope schema is invalid.");
  if (value.schemaVersion !== ENVELOPE_VERSION) corrupt("Wallet envelope version is unsupported.");
  if (!isPlainRecord(value.identity) || !exactKeys(value.identity, ["profile", "address", "chainId", "createdAt", "bindingHash"])) corrupt("Wallet identity schema is invalid.");
  const identity = value.identity;
  if (
    identity.profile !== profile || identity.chainId !== CHAIN_ID || typeof identity.address !== "string" ||
    canonicalAddress(identity.address) !== identity.address || typeof identity.createdAt !== "string" ||
    !Number.isFinite(Date.parse(identity.createdAt)) || typeof identity.bindingHash !== "string" || !HASH.test(identity.bindingHash)
  ) corrupt("Wallet identity fields are invalid.");
  if (identity.bindingHash !== hashObject({ profile, address: identity.address, createdAt: identity.createdAt })) {
    corrupt("Wallet identity binding is invalid.");
  }
  if (!isPlainRecord(value.kdf) || !exactKeys(value.kdf, ["name", "salt"]) || value.kdf.name !== KDF_NAME || typeof value.kdf.salt !== "string") corrupt("Wallet KDF metadata is invalid.");
  if (!isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "nonce", "ciphertext", "tag"]) || value.cipher.name !== CIPHER_NAME) corrupt("Wallet cipher metadata is invalid.");
  for (const key of ["nonce", "ciphertext", "tag"] as const) if (typeof value.cipher[key] !== "string") corrupt("Wallet cipher encoding is invalid.");
  return value as unknown as WalletEnvelope;
}

/** Validate public envelope identity without loading or exposing the signing key. */
export function walletEnvelopeIdentity(value: unknown, profile: string): WalletIdentity {
  return parseEnvelope(value, profile).identity;
}

function parseSecret(value: unknown): WalletSecretState {
  if (!isPlainRecord(value) || !exactKeys(value, ["version", "privateKey", "directEffects", "x402Effects"]) || value.version !== SECRET_VERSION) corrupt("Wallet secret schema is invalid.");
  if (typeof value.privateKey !== "string" || !PRIVATE_KEY.test(value.privateKey)) corrupt("Wallet private key encoding is invalid.");
  const directEffects = parseDirectEffects(value.directEffects);
  const x402Effects = parseX402Effects(value.x402Effects);
  return { version: SECRET_VERSION, privateKey: value.privateKey as Hex, directEffects, x402Effects };
}

function parseDirectEffects(value: unknown): Record<string, DirectEffectMaterial> {
  if (!isPlainRecord(value)) corrupt("Wallet effect map is invalid.");
  for (const [slot, item] of Object.entries(value)) {
    if (
      !HASH.test(slot) || !isPlainRecord(item) ||
      !exactKeys(item, ["payloadHash", "transactionHash", "rawTransaction", "rawTransactionHash",
        ...(item.primaryProviderId === undefined ? [] : ["primaryProviderId"]), ...(item.operationId === undefined ? [] : ["operationId"])]) ||
      (item.operationId !== undefined && (typeof item.operationId !== "string" || !HASH.test(item.operationId))) ||
      typeof item.payloadHash !== "string" || !HASH.test(item.payloadHash) ||
      typeof item.transactionHash !== "string" || !HEX32.test(item.transactionHash) ||
      typeof item.rawTransactionHash !== "string" || !HEX32.test(item.rawTransactionHash) ||
      typeof item.rawTransaction !== "string" || !RAW_TRANSACTION.test(item.rawTransaction) ||
      item.rawTransaction.length > 16_386 || item.primaryProviderId !== undefined && item.primaryProviderId !== null &&
        (typeof item.primaryProviderId !== "string" || !HASH.test(item.primaryProviderId))
    ) corrupt("Wallet direct-effect entry is invalid.");
    const computed = keccak256(item.rawTransaction as Hex);
    if (computed !== item.rawTransactionHash || computed !== item.transactionHash) {
      corrupt("Wallet direct-effect hashes are invalid.");
    }
  }
  return value as Record<string, DirectEffectMaterial>;
}

function parseX402Effects(value: unknown): Record<string, X402EffectMaterial> {
  if (!isPlainRecord(value)) corrupt("Wallet effect map is invalid.");
  for (const [slot, item] of Object.entries(value)) {
    if (
      !HASH.test(slot) || !isPlainRecord(item) ||
      !exactKeys(item, ["createPayloadHash", "recoveryBindingHash", "authorization", "signature", "signatureHash"]) ||
      typeof item.createPayloadHash !== "string" || !HASH.test(item.createPayloadHash) ||
      typeof item.recoveryBindingHash !== "string" || !HASH.test(item.recoveryBindingHash) ||
      typeof item.signature !== "string" || !SIGNATURE.test(item.signature) ||
      typeof item.signatureHash !== "string" || !HASH.test(item.signatureHash) ||
      !validStoredAuthorization(item.authorization)
    ) corrupt("Wallet x402-effect entry is invalid.");
    const computed = domainHash("apn.x402.signature.v1", Buffer.from(item.signature.slice(2), "hex"));
    if (computed !== item.signatureHash) corrupt("Wallet x402 signature hash is invalid.");
  }
  return value as Record<string, X402EffectMaterial>;
}

function validStoredAuthorization(value: unknown): value is Readonly<Record<string, string>> {
  if (!isPlainRecord(value) || !exactKeys(value, ["from", "to", "value", "validAfter", "validBefore", "nonce"])) return false;
  if (
    typeof value.from !== "string" || typeof value.to !== "string" ||
    value.from !== value.from.toLowerCase() || value.to !== value.to.toLowerCase() ||
    typeof value.value !== "string" || !DECIMAL.test(value.value) || value.value === "0" ||
    value.validAfter !== "0" || typeof value.validBefore !== "string" || !DECIMAL.test(value.validBefore) ||
    typeof value.nonce !== "string" || !HEX32.test(value.nonce)
  ) return false;
  try {
    canonicalAddress(value.from);
    canonicalAddress(value.to);
    return true;
  } catch {
    return false;
  }
}

function randomPrivateKey(): Hex {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = `0x${randomBytes(32).toString("hex")}` as Hex;
    try {
      privateKeyToAccount(candidate);
      return candidate;
    } catch { /* try another valid secp256k1 scalar */ }
  }
  throw new ApnError("APN_INTERNAL", "Unable to create a wallet safely.");
}

function corrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
