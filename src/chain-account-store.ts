import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { canonicalJson, exactKeys, hashObject, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { ChainAccount, ChainWalletStoragePort, DirectRailName, RailSignedEffect } from "./direct-rail-ports.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";
import { canonicalProfile } from "./wallet-policy.js";

const ENVELOPE = "apn.chain-wallet-envelope.v1";
const SECRET = "apn.chain-wallet-secret.v1";
const HASH = /^[a-f0-9]{64}$/u;
interface SecretState { readonly version: typeof SECRET; readonly seedHex: string; readonly effects: Record<string, RailSignedEffect> }
interface Envelope {
  readonly schemaVersion: typeof ENVELOPE;
  readonly account: ChainAccount;
  readonly salt: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
}

/** Call mutations while holding the common profile lock. No private data is projected. */
export class ChainAccountStore extends SecureStateStore implements ChainWalletStoragePort {
  private initialized: Promise<void> | undefined;
  constructor(root: string, private readonly wrappingSecret: WrappingSecretPort, options: ConstructorParameters<typeof SecureStateStore>[1] = {}) {
    super(root, options);
  }

  private async ready(): Promise<void> {
    this.initialized ??= (async () => {
      await super.initialize();
      for (const name of ["chain-accounts", "chain-wallets"]) await this.ensureDirectory(name);
    })();
    await this.initialized;
  }

  async account(profileInput: string, rail: DirectRailName): Promise<ChainAccount | null> {
    const profile = canonicalProfile(profileInput);
    assertRail(rail);
    await this.ready();
    const value = await this.readJson(this.accountPath(profile, rail));
    if (value === null) return null;
    const account = validateChainAccount(value);
    if (account.profile !== profile || account.rail !== rail || account.profileHash !== this.profileHash(profile)) corrupt();
    return account;
  }

  async ownerBinding(profileInput: string, rail: DirectRailName): Promise<ChainAccount | null> {
    const profile = canonicalProfile(profileInput); assertRail(rail);
    const account = await this.account(profile, rail);
    const stored = await this.readJson(this.walletPath(profile, rail));
    if (stored === null) return account;
    // Inspect only the envelope header structure and identity, never decrypt here.
    // A conflicting or corrupt record must block a different owner before launch.
    const envelope = parseEnvelope(stored);
    if (envelope.account.profile !== profile || envelope.account.rail !== rail ||
      account !== null && canonicalJson(account) !== canonicalJson(envelope.account)) corrupt();
    return envelope.account;
  }

  async ensureLocal(input: { readonly profile: string; readonly rail: DirectRailName; readonly create: () => Promise<{ readonly address: string; readonly seed: Buffer }> }): Promise<ChainAccount> {
    const profile = canonicalProfile(input.profile);
    assertRail(input.rail);
    const existing = await this.account(profile, input.rail);
    if (existing !== null && existing.provider !== "local") conflict();
    const stored = await this.readJson(this.walletPath(profile, input.rail));
    if (stored !== null) {
      const envelope = parseEnvelope(stored);
      if (envelope.account.profile !== profile || envelope.account.rail !== input.rail) corrupt();
      if (existing !== null && canonicalJson(envelope.account) !== canonicalJson(existing)) corrupt();
      const secret = await this.decrypt(envelope);
      validateSecret(secret);
      // Recover an interrupted first creation without generating another key.
      if (existing === null) await this.saveAccount(envelope.account);
      return envelope.account;
    }
    if (existing !== null) corrupt();
    const wrapping = await this.wrappingSecret.create();
    let seed: Buffer | undefined;
    try {
      const generated = await input.create();
      seed = generated.seed;
      if (!Buffer.isBuffer(seed) || seed.length !== 32) corrupt();
      const account = sealChainAccount({
        schemaVersion: "apn.chain-account.v1", profile, profileHash: this.profileHash(profile),
        rail: input.rail, network: "mainnet", provider: "local", custody: "local_software",
        address: generated.address, createdAt: new Date().toISOString(),
      });
      await this.saveEncrypted(account, { version: SECRET, seedHex: seed.toString("hex"), effects: {} }, wrapping);
      await this.saveAccount(account);
      return account;
    } finally { seed?.fill(0); wrapping.fill(0); }
  }

  async ensureProvider(input: { readonly profile: string; readonly rail: DirectRailName; readonly provider: "coinbase-awal"; readonly address: string }): Promise<ChainAccount> {
    const profile = canonicalProfile(input.profile);
    assertRail(input.rail);
    if (input.provider !== "coinbase-awal" || input.rail !== "solana") conflict();
    const existing = await this.account(profile, input.rail);
    if (existing !== null) {
      if (existing.provider !== input.provider || existing.address !== input.address) conflict();
      return existing;
    }
    if (await this.readJson(this.walletPath(profile, input.rail)) !== null) corrupt();
    const account = sealChainAccount({
      schemaVersion: "apn.chain-account.v1", profile, profileHash: this.profileHash(profile),
      rail: input.rail, network: "mainnet", provider: input.provider, custody: "provider_managed",
      address: input.address, createdAt: new Date().toISOString(),
    });
    await this.saveAccount(account);
    return account;
  }

  async withSeed<T>(account: ChainAccount, action: (seed: Buffer) => Promise<T>): Promise<T> {
    const secret = await this.requiredSecret(account);
    const seed = Buffer.from(secret.seedHex, "hex");
    try { return await action(seed); } finally { seed.fill(0); }
  }

  async effect(account: ChainAccount, operationId: string, fingerprint: string): Promise<RailSignedEffect | null> {
    stateIdentifier(operationId, "rail operation id");
    stateIdentifier(fingerprint, "rail fingerprint");
    const secret = await this.requiredSecret(account);
    const effect = secret.effects[operationId];
    if (effect === undefined) return null;
    if (effect.fingerprint !== fingerprint) corrupt();
    return { ...effect };
  }

  async saveEffect(account: ChainAccount, effect: RailSignedEffect): Promise<void> {
    validateEffect(effect);
    const secret = await this.requiredSecret(account);
    const existing = secret.effects[effect.operationId];
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(effect)) corrupt();
      return;
    }
    if (Object.keys(secret.effects).length >= 512) throw new ApnError("APN_OPERATION_BLOCKED", "Encrypted rail effect storage is full; existing effects were preserved.");
    const wrapping = await this.requiredWrapping();
    try { await this.saveEncrypted(account, { ...secret, effects: { ...secret.effects, [effect.operationId]: effect } }, wrapping); }
    finally { wrapping.fill(0); }
  }

  private async requiredSecret(account: ChainAccount): Promise<SecretState> {
    validateChainAccount(account);
    if (account.provider !== "local") conflict();
    const current = await this.account(account.profile, account.rail);
    if (current === null || canonicalJson(current) !== canonicalJson(account)) corrupt();
    const value = await this.readJson(this.walletPath(account.profile, account.rail));
    if (value === null) corrupt();
    const envelope = parseEnvelope(value);
    if (canonicalJson(envelope.account) !== canonicalJson(account)) corrupt();
    return await this.decrypt(envelope);
  }

  private async requiredWrapping(): Promise<Buffer> {
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null || wrapping.length !== 32) {
      wrapping?.fill(0);
      throw new ApnError("APN_STATE_CORRUPT", "The chain wallet wrapping secret is unavailable.");
    }
    return wrapping;
  }

  private async decrypt(envelope: Envelope): Promise<SecretState> {
    const wrapping = await this.requiredWrapping();
    const key = deriveKey(wrapping, decode(envelope.salt, 32), envelope.account);
    let plaintext: Buffer | undefined;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, decode(envelope.nonce, 12), { authTagLength: 16 });
      decipher.setAAD(Buffer.from(canonicalJson(header(envelope)), "utf8"));
      decipher.setAuthTag(decode(envelope.tag, 16));
      plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
      return validateSecret(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown);
    } catch { return corrupt(); }
    finally { plaintext?.fill(0); key.fill(0); wrapping.fill(0); }
  }

  private async saveEncrypted(account: ChainAccount, secret: SecretState, wrapping: Buffer): Promise<void> {
    validateChainAccount(account); validateSecret(secret);
    if (wrapping.length !== 32) corrupt();
    const salt = randomBytes(32); const nonce = randomBytes(12);
    const key = deriveKey(wrapping, salt, account);
    const envelopeHeader = { schemaVersion: ENVELOPE, account, salt: salt.toString("base64"), nonce: nonce.toString("base64") } as const;
    const plaintext = Buffer.from(canonicalJson(secret), "utf8");
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(canonicalJson(envelopeHeader), "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      await this.ensureDirectory(`chain-wallets/${account.rail}`);
      await this.writeJson(this.walletPath(account.profile, account.rail), {
        ...envelopeHeader, ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
      });
    } finally { plaintext.fill(0); key.fill(0); }
  }

  private async saveAccount(account: ChainAccount): Promise<void> {
    await this.ensureDirectory(`chain-accounts/${account.rail}`);
    await this.writeJson(this.accountPath(account.profile, account.rail), account);
  }
  private accountPath(profile: string, rail: DirectRailName): string { return `chain-accounts/${rail}/${this.profileHash(profile)}.json`; }
  private walletPath(profile: string, rail: DirectRailName): string { return `chain-wallets/${rail}/${this.profileHash(profile)}.json`; }
}

export function sealChainAccount(value: Omit<ChainAccount, "identityHash">): ChainAccount {
  return validateChainAccount({ ...value, identityHash: hashObject(value) });
}

export function validateChainAccount(value: unknown): ChainAccount {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "profile", "profileHash", "rail", "network", "provider", "custody", "address", "createdAt", "identityHash"])) corrupt();
  if (value.schemaVersion !== "apn.chain-account.v1" || value.network !== "mainnet") corrupt();
  if (typeof value.profile !== "string" || canonicalProfile(value.profile) !== value.profile || value.profileHash !== sha256(`profile\0${value.profile}`)) corrupt();
  assertRail(value.rail);
  if ((value.provider !== "local" && value.provider !== "coinbase-awal") ||
    value.custody !== (value.provider === "local" ? "local_software" : "provider_managed") ||
    (value.provider === "coinbase-awal" && value.rail !== "solana")) corrupt();
  if (typeof value.address !== "string" || !(value.rail === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u : /^T[1-9A-HJ-NP-Za-km-z]{33}$/u).test(value.address)) corrupt();
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) corrupt();
  const { identityHash, ...body } = value;
  if (typeof identityHash !== "string" || !HASH.test(identityHash) || hashObject(body) !== identityHash) corrupt();
  return value as unknown as ChainAccount;
}

function validateSecret(value: unknown): SecretState {
  if (!isPlainRecord(value) || !exactKeys(value, ["version", "seedHex", "effects"]) || value.version !== SECRET ||
    typeof value.seedHex !== "string" || !HASH.test(value.seedHex) || !isPlainRecord(value.effects)) corrupt();
  if (Object.keys(value.effects).length > 512) corrupt();
  for (const [id, effect] of Object.entries(value.effects)) {
    stateIdentifier(id, "sealed rail effect id"); validateEffect(effect);
    if (effect.operationId !== id) corrupt();
  }
  return value as unknown as SecretState;
}

function validateEffect(value: unknown): asserts value is RailSignedEffect {
  if (!isPlainRecord(value) || !exactKeys(value, ["operationId", "fingerprint", "transactionId", "rawPayload", "rawPayloadHash"])) corrupt();
  if (typeof value.operationId !== "string" || !HASH.test(value.operationId) || typeof value.fingerprint !== "string" || !HASH.test(value.fingerprint) ||
    typeof value.transactionId !== "string" || !/^[A-Za-z0-9]{32,128}$/u.test(value.transactionId) ||
    typeof value.rawPayload !== "string" || value.rawPayload.length < 1 || value.rawPayload.length > 32_768 ||
    typeof value.rawPayloadHash !== "string" || sha256(value.rawPayload) !== value.rawPayloadHash) corrupt();
}

function parseEnvelope(value: unknown): Envelope {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "account", "salt", "nonce", "ciphertext", "tag"]) || value.schemaVersion !== ENVELOPE) corrupt();
  const account = validateChainAccount(value.account);
  if (account.provider !== "local") corrupt();
  for (const field of ["salt", "nonce", "ciphertext", "tag"]) if (typeof value[field] !== "string") corrupt();
  const envelope = value as unknown as Envelope;
  decode(envelope.salt, 32); decode(envelope.nonce, 12); decode(envelope.tag, 16); decode(envelope.ciphertext);
  return envelope;
}
function header(envelope: Envelope) { const { ciphertext: _ciphertext, tag: _tag, ...value } = envelope; return value; }
function deriveKey(wrapping: Buffer, salt: Buffer, account: ChainAccount): Buffer {
  return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`apn.chain-wallet.v1\0${account.rail}\0${account.profile}\0${account.identityHash}`, "utf8"), 32));
}
function decode(value: string, length?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) corrupt();
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value || (length !== undefined && bytes.length !== length)) corrupt();
  return bytes;
}
function assertRail(rail: unknown): asserts rail is DirectRailName { if (rail !== "solana" && rail !== "tron") corrupt(); }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "The chain wallet state or effect binding is invalid."); }
function conflict(): never { throw new ApnError("APN_OPERATION_BLOCKED", "The profile is bound to a different chain account or execution owner."); }
