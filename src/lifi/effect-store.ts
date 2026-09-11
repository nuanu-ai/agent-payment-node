import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import type { BridgeSealedMaterial } from "./ports.js";
import { bridgeExact, bridgeFailure, bridgeHash, bridgeHex, bridgeSame } from "./validation.js";
import { verifyBridgeSigned } from "./transaction.js";

const VERSION = "apn.bridge-effect-envelope.v1" as const;
interface Header { readonly schemaVersion: typeof VERSION; readonly profileHash: string; readonly operationId: string;
  readonly role: "approval" | "bridge"; readonly fingerprint: string; readonly envelopeHash: string;
  readonly kdf: { readonly name: "HKDF-SHA-256"; readonly salt: string };
  readonly cipher: { readonly name: "AES-256-GCM"; readonly nonce: string } }
interface Envelope extends Omit<Header, "cipher"> { readonly cipher: Header["cipher"] & { readonly ciphertext: string; readonly tag: string } }
export class BridgeEffectStore extends SecureStateStore {
  constructor(root: string, private readonly wrappingSecret: WrappingSecretPort) { super(root); }
  async load(op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<BridgeSealedMaterial | null> {
    const raw = await this.readJson(this.path(op, role));
    if (raw === null) return null;
    const envelope = parseEnvelope(raw, op, role);
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_wrapping_secret_missing");
    const salt = base64(envelope.kdf.salt, 32), nonce = base64(envelope.cipher.nonce, 12),
      tag = base64(envelope.cipher.tag, 16), ciphertext = base64(envelope.cipher.ciphertext);
    const key = deriveKey(wrapping, salt, envelope);
    let plaintext = Buffer.alloc(0);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      decipher.setAAD(Buffer.from(canonicalJson(headerOf(envelope)), "utf8")); decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), value: unknown = JSON.parse(text);
      if (canonicalJson(value) !== text) bridgeFailure("APN_STATE_CORRUPT", "bridge_effect_canonical_plaintext");
      return await validateMaterial(value, op, role);
    } catch (error) {
      if (error instanceof ApnError) throw error;
      return bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_effect_authentication");
    } finally { wrapping.fill(0); key.fill(0); salt.fill(0); nonce.fill(0); tag.fill(0); ciphertext.fill(0); plaintext.fill(0); }
  }
  async seal(op: BridgeOperationRecord, material: BridgeSealedMaterial): Promise<BridgeSealedMaterial> {
    await validateMaterial(material, op, material.role);
    const existing = await this.load(op, material.role);
    if (existing !== null) {
      if (!bridgeSame(existing, material)) bridgeFailure("APN_STATE_CORRUPT", "bridge_effect_already_sealed");
      return existing;
    }
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_wrapping_secret_missing");
    const salt = randomBytes(32), nonce = randomBytes(12);
    const header: Header = { schemaVersion: VERSION, profileHash: op.profileHash, operationId: op.operationId,
      role: material.role, fingerprint: op.fingerprint, envelopeHash: material.envelopeHash,
      kdf: { name: "HKDF-SHA-256", salt: salt.toString("base64") }, cipher: { name: "AES-256-GCM", nonce: nonce.toString("base64") } };
    const key = deriveKey(wrapping, salt, header), plaintext = Buffer.from(canonicalJson(material), "utf8");
    let ciphertext = Buffer.alloc(0);
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
      ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      await this.initialize(); await this.ensureDirectory(`bridge-effects/${op.profileHash}`);
      await this.writeJson(this.path(op, material.role), { ...header,
        cipher: { ...header.cipher, ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") } });
      return material;
    } finally { wrapping.fill(0); salt.fill(0); nonce.fill(0); key.fill(0); plaintext.fill(0); ciphertext.fill(0); }
  }
  private path(op: BridgeOperationRecord, role: "approval" | "bridge"): string {
    stateIdentifier(op.profileHash, "bridge effect profile"); stateIdentifier(op.operationId, "bridge effect operation");
    if (role !== "approval" && role !== "bridge") bridgeFailure("APN_STATE_CORRUPT", "bridge_effect_role");
    return `bridge-effects/${op.profileHash}/${op.operationId}-${role}.json`;
  }
}
export async function validateMaterial(value: unknown, op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<BridgeSealedMaterial> {
  const r = bridgeExact(value, ["schemaVersion", "profileHash", "operationId", "role", "fingerprint", "envelopeHash", "rawTransaction", "transactionHash", "materialHash"]);
  const e = op.effects.find((e) => e.role === role);
  if (e === undefined || r.schemaVersion !== "apn.bridge-effect.v1" || r.profileHash !== op.profileHash || r.operationId !== op.operationId ||
    r.role !== role || r.fingerprint !== op.fingerprint || r.envelopeHash !== e.envelope.envelopeHash) bridgeFailure("APN_STATE_CORRUPT", "bridge_effect_identity");
  bridgeHash(r.materialHash); const { materialHash, ...body } = r;
  if (materialHash !== hashObject(body)) bridgeFailure("APN_STATE_CORRUPT", "bridge_effect_hash");
  const raw = bridgeHex(r.rawTransaction, 16 * 1024, undefined, "APN_STATE_CORRUPT"), tx = bridgeHex(r.transactionHash, 32, 32, "APN_STATE_CORRUPT");
  if ((e.transactionHash !== null && e.transactionHash !== tx) || (e.sealedMaterialHash !== null && e.sealedMaterialHash !== materialHash)) bridgeFailure("APN_STATE_CORRUPT", "bridge_committed_material_identity");
  await verifyBridgeSigned(raw, tx, e.envelope);
  return r as unknown as BridgeSealedMaterial;
}
function parseEnvelope(value: unknown, op: BridgeOperationRecord, role: "approval" | "bridge"): Envelope {
  const e = bridgeExact(value, ["schemaVersion", "profileHash", "operationId", "role", "fingerprint", "envelopeHash", "kdf", "cipher"]);
  const k = bridgeExact(e.kdf, ["name", "salt"]), c = bridgeExact(e.cipher, ["name", "nonce", "ciphertext", "tag"]);
  if (e.schemaVersion !== VERSION || e.profileHash !== op.profileHash || e.operationId !== op.operationId || e.role !== role ||
    e.fingerprint !== op.fingerprint || e.envelopeHash !== op.effects.find((v) => v.role === role)?.envelope.envelopeHash ||
    k.name !== "HKDF-SHA-256" || c.name !== "AES-256-GCM" ||
    [k.salt, c.nonce, c.ciphertext, c.tag].some((v) => typeof v !== "string")) bridgeFailure("APN_STATE_CORRUPT", "bridge_effect_envelope");
  return e as unknown as Envelope;
}
function headerOf(e: Envelope): Header { return { ...e, cipher: { name: e.cipher.name, nonce: e.cipher.nonce } }; }
function deriveKey(wrapping: Buffer, salt: Buffer, e: Header): Buffer {
  return Buffer.from(hkdfSync("sha256", wrapping, salt, Buffer.from(`${VERSION}\0${e.profileHash}\0${e.operationId}\0${e.role}\0${e.fingerprint}\0${e.envelopeHash}`), 32));
}
function base64(value: string, length?: number): Buffer {
  const b = Buffer.from(value, "base64");
  if (b.length === 0 || b.length > 64 * 1024 || b.toString("base64") !== value || (length !== undefined && b.length !== length)) {
    b.fill(0); bridgeFailure("APN_STATE_CORRUPT", "bridge_effect_encoding");
  }
  return b;
}
