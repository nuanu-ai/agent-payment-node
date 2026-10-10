import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import type { SwapOperationRecord } from "../model.js";
import { JupiterV1ExecutionBindingStore } from "./v1-effects.js";

const SCHEMA = "apn.jupiter-v1-dispatch-observation.v1" as const;
const CODES = ["APN_RPC_PROTOCOL", "APN_RPC_AMBIGUOUS", "APN_RPC_RATE_LIMITED", "APN_RPC_BUDGET_EXCEEDED",
  "APN_RPC_CONFIG", "APN_PROVIDER_UNAVAILABLE", "APN_OPERATION_BLOCKED", "APN_STATE_CORRUPT", "APN_INTERNAL"] as const;
const REASONS = ["blockhash_not_found", "insufficient_funds_for_fee", "account_not_found", "already_processed", "instruction_error", "unclassified"] as const;
type DispatchCode = typeof CODES[number];
type DispatchReason = typeof REASONS[number];
export interface JupiterV1DispatchResult {
  readonly outcome: "acknowledged" | "signature_mismatch" | "error";
  readonly errorCode: DispatchCode | null;
  readonly rpcErrorCode: number | null;
  readonly rpcErrorReason: DispatchReason | null;
  readonly httpStatus: number | null;
  readonly retryAfterMs: number | null;
}
export interface JupiterV1DispatchObservation extends JupiterV1DispatchResult {
  readonly schemaVersion: typeof SCHEMA;
  readonly operationId: string;
  readonly markerHash: string;
  readonly claimHash: string;
  readonly bindingHash: string;
  readonly signature: string;
  readonly observedAt: string;
  readonly recordHash: string;
}
export function jupiterV1DispatchResult(outcome: JupiterV1DispatchResult["outcome"], error?: unknown): JupiterV1DispatchResult {
  const apn = error instanceof ApnError ? error : null;
  const errorCode = outcome !== "error" ? null : CODES.includes(apn?.code as DispatchCode) ? apn!.code as DispatchCode : "APN_INTERNAL";
  const details = apn?.details;
  return { outcome, errorCode, rpcErrorCode: integer(details?.rpcErrorCode, -2147483648, 2147483647),
    rpcErrorReason: REASONS.includes(details?.rpcErrorReason as DispatchReason) ? details!.rpcErrorReason as DispatchReason : null,
    httpStatus: integer(details?.httpStatus, 100, 599), retryAfterMs: integer(details?.retryAfterMs, 0, 86400000) };
}

/** An immutable public diagnostic. It never authorizes retry, settles usage, or proves chain finality. */
export class JupiterV1DispatchStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  private readonly bindings: JupiterV1ExecutionBindingStore;
  constructor(root: string) { super(root); this.bindings = new JupiterV1ExecutionBindingStore(root); }
  async save(op: SwapOperationRecord, bindingHash: string, result: JupiterV1DispatchResult, now: Date): Promise<void> {
    await this.ready();
    const claim = await this.bindings.loadClaim(op);
    if (claim === null || claim.bindingHash !== bindingHash) corrupt();
    const body = { schemaVersion: SCHEMA, operationId: op.operationId, markerHash: claim.markerHash, claimHash: claim.claimHash,
      bindingHash, signature: claim.signature, observedAt: now.toISOString(), ...result };
    const record = { ...body, recordHash: domainHash(SCHEMA, canonicalJson(body)) };
    await this.validate(record, op);
    const path = this.path(op), prior = await this.readJson(path);
    if (prior !== null) { if (canonicalJson(await this.validate(prior, op)) !== canonicalJson(record)) corrupt(); return; }
    await this.ensureDirectory(`jupiter-v1-dispatch/${op.ownerProfileHash}`);
    await this.writeJson(path, record, true);
  }
  async load(op: SwapOperationRecord): Promise<JupiterV1DispatchObservation | null> {
    if (op.submissionMarker === null) return null;
    await this.ready();
    const value = await this.readJson(this.path(op));
    return value === null ? null : await this.validate(value, op);
  }
  private async validate(value: unknown, op: SwapOperationRecord): Promise<JupiterV1DispatchObservation> {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "markerHash", "claimHash", "bindingHash", "signature",
      "observedAt", "outcome", "errorCode", "rpcErrorCode", "rpcErrorReason", "httpStatus", "retryAfterMs", "recordHash"])) corrupt();
    const r = value as unknown as JupiterV1DispatchObservation, { recordHash, ...body } = r;
    const claim = await this.bindings.loadClaim(op);
    if (claim === null || r.schemaVersion !== SCHEMA || r.operationId !== op.operationId || r.markerHash !== op.submissionMarker?.markerHash ||
      r.claimHash !== claim.claimHash || r.bindingHash !== claim.bindingHash || r.signature !== claim.signature ||
      recordHash !== domainHash(SCHEMA, canonicalJson(body)) || !["acknowledged", "signature_mismatch", "error"].includes(r.outcome) ||
      !Number.isFinite(Date.parse(r.observedAt)) || new Date(r.observedAt).toISOString() !== r.observedAt || r.observedAt < claim.claimedAt ||
      (r.outcome === "error" ? !CODES.includes(r.errorCode as DispatchCode) : r.errorCode !== null) ||
      (r.rpcErrorCode !== null && integer(r.rpcErrorCode, -2147483648, 2147483647) === null) ||
      (r.rpcErrorReason !== null && !REASONS.includes(r.rpcErrorReason)) ||
      (r.httpStatus !== null && integer(r.httpStatus, 100, 599) === null) ||
      (r.retryAfterMs !== null && integer(r.retryAfterMs, 0, 86400000) === null) ||
      (r.outcome !== "error" && [r.rpcErrorCode, r.rpcErrorReason, r.httpStatus, r.retryAfterMs].some(v => v !== null))) corrupt();
    return JSON.parse(canonicalJson(r)) as JupiterV1DispatchObservation;
  }
  private path(op: SwapOperationRecord): string {
    stateIdentifier(op.ownerProfileHash, "Jupiter profile"); stateIdentifier(op.operationId, "Jupiter operation");
    return `jupiter-v1-dispatch/${op.ownerProfileHash}/${op.operationId}.json`;
  }
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("jupiter-v1-dispatch"); })();
    await this.initialized;
  }
}
function integer(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Jupiter dispatch observation has invalid claim binding or public fields."); }
