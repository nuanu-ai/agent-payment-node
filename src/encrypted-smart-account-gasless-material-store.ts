import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { hashDelegation } from "@metamask/delegation-core";
import { decodeDelegations, encodeDelegations, toDelegationStruct } from "@metamask/smart-accounts-kit/utils";
import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { Address, Hex } from "./model.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";
import type { StateStore } from "./state.js";
import { SA_MATERIAL_DOMAINS, saMaterialHash, saRequirementsHash, saRootContextHash } from "./smart-account-gasless/integrity.js";
import type { SmartAccountGaslessMaterialHashes, SmartAccountGaslessPayload } from "./smart-account-gasless/model.js";
import { saFail } from "./smart-account-gasless/reasons.js";

const RECORD_VERSION = "apn.smart-account-gasless-material.v1" as const;
const ENVELOPE_VERSION = "apn.smart-account-gasless-material-envelope.v1" as const;

export interface SmartAccountGaslessMaterialRecord extends SmartAccountGaslessMaterialHashes {
  readonly schema_version: typeof RECORD_VERSION;
  readonly operation_id: string;
  readonly profile_hash: string;
  readonly fingerprint: string;
  readonly request_hash: string;
  readonly root_grant_fingerprint: string;
  readonly delegation_manager: Address;
  readonly delegator: Address;
  readonly root_context: Hex;
  readonly encoded_child: Hex;
  readonly permission_context: Hex;
  readonly payment_payload_canonical_json: string;
  readonly phase: "sealed" | "exposed";
  readonly sealed_at: string;
  readonly updated_at: string;
  readonly integrity_hash: string;
}

export type UnsealedSmartAccountGaslessMaterial = Omit<SmartAccountGaslessMaterialRecord, "integrity_hash">;

export interface SmartAccountGaslessMaterialStorePort {
  load(operationId: string): Promise<SmartAccountGaslessMaterialRecord | null>;
  seal(record: UnsealedSmartAccountGaslessMaterial): Promise<SmartAccountGaslessMaterialRecord>;
  markExposed(operationId: string, updatedAt: string): Promise<SmartAccountGaslessMaterialRecord>;
}

export class EncryptedSmartAccountGaslessMaterialStore implements SmartAccountGaslessMaterialStorePort {
  private readonly files: MaterialState;
  constructor(state: StateStore, private readonly wrapping: WrappingSecretPort) {
    this.files = new MaterialState(state.root);
  }

  async load(operationId: string): Promise<SmartAccountGaslessMaterialRecord | null> {
    const value = await this.files.load(operationId);
    if (value === null) return null;
    const envelope = envelopeRecord(value, operationId);
    const secret = await this.wrapping.load();
    if (secret === null) saFail("sa_gasless_material_unavailable");
    try { return decrypt(envelope, secret); }
    finally { secret.fill(0); }
  }

  async seal(record: UnsealedSmartAccountGaslessMaterial): Promise<SmartAccountGaslessMaterialRecord> {
    if (record.phase !== "sealed" || record.updated_at !== record.sealed_at) saFail("sa_gasless_state_corrupt");
    const sealed = materialRecord({ ...record, integrity_hash: hashObject(record) });
    const existing = await this.load(record.operation_id);
    if (existing !== null) {
      if (sealedIdentity(existing) !== sealedIdentity(sealed)) saFail("sa_gasless_state_corrupt");
      return existing;
    }
    const secret = await this.wrapping.load();
    if (secret === null) saFail("sa_gasless_material_unavailable");
    try { await this.write(sealed, secret); }
    finally { secret.fill(0); }
    return sealed;
  }

  async markExposed(operationId: string, updatedAt: string): Promise<SmartAccountGaslessMaterialRecord> {
    const current = await this.load(operationId);
    if (current === null) saFail("sa_gasless_state_corrupt");
    if (current.phase === "exposed") return current;
    if (!timestamp(updatedAt) || Date.parse(updatedAt) < Date.parse(current.sealed_at)) saFail("sa_gasless_state_corrupt");
    const { integrity_hash: _old, ...body } = current;
    const nextBody = { ...body, phase: "exposed" as const, updated_at: updatedAt };
    const next = materialRecord({ ...nextBody, integrity_hash: hashObject(nextBody) });
    const secret = await this.wrapping.load();
    if (secret === null) saFail("sa_gasless_material_unavailable");
    try { await this.write(next, secret); }
    finally { secret.fill(0); }
    return next;
  }

  private async write(record: SmartAccountGaslessMaterialRecord, secret: Buffer): Promise<void> {
    const salt = randomBytes(32), iv = randomBytes(12), key = derive(secret, salt, record.operation_id);
    const header = { schema_version: ENVELOPE_VERSION, operation_id: record.operation_id,
      kdf: { name: "HKDF-SHA-256", salt: salt.toString("base64") },
      cipher: { name: "AES-256-GCM", iv: iv.toString("base64") } } as const;
    const plaintext = Buffer.from(canonicalJson(record), "utf8");
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(canonicalJson(header), "utf8"));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      try { await this.files.write(record.operation_id, { ...header, cipher: { ...header.cipher,
        ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") } }); }
      finally { ciphertext.fill(0); }
    } finally { salt.fill(0); iv.fill(0); key.fill(0); plaintext.fill(0); }
  }
}

class MaterialState extends SecureStateStore {
  async load(operationId: string): Promise<unknown | null> {
    stateIdentifier(operationId, "Smart Account gasless operation ID");
    return await this.readJson(join("smart-account-gasless-materials", `${operationId}.json`));
  }
  async write(operationId: string, value: unknown): Promise<void> {
    stateIdentifier(operationId, "Smart Account gasless operation ID");
    await this.ensureDirectory("smart-account-gasless-materials");
    await this.writeJson(join("smart-account-gasless-materials", `${operationId}.json`), value);
  }
}

interface Envelope {
  readonly schema_version: typeof ENVELOPE_VERSION;
  readonly operation_id: string;
  readonly kdf: { readonly name: "HKDF-SHA-256"; readonly salt: string };
  readonly cipher: { readonly name: "AES-256-GCM"; readonly iv: string; readonly ciphertext: string; readonly tag: string };
}

function decrypt(envelope: Envelope, secret: Buffer): SmartAccountGaslessMaterialRecord {
  const salt = base64(envelope.kdf.salt, 32), iv = base64(envelope.cipher.iv, 12);
  const ciphertext = base64(envelope.cipher.ciphertext), tag = base64(envelope.cipher.tag, 16);
  const key = derive(secret, salt, envelope.operation_id); let plaintext = Buffer.alloc(0);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(canonicalJson({ schema_version: envelope.schema_version, operation_id: envelope.operation_id,
      kdf: envelope.kdf, cipher: { name: envelope.cipher.name, iv: envelope.cipher.iv } }), "utf8"));
    decipher.setAuthTag(tag); plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const value = JSON.parse(text) as unknown;
    if (canonicalJson(value) !== text) saFail("sa_gasless_state_corrupt");
    return materialRecord(value);
  } catch { return saFail("sa_gasless_state_corrupt"); }
  finally { salt.fill(0); iv.fill(0); ciphertext.fill(0); tag.fill(0); key.fill(0); plaintext.fill(0); }
}

function materialRecord(value: unknown): SmartAccountGaslessMaterialRecord {
  if (!isPlainRecord(value) || !exactKeys(value, ["schema_version", "operation_id", "profile_hash", "fingerprint",
    "request_hash", "root_grant_fingerprint", "encodedRootHash", "encodedChildHash", "permissionContextHash",
    "payloadHash", "requirementsHash", "materialHash", "rootDelegationHash", "childDelegationHash",
    "delegation_manager", "delegator", "root_context", "encoded_child", "permission_context",
    "payment_payload_canonical_json", "phase", "sealed_at", "updated_at", "integrity_hash"])) saFail("sa_gasless_state_corrupt");
  const r = value as unknown as SmartAccountGaslessMaterialRecord;
  const { integrity_hash: _integrity, ...body } = r;
  if (r.schema_version !== RECORD_VERSION || !hashes(r.operation_id, r.profile_hash, r.fingerprint, r.request_hash,
    r.root_grant_fingerprint, r.encodedRootHash, r.encodedChildHash, r.permissionContextHash, r.payloadHash,
    r.requirementsHash, r.materialHash, r.integrity_hash) || !hex32(r.rootDelegationHash) || !hex32(r.childDelegationHash) ||
    !lowerAddress(r.delegation_manager) || !lowerAddress(r.delegator) || !lowerHex(r.root_context) ||
    !lowerHex(r.encoded_child) || !lowerHex(r.permission_context) || (r.phase !== "sealed" && r.phase !== "exposed") ||
    !timestamp(r.sealed_at) || !timestamp(r.updated_at) || Date.parse(r.updated_at) < Date.parse(r.sealed_at) ||
    r.integrity_hash !== hashObject(body)) saFail("sa_gasless_state_corrupt");
  let payload: SmartAccountGaslessPayload;
  try { payload = JSON.parse(r.payment_payload_canonical_json) as SmartAccountGaslessPayload; }
  catch { return saFail("sa_gasless_state_corrupt"); }
  if (canonicalJson(payload) !== r.payment_payload_canonical_json || !isPlainRecord(payload) ||
    !exactKeys(payload, ["x402Version", "accepted", "payload"]) || payload.x402Version !== 2 ||
    !isPlainRecord(payload.payload) || !exactKeys(payload.payload, ["delegationManager", "delegator", "permissionContext"]) ||
    payload.payload.permissionContext.toLowerCase() !== r.permission_context ||
    payload.payload.delegationManager.toLowerCase() !== r.delegation_manager ||
    payload.payload.delegator.toLowerCase() !== r.delegator) saFail("sa_gasless_state_corrupt");
  let chain;
  try { chain = decodeDelegations(r.permission_context); }
  catch { return saFail("sa_gasless_state_corrupt"); }
  if (chain.length !== 2 || chain[0] === undefined || chain[1] === undefined ||
    encodeDelegations([chain[0]]).toLowerCase() !== r.encoded_child || encodeDelegations([chain[1]]).toLowerCase() !== r.root_context ||
    r.encodedRootHash !== saRootContextHash(r.root_context) ||
    r.encodedChildHash !== domainHash(SA_MATERIAL_DOMAINS.encodedChild, r.encoded_child) ||
    r.permissionContextHash !== domainHash(SA_MATERIAL_DOMAINS.permissionContext, r.permission_context) ||
    r.payloadHash !== domainHash(SA_MATERIAL_DOMAINS.payload, r.payment_payload_canonical_json) ||
    r.requirementsHash !== saRequirementsHash(payload.accepted) ||
    r.rootDelegationHash !== hashDelegation(toDelegationStruct(chain[1])).toLowerCase() ||
    r.childDelegationHash !== hashDelegation(toDelegationStruct(chain[0])).toLowerCase()) saFail("sa_gasless_state_corrupt");
  const without = { encodedRootHash: r.encodedRootHash, encodedChildHash: r.encodedChildHash,
    permissionContextHash: r.permissionContextHash, payloadHash: r.payloadHash, requirementsHash: r.requirementsHash,
    rootDelegationHash: r.rootDelegationHash, childDelegationHash: r.childDelegationHash };
  if (r.materialHash !== saMaterialHash(r.operation_id, r.fingerprint, without)) saFail("sa_gasless_state_corrupt");
  return r;
}

function envelopeRecord(value: unknown, operationId: string): Envelope {
  if (!isPlainRecord(value) || !exactKeys(value, ["schema_version", "operation_id", "kdf", "cipher"]) ||
    value.schema_version !== ENVELOPE_VERSION || value.operation_id !== operationId || !isPlainRecord(value.kdf) ||
    !exactKeys(value.kdf, ["name", "salt"]) || value.kdf.name !== "HKDF-SHA-256" || typeof value.kdf.salt !== "string" ||
    !isPlainRecord(value.cipher) || !exactKeys(value.cipher, ["name", "iv", "ciphertext", "tag"]) ||
    value.cipher.name !== "AES-256-GCM" || typeof value.cipher.iv !== "string" ||
    typeof value.cipher.ciphertext !== "string" || typeof value.cipher.tag !== "string") saFail("sa_gasless_state_corrupt");
  return value as unknown as Envelope;
}

function derive(secret: Buffer, salt: Buffer, operationId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, salt, Buffer.from(`${ENVELOPE_VERSION}\0${operationId}`), 32));
}
function sealedIdentity(record: SmartAccountGaslessMaterialRecord): string {
  return hashObject({ schema_version: record.schema_version, operation_id: record.operation_id,
    profile_hash: record.profile_hash, fingerprint: record.fingerprint, request_hash: record.request_hash,
    root_grant_fingerprint: record.root_grant_fingerprint,
    encodedRootHash: record.encodedRootHash, encodedChildHash: record.encodedChildHash,
    permissionContextHash: record.permissionContextHash, payloadHash: record.payloadHash,
    requirementsHash: record.requirementsHash, materialHash: record.materialHash,
    rootDelegationHash: record.rootDelegationHash, childDelegationHash: record.childDelegationHash,
    delegation_manager: record.delegation_manager, delegator: record.delegator,
    root_context: record.root_context, encoded_child: record.encoded_child,
    permission_context: record.permission_context, payment_payload_canonical_json: record.payment_payload_canonical_json,
    sealed_at: record.sealed_at });
}
function base64(value: string, length?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== value || (length !== undefined && decoded.length !== length)) {
    decoded.fill(0); saFail("sa_gasless_state_corrupt");
  }
  return decoded;
}
function hashes(...values: readonly string[]): boolean { return values.every(value => /^[a-f0-9]{64}$/u.test(value)); }
function lowerAddress(value: string): boolean { return /^0x[0-9a-f]{40}$/u.test(value); }
function lowerHex(value: string): boolean { return /^0x(?:[0-9a-f]{2})+$/u.test(value); }
function hex32(value: string): boolean { return /^0x[0-9a-f]{64}$/u.test(value); }
function timestamp(value: string): boolean { const parsed = Date.parse(value); return Number.isFinite(parsed) && new Date(parsed).toISOString() === value; }
