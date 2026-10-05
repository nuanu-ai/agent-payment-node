import { open } from "node:fs/promises";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { canonicalProfile } from "../wallet-policy.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { assetUsageReservationId } from "../asset-usage-ledger.js";
import { PERMIT2_PRODUCTION_SCHEMA, validatePermit2ProductionMaterial, reconstructPermit2ProductionMaterial,
  type Permit2ProductionMaterial } from "./production-material.js";
export type Permit2ProductionState = "prepared" | "reserving" | "reserved" | "release_pending" | "released_unsubmitted" | "exposure_unknown";
export interface Permit2ProductionRecord {
  readonly schemaVersion: typeof PERMIT2_PRODUCTION_SCHEMA;
  readonly operationId: string;
  readonly profileHash: string;
  readonly idempotencyHash: string;
  readonly requestHash: string;
  readonly material: Permit2ProductionMaterial;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: Permit2ProductionState;
  readonly terminal: boolean;
  readonly reservationStarted: boolean;
  readonly usageReservationId: string;
  readonly usageReservationDigest: string | null;
  readonly exposureAt: string | null;
  readonly releaseDigest: string | null;
  readonly integrityHash: string;
}
const HASH = /^[a-f0-9]{64}$/u;
export function permit2ProductionId(profile: string, key: string): string {
  return sha256(`operation\0x402-permit2-production.v2\0${canonicalProfile(profile)}\0${canonicalIdempotencyKey(key)}`);
}
export function productionUsageIdentity(record: Permit2ProductionRecord) {
  const prepared = reconstructPermit2ProductionMaterial(record.material);
  return { account: prepared.payer, chain: prepared.chain, asset: { kind: "token" as const, identifier: prepared.token } };
}
export function productionUsageKey(operationId: string): `x402-permit2-production.v2:${string}` { return `x402-permit2-production.v2:${operationId}`; }
export function sealPermit2ProductionRecord(body: Omit<Permit2ProductionRecord, "integrityHash">): Permit2ProductionRecord {
  return validatePermit2ProductionRecord({ ...body, integrityHash: domainHash(PERMIT2_PRODUCTION_SCHEMA, canonicalJson(body)) });
}
export function productionRecordBody(record: Permit2ProductionRecord): Omit<Permit2ProductionRecord, "integrityHash"> {
  const { integrityHash: _hash, ...body } = record; return body;
}
export function validatePermit2ProductionRecord(value: unknown): Permit2ProductionRecord {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profileHash", "idempotencyHash", "requestHash", "material",
    "createdAt", "updatedAt", "state", "terminal", "reservationStarted", "usageReservationId", "usageReservationDigest", "exposureAt", "releaseDigest", "integrityHash"])) corrupt();
  const v = value as unknown as Permit2ProductionRecord;
  const { integrityHash, ...body } = v;
  if (v.schemaVersion !== PERMIT2_PRODUCTION_SCHEMA || !HASH.test(integrityHash) ||
      integrityHash !== domainHash(PERMIT2_PRODUCTION_SCHEMA, canonicalJson(body))) corrupt();
  for (const hash of [v.operationId, v.profileHash, v.idempotencyHash, v.requestHash, v.usageReservationId]) if (!HASH.test(hash)) corrupt();
  validatePermit2ProductionMaterial(v.material);
  const prepared = reconstructPermit2ProductionMaterial(v.material);
  if (v.profileHash !== v.material.wallet.profileHash || !instant(v.createdAt) || !instant(v.updatedAt) || v.updatedAt < v.createdAt ||
      Date.parse(v.createdAt) !== v.material.signingSecond * 1000 ||
      !["prepared", "reserving", "reserved", "release_pending", "released_unsubmitted", "exposure_unknown"].includes(v.state) ||
      v.terminal !== (v.state === "released_unsubmitted") ||
      (["release_pending", "released_unsubmitted"].includes(v.state) && Date.parse(v.updatedAt) < Number(prepared.expiresAtUnix) * 1000) || typeof v.reservationStarted !== "boolean" ||
      (["reserving", "reserved", "exposure_unknown"].includes(v.state) && !v.reservationStarted) ||
      (v.state === "prepared" && v.reservationStarted) ||
      v.usageReservationId !== assetUsageReservationId(productionUsageIdentity(v), productionUsageKey(v.operationId)) ||
      v.usageReservationDigest !== null && !HASH.test(v.usageReservationDigest) ||
      (["reserved", "exposure_unknown"].includes(v.state) && v.usageReservationDigest === null) ||
      (v.state === "prepared" && v.usageReservationDigest !== null) ||
      ((v.state === "exposure_unknown") !== (v.exposureAt !== null)) ||
      (v.exposureAt !== null && (!instant(v.exposureAt) || v.exposureAt < v.createdAt || v.exposureAt > v.updatedAt)) ||
      (["release_pending", "released_unsubmitted"].includes(v.state) !== (v.releaseDigest !== null)) ||
      (v.releaseDigest !== null && v.releaseDigest !== domainHash(`${PERMIT2_PRODUCTION_SCHEMA}.unsigned-expiry`, canonicalJson({
        operationId: v.operationId, materialHash: v.material.materialHash, deadline: prepared.expiresAtUnix })))) corrupt();
  return v;
}
/** Typed private paths only; canonical data uses the existing owned 0700/0600 atomic fsync store. */
export class Permit2ProductionRepository extends SecureStateStore {
  async ready(): Promise<void> {
    await this.initialize(); await this.ensureDirectory("permit2-production");
    const handle = await open(this.root, "r"); try { await handle.sync(); } finally { await handle.close(); }
  }
  private path(id: string): string { if (!HASH.test(id)) corrupt(); return `permit2-production/${id}.json`; }
  async findOperation(id: string): Promise<Permit2ProductionRecord | null> {
    const value = await this.readJson(this.path(id));
    if (value === null) return null;
    const record = validatePermit2ProductionRecord(value); if (record.operationId !== id) corrupt(); return record;
  }
  async listAllOperations(): Promise<readonly Permit2ProductionRecord[]> {
    const records: Permit2ProductionRecord[] = [];
    for (const entry of await this.readDirectory("permit2-production")) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt();
      const record = await this.findOperation(entry.name.slice(0, -5)); if (record === null) corrupt(); records.push(record);
    }
    return records;
  }
  async listOperations(profileHash: string): Promise<readonly Permit2ProductionRecord[]> {
    if (!HASH.test(profileHash)) corrupt(); return (await this.listAllOperations()).filter(record => record.profileHash === profileHash);
  }
  /** Caller holds profile + operation locks. Only unsigned preparation/lease states can be written in P2. */
  async persistLocked(record: Permit2ProductionRecord, createOnly = false): Promise<void> {
    validatePermit2ProductionRecord(record);
    const current = await this.findOperation(record.operationId);
    if (current !== null) {
      if (createOnly || current.requestHash !== record.requestHash || current.material.materialHash !== record.material.materialHash ||
          current.createdAt !== record.createdAt || current.profileHash !== record.profileHash || current.idempotencyHash !== record.idempotencyHash ||
          current.exposureAt !== record.exposureAt || current.reservationStarted && !record.reservationStarted || current.updatedAt > record.updatedAt ||
          !allowed(current.state, record.state)) corrupt();
    } else if (!createOnly || record.state !== "prepared") corrupt();
    await this.writeJson(this.path(record.operationId), record, createOnly);
  }
}
function allowed(from: Permit2ProductionState, to: Permit2ProductionState): boolean {
  return from === to || from === "prepared" && ["reserving", "release_pending"].includes(to) ||
    from === "reserving" && ["reserved", "release_pending"].includes(to) || from === "reserved" && to === "release_pending" ||
    from === "release_pending" && to === "released_unsubmitted";
}
export function publicPermit2Production(record: Permit2ProductionRecord) {
  validatePermit2ProductionRecord(record);
  const p = reconstructPermit2ProductionMaterial(record.material), url = new URL(record.material.checked.request.url);
  return { operationId: record.operationId, state: record.state, terminal: record.terminal, capability: "execution_blocked",
    chain: p.chain, payer: p.payer, token: p.token, recipient: p.payTo, amountAtomic: p.amountAtomic, deadline: p.expiresAtUnix,
    resource: { origin: url.origin, path: url.pathname, urlHash: sha256(url.toString()) },
    blockerCodes: ["permit2_production_execution_not_wired"] };
}
function instant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Permit2 production journal is corrupt."); }
