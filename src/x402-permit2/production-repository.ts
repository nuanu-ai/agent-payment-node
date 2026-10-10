import { open } from "node:fs/promises";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { canonicalProfile } from "../wallet-policy.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { assetUsageReservationId } from "../asset-usage-ledger.js";
import type { ClockPort } from "../ports.js";
import { PERMIT2_PRODUCTION_SCHEMA, validatePermit2ProductionMaterial, reconstructPermit2ProductionMaterial,
  type Permit2ProductionMaterial } from "./production-material.js";
import { validateExposureJournal, assertExposureAppend, type Permit2ExposureJournal } from "./production-journal-codec.js";
import { validatePermit2ProductionSigned } from "./production-signed.js";
export type Permit2ProductionState = "prepared" | "reserving" | "reserved" | "release_pending" | "released_unsubmitted" | "exposure_unknown" | "request_pending" | "terminal_pending" | "settled" | "expired_no_effect";
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
  readonly exposureJournal?: Permit2ExposureJournal;
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
    "createdAt", "updatedAt", "state", "terminal", "reservationStarted", "usageReservationId", "usageReservationDigest", "exposureAt", "releaseDigest", "integrityHash", ...(Object.hasOwn(value, "exposureJournal") ? ["exposureJournal"] : [])])) corrupt();
  const v = value as unknown as Permit2ProductionRecord;
  const { integrityHash, ...body } = v;
  if (v.schemaVersion !== PERMIT2_PRODUCTION_SCHEMA || !HASH.test(integrityHash) ||
      integrityHash !== domainHash(PERMIT2_PRODUCTION_SCHEMA, canonicalJson(body))) corrupt();
  for (const hash of [v.operationId, v.profileHash, v.idempotencyHash, v.requestHash, v.usageReservationId]) if (!HASH.test(hash)) corrupt();
  validatePermit2ProductionMaterial(v.material);
  const prepared = reconstructPermit2ProductionMaterial(v.material);
  const exposed = ["exposure_unknown", "request_pending", "terminal_pending", "settled", "expired_no_effect"].includes(v.state);
  if (v.exposureJournal !== undefined) validateExposureJournal(v.exposureJournal, v);
  if (exposed && v.exposureJournal !== undefined) {
    const j = v.exposureJournal;
    if (!v.reservationStarted || v.usageReservationDigest === null || v.releaseDigest !== null ||
        (v.state === "request_pending" && j.request === null) ||
        (v.state === "exposure_unknown" && j.request !== null) ||
        (["terminal_pending", "settled", "expired_no_effect"].includes(v.state) !== (j.terminalIntent !== null)) ||
        (v.state === "settled" && j.terminalIntent?.outcome !== "settled") ||
        (v.state === "expired_no_effect" && j.terminalIntent?.outcome !== "expired_unused")) corrupt();
  } else if (v.exposureJournal !== undefined || exposed && v.state !== "exposure_unknown") corrupt();
  if (v.profileHash !== v.material.wallet.profileHash || !instant(v.createdAt) || !instant(v.updatedAt) || v.updatedAt < v.createdAt ||
      Date.parse(v.createdAt) !== v.material.signingSecond * 1000 ||
      !["prepared", "reserving", "reserved", "release_pending", "released_unsubmitted", "exposure_unknown", "request_pending", "terminal_pending", "settled", "expired_no_effect"].includes(v.state) ||
      v.terminal !== (["released_unsubmitted", "settled", "expired_no_effect"].includes(v.state)) ||
      (["release_pending", "released_unsubmitted"].includes(v.state) && Date.parse(v.updatedAt) < Number(prepared.expiresAtUnix) * 1000) || typeof v.reservationStarted !== "boolean" ||
      (["reserving", "reserved", "exposure_unknown"].includes(v.state) && !v.reservationStarted) ||
      (v.state === "prepared" && v.reservationStarted) ||
      v.usageReservationId !== assetUsageReservationId(productionUsageIdentity(v), productionUsageKey(v.operationId)) ||
      v.usageReservationDigest !== null && !HASH.test(v.usageReservationDigest) ||
      (["reserved", "exposure_unknown"].includes(v.state) && v.usageReservationDigest === null) ||
      (v.state === "prepared" && v.usageReservationDigest !== null) ||
      (exposed !== (v.exposureAt !== null)) ||
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
  #path(id: string): string { if (!HASH.test(id)) corrupt(); return `permit2-production/${id}.json`; }
  static findOwnedOperation(repository: Permit2ProductionRepository, id: string) { return repository.#findOperation(id); }
  static persistOwnedExposure(repository: Permit2ProductionRepository, record: Permit2ProductionRecord) { return repository.#persistExposureLocked(record); }
  async findOperation(id: string): Promise<Permit2ProductionRecord | null> { return this.#findOperation(id); }
  async #findOperation(id: string): Promise<Permit2ProductionRecord | null> {
    const value = await this.readJson(this.#path(id));
    if (value === null) return null;
    const record = validatePermit2ProductionRecord(value); if (record.operationId !== id) corrupt();
    if (record.exposureJournal?.signed != null) await validatePermit2ProductionSigned(record.exposureJournal.signed, record);
    return record;
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
    if (createOnly || record.state === "prepared" || record.exposureJournal !== undefined) blocked("Prepared Permit2 material requires deadline-checked persistence.");
    validatePermit2ProductionRecord(record);
    const current = await this.findOperation(record.operationId);
    if (current !== null) {
      if (current.requestHash !== record.requestHash || current.material.materialHash !== record.material.materialHash ||
          current.createdAt !== record.createdAt || current.profileHash !== record.profileHash || current.idempotencyHash !== record.idempotencyHash ||
          current.exposureAt !== record.exposureAt || current.reservationStarted && !record.reservationStarted || current.updatedAt > record.updatedAt ||
          !allowed(current.state, record.state)) corrupt();
    } else corrupt();
    await this.writeJson(this.#path(record.operationId), record);
  }
  /** Only the dedicated exposure lifecycle subclass can publish append-only private risk material. */
  protected async persistExposureLocked(record: Permit2ProductionRecord): Promise<void> { return this.#persistExposureLocked(record); }
  async #persistExposureLocked(record: Permit2ProductionRecord): Promise<void> {
    validatePermit2ProductionRecord(record);
    const current = await this.#findOperation(record.operationId);
    if (current === null || record.exposureJournal === undefined ||
        current.requestHash !== record.requestHash || current.material.materialHash !== record.material.materialHash ||
        current.createdAt !== record.createdAt || current.profileHash !== record.profileHash || current.idempotencyHash !== record.idempotencyHash ||
        current.updatedAt > record.updatedAt || current.terminal && current.integrityHash !== record.integrityHash ||
        !record.reservationStarted || record.usageReservationDigest !== current.usageReservationDigest ||
        current.exposureAt !== null && current.exposureAt !== record.exposureAt ||
        current.exposureJournal === undefined && current.state !== "reserved") corrupt();
    if (current.exposureJournal !== undefined && !exposureAllowed(current.state, record.state)) corrupt();
    assertExposureAppend(current.exposureJournal, record.exposureJournal);
    if (record.exposureJournal.signed !== null) await validatePermit2ProductionSigned(record.exposureJournal.signed, record);
    await this.writeJson(this.#path(record.operationId), record);
  }
  /** Caller holds profile + operation locks; expiry is checked after the secure read immediately before creation. */
  async persistPreparedLocked(record: Permit2ProductionRecord, clock: ClockPort): Promise<void> {
    validatePermit2ProductionRecord(record);
    if (record.state !== "prepared") corrupt();
    const current = await this.findOperation(record.operationId);
    if (current !== null) corrupt();
    const now = clock.now(), nowMs = now instanceof Date ? now.getTime() : NaN;
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) blocked("Invalid production clock.");
    const deadline = reconstructPermit2ProductionMaterial(record.material).expiresAtUnix;
    if (BigInt(deadline) <= BigInt(Math.floor(nowMs / 1000))) blocked("Permit2 authorization expired.");
    await this.writeJson(this.#path(record.operationId), record, true);
  }
}
function exposureAllowed(from: Permit2ProductionState, to: Permit2ProductionState): boolean {
  return from === to || from === "exposure_unknown" && ["request_pending", "terminal_pending"].includes(to) ||
    from === "request_pending" && to === "terminal_pending" || from === "terminal_pending" && ["settled", "expired_no_effect"].includes(to);
}
function allowed(from: Permit2ProductionState, to: Permit2ProductionState): boolean {
  return from === to || from === "prepared" && ["reserving", "release_pending"].includes(to) ||
    from === "reserving" && ["reserved", "release_pending"].includes(to) || from === "reserved" && to === "release_pending" ||
    from === "release_pending" && to === "released_unsubmitted";
}
export function publicPermit2Production(record: Permit2ProductionRecord) {
  validatePermit2ProductionRecord(record);
  const p = reconstructPermit2ProductionMaterial(record.material), url = new URL(record.material.checked.request.url);
  return { lifecycle: record.exposureAt === null ? "unsigned" : record.state === "settled" ? "settled" :
      record.state === "expired_no_effect" ? "expired_no_effect" : record.exposureJournal?.request != null ? "request_attempted" : "exposed_held",
    observeOnly: record.exposureAt !== null, operationId: record.operationId, state: record.state, terminal: record.terminal, capability: "execution_blocked",
    chain: p.chain, payer: p.payer, token: p.token, recipient: p.payTo, amountAtomic: p.amountAtomic, deadline: p.expiresAtUnix,
    resource: { origin: url.origin, urlHash: sha256(url.toString()) },
    blockerCodes: ["permit2_production_execution_not_wired"] };
}
function instant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Permit2 production journal is corrupt."); }
