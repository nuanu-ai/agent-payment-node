import { assertCircleEffectGuard } from "./lifecycle.js";
import { isSealedBurnRetirement } from "./burn-retirement.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex, type TransactionSerialized } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { circleBlocked, circleCorrupt, circleSame, validateCircle, type CircleEffect, type CircleOperationV1, type CircleRole } from "./operation-model.js";
export interface CircleMaterial { readonly schemaVersion: "apn.circle-v2-evm-effect.v1"; readonly operationId: string; readonly role: CircleRole;
  readonly fingerprint: string; readonly envelopeHash: string; readonly rawTransaction: Hex; readonly transactionHash: Hex; readonly materialHash: string; }
const VERSION = "apn.circle-v2-evm-effect-envelope.v1";
interface Header { readonly schemaVersion: typeof VERSION; readonly operationId: string; readonly role: CircleRole; readonly fingerprint: string;
  readonly envelopeHash: string; readonly salt: string; readonly nonce: string; }
interface EncryptedMaterial extends Header { readonly ciphertext: string; readonly tag: string; }
export class CircleEffectStore extends SecureStateStore {
  constructor(root: string, private readonly wrapping: WrappingSecretPort) { super(root); }
  private path(op: CircleOperationV1, role: CircleRole) { validateCircle(op); return `circle-v2-evm-effects/${op.operationId}-${role}.json`; }
  /** Public historical verification only: returns headers, never ciphertext, tag or plaintext. */
  async historicalPaidHeaders(op: CircleOperationV1, includeMint = false): Promise<readonly { readonly schemaVersion: string; readonly operationId: string; readonly role: CircleRole; readonly fingerprint: string; readonly envelopeHash: string; readonly salt: string; readonly nonce: string }[]> {
    validateCircle(op); const result = [];
    for (const effect of op.effects.filter(e => includeMint || e.role !== "mint")) {
      const value = await this.readJson(this.path(op, effect.role));
      if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "role", "fingerprint", "envelopeHash", "salt", "nonce", "ciphertext", "tag"]) || value.schemaVersion !== VERSION || value.operationId !== op.operationId || value.role !== effect.role || value.fingerprint !== op.fingerprint || value.envelopeHash !== effect.envelope.envelopeHash || typeof value.ciphertext !== "string" || value.ciphertext.length === 0 || typeof value.salt !== "string" || typeof value.nonce !== "string" || typeof value.tag !== "string") circleBlocked("historical_paid_material_header_required");
      const salt = base64(value.salt, 32), nonce = base64(value.nonce, 12), tag = base64(value.tag, 16); salt.fill(0); nonce.fill(0); tag.fill(0);
      result.push(Object.freeze({ schemaVersion: VERSION, operationId: op.operationId, role: effect.role, fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash, salt: String(value.salt), nonce: String(value.nonce) }));
    }
    return Object.freeze(result);
  }
  async assertExternalAbsent(op: CircleOperationV1): Promise<void> { validateCircle(op); const entries=await this.readDirectory("circle-v2-evm-effects"); for (const role of ["mint", "cleanup"] as const) if (entries.some(entry=>entry.name===`${op.operationId}-${role}.json`)) circleBlocked("external_owned_material_present"); }
  async assertCleanupAbsent(op: CircleOperationV1): Promise<void> { if (await this.readJson(this.path(op, "cleanup")) !== null) circleBlocked("retirement_unclaimed_cleanup_material_present"); }
  async assertRetirementHeaders(op: CircleOperationV1): Promise<void> {
    if (isSealedBurnRetirement(op)) {
      for (const effect of op.effects.slice(0, 2)) {
        const e = await this.readJson(this.path(op, effect.role));
        if (!isPlainRecord(e) || !exactKeys(e, ["schemaVersion", "operationId", "role", "fingerprint", "envelopeHash", "salt", "nonce", "ciphertext", "tag"]) || e.schemaVersion !== VERSION ||
          e.operationId !== op.operationId || e.role !== effect.role || e.fingerprint !== op.fingerprint || e.envelopeHash !== effect.envelope.envelopeHash || typeof e.ciphertext !== "string" || e.ciphertext.length === 0) circleBlocked("retirement_burn_material_header_required");
      }
      return;
    }
    const approval = op.effects[0]!, burn = op.effects[1]!;
    const value = await this.readJson(this.path(op, "approval"));
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "role", "fingerprint", "envelopeHash", "salt", "nonce", "ciphertext", "tag"]) ||
      value.schemaVersion !== VERSION || value.operationId !== op.operationId || value.role !== "approval" || value.fingerprint !== op.fingerprint || value.envelopeHash !== approval.envelope.envelopeHash ||
      typeof value.ciphertext !== "string" || value.ciphertext.length === 0 || await this.readJson(this.path(op, burn.role)) !== null) circleBlocked("retirement_original_material_or_burn_guard");
  }
  async load(op: CircleOperationV1, effect: CircleEffect): Promise<CircleMaterial | null> {
    const value = await this.readJson(this.path(op, effect.role)); if (value === null) return null;
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "role", "fingerprint", "envelopeHash", "salt", "nonce", "ciphertext", "tag"])) circleCorrupt("material_envelope");
    const e = value as unknown as EncryptedMaterial;
    if (e.schemaVersion !== VERSION || e.operationId !== op.operationId || e.role !== effect.role || e.fingerprint !== op.fingerprint || e.envelopeHash !== effect.envelope.envelopeHash) circleCorrupt("material_binding");
    const wrapping = await this.wrapping.load(); if (wrapping === null) circleBlocked("wrapping_secret_missing");
    const salt = base64(e.salt, 32), nonce = base64(e.nonce, 12), ciphertext = base64(e.ciphertext), tag = base64(e.tag, 16), key = derive(wrapping, salt, e);
    let plaintext = Buffer.alloc(0);
    try {
      const { ciphertext: _cipher, tag: _tag, ...header } = e, decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(Buffer.from(canonicalJson(header))); decipher.setAuthTag(tag); plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), material: unknown = JSON.parse(text);
      if (canonicalJson(material) !== text) circleCorrupt("material_plaintext"); return await verifyCircleMaterial(op, effect, material);
    } finally { wrapping.fill(0); salt.fill(0); nonce.fill(0); ciphertext.fill(0); tag.fill(0); key.fill(0); plaintext.fill(0); }
  }
  async save(op: CircleOperationV1, effect: CircleEffect, material: CircleMaterial): Promise<CircleMaterial> {
    await verifyCircleMaterial(op, effect, material); const existing = await this.load(op, effect);
    if (existing !== null) { if (!circleSame(existing, material)) circleCorrupt("material_replacement"); return existing; }
    const wrapping = await this.wrapping.load(); if (wrapping === null) circleBlocked("wrapping_secret_missing");
    const salt = randomBytes(32), nonce = randomBytes(12), header: Header = { schemaVersion: VERSION, operationId: op.operationId, role: effect.role,
      fingerprint: op.fingerprint, envelopeHash: effect.envelope.envelopeHash, salt: salt.toString("base64"), nonce: nonce.toString("base64") }, key = derive(wrapping, salt, header), plaintext = Buffer.from(canonicalJson(material));
    let ciphertext = Buffer.alloc(0);
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(Buffer.from(canonicalJson(header)));
      ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]); await this.initialize(); await this.ensureDirectory("circle-v2-evm-effects");
      await this.writeJson(this.path(op, effect.role), { ...header, ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") }, true);
      return material;
    } finally { wrapping.fill(0); salt.fill(0); nonce.fill(0); key.fill(0); plaintext.fill(0); ciphertext.fill(0); }
  }
}
export class LocalCircleCustody {
  private readonly wallets: EncryptedWalletStore; private readonly material: CircleEffectStore;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort) { this.wallets = new EncryptedWalletStore(state, wrapping); this.material = new CircleEffectStore(state.root, wrapping); }
  async assertCleanupAbsent(op: CircleOperationV1) { return this.material.assertCleanupAbsent(op); }
  async assertRetirementHeaders(op: CircleOperationV1) { return this.material.assertRetirementHeaders(op); }
  async load(op: CircleOperationV1, effect: CircleEffect) { return await this.material.load(op, effect); }
  async seal(op: CircleOperationV1, effect: CircleEffect, guard: () => void): Promise<CircleMaterial> {
    guard(); if (effect.role === "approval" || effect.role === "burn") await new CircleNonceRetirementStore(this.state.root).assertOriginalEffectsAvailable(op.operationId); guard(); if (effect.role === "cleanup" && await new CircleNonceRetirementStore(this.state.root).intent(op) !== null) { assertCircleEffectGuard(op, effect, guard); await new CircleNonceRetirementStore(this.state.root).assertClaim(op, "sign"); } guard(); if (op.terminal || effect.phase !== "signing_started") circleBlocked("signing_gate");
    const destination = effect.role === "mint", profile = destination ? op.destinationProfile : op.profile, custody = destination ? op.destinationCustody : op.sourceCustody;
    return this.state.withLocks([`custody:${custody.profileHash}`], async () => {
      guard(); await assertEvmNativeCustody(this.state, profile, custody); guard(); const existing = await this.material.load(op, effect); guard(); if (existing !== null) return existing;
      const wallet = await this.wallets.describe(profile, undefined, identity => { guard(); return assertEvmNativeCustody(this.state, profile, custody, identity); });
      if (wallet === null) circleBlocked("encrypted_wallet_missing");
      try {
        guard(); const account = privateKeyToAccount(wallet.secret.privateKey); if (account.address !== custody.walletAddress) circleBlocked("derived_owner_mismatch");
        guard(); const e = effect.envelope, rawTransaction = await account.signTransaction({ type: "eip1559", chainId: e.chainId, to: e.to, data: e.data,
          value: 0n, nonce: Number(e.nonceAtomic), gas: BigInt(e.gasLimitAtomic), maxFeePerGas: BigInt(e.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGasAtomic), accessList: [] });
        guard(); const body = { schemaVersion: "apn.circle-v2-evm-effect.v1" as const, operationId: op.operationId, role: effect.role, fingerprint: op.fingerprint,
          envelopeHash: e.envelopeHash, rawTransaction, transactionHash: keccak256(rawTransaction) };
        return await this.material.save(op, effect, { ...body, materialHash: hashObject(body) });
      } finally { this.wallets.clear(wallet.secret); }
    });
  }
}
export async function verifyCircleMaterial(op: CircleOperationV1, effect: CircleEffect, input: unknown): Promise<CircleMaterial> {
  if (!isPlainRecord(input) || !exactKeys(input, ["schemaVersion", "operationId", "role", "fingerprint", "envelopeHash", "rawTransaction", "transactionHash", "materialHash"])) circleCorrupt("material_shape");
  const material = input as unknown as CircleMaterial, { materialHash, ...body } = material, e = effect.envelope;
  if (hashObject(body) !== materialHash || material.schemaVersion !== "apn.circle-v2-evm-effect.v1" || material.operationId !== op.operationId || material.role !== effect.role || material.fingerprint !== op.fingerprint || material.envelopeHash !== e.envelopeHash ||
    typeof material.rawTransaction !== "string" || !/^0x(?:[a-f0-9]{2})+$/u.test(material.rawTransaction) || material.rawTransaction.length > 32770 ||
    keccak256(material.rawTransaction) !== material.transactionHash || effect.transactionHash !== null && effect.transactionHash !== material.transactionHash || effect.materialHash !== null && effect.materialHash !== materialHash) circleCorrupt("material_identity");
  const t = parseTransaction(material.rawTransaction), from = getAddress(await recoverTransactionAddress({ serializedTransaction: material.rawTransaction as TransactionSerialized }));
  if (t.type !== "eip1559" || t.chainId !== e.chainId || from !== e.from || t.to === undefined || t.to === null || getAddress(t.to) !== e.to || (t.data ?? "0x") !== e.data || (t.value ?? 0n) !== 0n ||
    String(t.nonce) !== e.nonceAtomic || String(t.gas) !== e.gasLimitAtomic || String(t.maxFeePerGas) !== e.maxFeePerGasAtomic || String(t.maxPriorityFeePerGas ?? 0n) !== e.maxPriorityFeePerGasAtomic ||
    (t.accessList ?? []).length !== 0 || t.r === undefined || t.s === undefined || BigInt(t.s) < 1n || BigInt(t.s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n ||
    (t.yParity !== 0 && t.yParity !== 1) || serializeTransaction(t, { r: t.r, s: t.s, yParity: t.yParity }) !== material.rawTransaction) circleCorrupt("signed_transaction");
  return material;
}
function derive(wrapping: Buffer, salt: Buffer, h: Header) { return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${VERSION}\0${h.operationId}\0${h.role}\0${h.fingerprint}\0${h.envelopeHash}`), 32)); }
function base64(input: string, length?: number) { if (typeof input !== "string") circleCorrupt("material_encoding"); const b = Buffer.from(input, "base64"); if (b.length === 0 || b.length > 65536 || b.toString("base64") !== input || length !== undefined && b.length !== length) circleCorrupt("material_encoding"); return b; }
