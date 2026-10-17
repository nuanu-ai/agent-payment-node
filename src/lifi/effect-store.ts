import { hashObject } from "../canonical.js";
import { openNested, sealNested, type EnvelopeSpec } from "../custody-envelope.js";
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
const ENVELOPE: EnvelopeSpec<Header> = {
  info: e => `${VERSION}\0${e.profileHash}\0${e.operationId}\0${e.role}\0${e.fingerprint}\0${e.envelopeHash}`,
  aad: e => e,
  maxFieldBytes: 64 * 1024,
  fail: failure => failure === "authentication" ? bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_effect_authentication")
    : bridgeFailure("APN_STATE_CORRUPT", failure === "canonical_plaintext" ? "bridge_effect_canonical_plaintext" : "bridge_effect_encoding"),
};
export class BridgeEffectStore extends SecureStateStore {
  constructor(root: string, private readonly wrappingSecret: WrappingSecretPort) { super(root); }
  async load(op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<BridgeSealedMaterial | null> {
    const raw = await this.readJson(this.path(op, role));
    if (raw === null) return null;
    const envelope = parseEnvelope(raw, op, role);
    const wrapping = await this.wrappingSecret.load();
    if (wrapping === null) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_wrapping_secret_missing");
    try { return await openNested(wrapping, ENVELOPE, envelope, async value => await validateMaterial(value, op, role)); }
    finally { wrapping.fill(0); }
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
    try {
      const envelope = sealNested(wrapping, ENVELOPE, { schemaVersion: VERSION, profileHash: op.profileHash, operationId: op.operationId,
        role: material.role, fingerprint: op.fingerprint, envelopeHash: material.envelopeHash }, material);
      await this.initialize(); await this.ensureDirectory(`bridge-effects/${op.profileHash}`);
      await this.writeJson(this.path(op, material.role), envelope);
      return material;
    } finally { wrapping.fill(0); }
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
