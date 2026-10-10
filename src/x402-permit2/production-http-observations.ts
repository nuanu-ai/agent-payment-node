import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { decodeAndNormalizePaymentResponseHeader } from "../x402-codec.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { Permit2ProductionRepository, type Permit2ProductionRecord } from "./production-repository.js";

const SCHEMA = "apn.permit2-production-http-observation.v1", DIRECTORY = "permit2-production-http-observations";
const HASH = /^[a-f0-9]{64}$/u, TRANSACTION = /^0x[a-f0-9]{64}$/u;
const CLASSIFICATIONS = ["no_header", "invalid_response", "success_hint", "pending_hint", "failure_hint"] as const;
/** An untrusted locator only. No value in this codec is financial or transport authority. */
export interface Permit2HttpLocatorHint {
  readonly schemaVersion: typeof SCHEMA; readonly operationId: string; readonly materialHash: string;
  readonly requestHash: string; readonly challengeHash: string; readonly signedHash: string;
  readonly httpStatus: number; readonly paymentResponseHeaderHash: string | null;
  readonly classification: typeof CLASSIFICATIONS[number]; readonly locator: string | null;
}
export function normalizePermit2Locator(value: unknown): string {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/u.test(value) || /^0x0{64}$/u.test(value)) invalid();
  return value.toLowerCase();
}
function binding(record: Permit2ProductionRecord) {
  const signed = record.exposureJournal?.signed; if (signed == null) invalid();
  return { operationId: record.operationId, materialHash: record.material.materialHash, requestHash: record.material.checked.requestHash,
    challengeHash: record.material.checked.challengeHash, signedHash: signed.signedHash };
}
export function validatePermit2HttpLocatorHint(value: unknown, record: Permit2ProductionRecord): Permit2HttpLocatorHint {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "materialHash", "requestHash", "challengeHash",
    "signedHash", "httpStatus", "paymentResponseHeaderHash", "classification", "locator"])) invalid();
  const b = binding(record);
  if (value.schemaVersion !== SCHEMA || !Number.isInteger(value.httpStatus) || Number(value.httpStatus) < 100 || Number(value.httpStatus) > 599 ||
      !CLASSIFICATIONS.includes(value.classification as typeof CLASSIFICATIONS[number]) ||
      value.paymentResponseHeaderHash !== null && (typeof value.paymentResponseHeaderHash !== "string" || !HASH.test(value.paymentResponseHeaderHash)) ||
      value.locator !== null && (typeof value.locator !== "string" || !TRANSACTION.test(value.locator) || /^0x0{64}$/u.test(value.locator))) invalid();
  for (const key of Object.keys(b) as Array<keyof typeof b>) if (value[key] !== b[key] || !HASH.test(String(value[key]))) invalid();
  const hasLocator = ["success_hint", "pending_hint", "failure_hint"].includes(String(value.classification));
  if (hasLocator !== (value.locator !== null) || hasLocator && value.paymentResponseHeaderHash === null ||
      value.classification === "no_header" && value.paymentResponseHeaderHash !== null) invalid();
  return Object.freeze({ ...value }) as unknown as Permit2HttpLocatorHint;
}
export function permit2HttpLocatorHint(record: Permit2ProductionRecord, observation: unknown): Permit2HttpLocatorHint {
  const b = binding(record);
  if (!isPlainRecord(observation) || !Number.isInteger(observation.status) || Number(observation.status) < 100 || Number(observation.status) > 599) invalid();
  let classification: Permit2HttpLocatorHint["classification"] = "no_header", locator: string | null = null, headerHash: string | null = null;
  try {
    const pairs = observation.rawHeaderPairs; if (!Array.isArray(pairs) || pairs.length > 64) invalid();
    let total = 0; const responses: string[] = [], controls = new Set<string>();
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") invalid();
      const [name, value] = pair, normalized = name.toLowerCase(); total += Buffer.byteLength(name) + Buffer.byteLength(value);
      if (name.length === 0 || name.length > 256 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) || /[\x00-\x1f\x7f]/u.test(value)) invalid();
      if (["payment-required", "payment-signature", "payment-response", "x-payment-response"].includes(normalized)) {
        const semantic = normalized === "x-payment-response" ? "payment-response" : normalized;
        if (controls.has(semantic) || value.length > 64 * 1024 || !/^[\x20-\x7e]+$/u.test(value) || value.trim() !== value || value.includes(",")) invalid();
        controls.add(semantic); if (semantic === "payment-response") responses.push(value);
      }
    }
    if (total > 96 * 1024 || controls.has("payment-signature")) invalid();
    const header = responses[0];
    if (header !== undefined) {
      headerHash = domainHash("apn.x402.payment-response-header.v1", Buffer.from(header, "ascii"));
      const plan = reconstructPermit2ProductionMaterial(record.material);
      const decoded = decodeAndNormalizePaymentResponseHeader(header, { network: "eip155:43114", payer: plan.payer.toLowerCase(), amountAtomic: plan.amountAtomic });
      if (decoded.paymentResponseHeaderHash !== headerHash) invalid();
      locator = normalizePermit2Locator(decoded.transactionHash);
      classification = decoded.classification === "success" ? "success_hint" : decoded.classification === "settlement_pending" ? "pending_hint" : "failure_hint";
    }
  } catch { classification = "invalid_response"; locator = null; }
  return validatePermit2HttpLocatorHint({ schemaVersion: SCHEMA, ...b, httpStatus: observation.status, paymentResponseHeaderHash: headerHash, classification, locator }, record);
}
/** First observation is immutable under the established profile/operation/EVM group. */
export class Permit2HttpObservationStore extends SecureStateStore {
  readonly #records: Permit2ProductionRepository;
  constructor(root: string) { super(root); this.#records = new Permit2ProductionRepository(this.root); }
  #path(id: string): string { if (!HASH.test(id)) invalid(); return `${DIRECTORY}/${id}.json`; }
  async read(id: string, record: Permit2ProductionRecord): Promise<Permit2HttpLocatorHint | null> {
    if (record.operationId !== id) invalid(); const value = await this.readJson(this.#path(id));
    return value === null ? null : validatePermit2HttpLocatorHint(value, record);
  }
  async write(id: string, observation: unknown): Promise<Permit2HttpLocatorHint> {
    const initial = await Permit2ProductionRepository.findOwnedOperation(this.#records, id); if (initial === null) invalid();
    return this.withLocks([`profile:${initial.profileHash}`, `operation:${id}`, evmAddressLock(initial.material.wallet.account)], async () => {
      const record = await Permit2ProductionRepository.findOwnedOperation(this.#records, id), j = record?.exposureJournal;
      if (record === null || record.state !== "request_pending" || record.terminal || j?.terminalIntent != null || j?.signed == null ||
          !j.holdConfirmed || j.request?.attempt !== 1 || j.request.requestHash !== record.material.checked.requestHash || j.request.headerHash !== j.signed.headerHash) invalid();
      const next = permit2HttpLocatorHint(record, observation), existing = await this.read(id, record);
      if (existing !== null) { if (canonicalJson(existing) !== canonicalJson(next)) invalid(); return existing; }
      await this.ensureDirectory(DIRECTORY); await this.writeJson(this.#path(id), next, true);
      return validatePermit2HttpLocatorHint(await this.readJson(this.#path(id)), record);
    });
  }
}
function invalid(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 HTTP locator hint is unavailable or does not match the owned operation."); }
