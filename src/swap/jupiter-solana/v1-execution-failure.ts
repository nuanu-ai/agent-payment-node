import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../secure-state-store.js";
import type { SwapOperationRecord } from "../model.js";
import { jupiterV1DispatchResult, type JupiterV1DispatchResult } from "./v1-dispatch.js";

const SCHEMA = "apn.jupiter-v1-execution-failure.v1" as const;
const PHASES = ["binding_and_sign", "sender_preflight"] as const;
type Phase = typeof PHASES[number];
export interface JupiterV1ExecutionFailure extends JupiterV1DispatchResult {
  readonly schemaVersion: typeof SCHEMA;
  readonly operationId: string;
  readonly markerHash: string;
  readonly phase: Phase;
  readonly currentBlockHeight: string | null;
  readonly lastValidBlockHeight: string;
  readonly observedAt: string;
  readonly recordHash: string;
}

/** Public diagnosis only. A marked operation stays observe-only even without a send claim. */
export class JupiterV1ExecutionFailureStore extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  async save(op: SwapOperationRecord, phase: Phase, error: unknown, lastValidBlockHeight: string,
    currentBlockHeight: string | null, now: Date): Promise<void> {
    await this.ready();
    const body = { schemaVersion: SCHEMA, operationId: op.operationId, markerHash: op.submissionMarker?.markerHash,
      phase, currentBlockHeight, lastValidBlockHeight, observedAt: now.toISOString(), ...jupiterV1DispatchResult("error", error) };
    const record = this.validate({ ...body, recordHash: domainHash(SCHEMA, canonicalJson(body)) }, op);
    const path = this.path(op), prior = await this.readJson(path);
    if (prior !== null) { if (canonicalJson(this.validate(prior, op)) !== canonicalJson(record)) corrupt(); return; }
    await this.ensureDirectory(`jupiter-v1-execution-failures/${op.ownerProfileHash}`);
    await this.writeJson(path, record, true);
  }
  async load(op: SwapOperationRecord): Promise<JupiterV1ExecutionFailure | null> {
    if (op.submissionMarker === null) return null;
    await this.ready();
    const raw = await this.readJson(this.path(op));
    return raw === null ? null : this.validate(raw, op);
  }
  private validate(value: unknown, op: SwapOperationRecord): JupiterV1ExecutionFailure {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "markerHash", "phase", "currentBlockHeight",
      "lastValidBlockHeight", "observedAt", "outcome", "errorCode", "rpcErrorCode", "rpcErrorReason", "httpStatus", "retryAfterMs", "recordHash"])) corrupt();
    const r = value as unknown as JupiterV1ExecutionFailure, { recordHash, ...body } = r;
    const sanitized = jupiterV1DispatchResult("error", new ApnError(r.errorCode as ConstructorParameters<typeof ApnError>[0], "", {
      ...(r.rpcErrorCode === null ? {} : { rpcErrorCode: r.rpcErrorCode }),
      ...(r.rpcErrorReason === null ? {} : { rpcErrorReason: r.rpcErrorReason }),
      ...(r.httpStatus === null ? {} : { httpStatus: r.httpStatus }),
      ...(r.retryAfterMs === null ? {} : { retryAfterMs: r.retryAfterMs }),
    }));
    if (op.submissionMarker === null || r.schemaVersion !== SCHEMA || r.operationId !== op.operationId ||
      r.markerHash !== op.submissionMarker.markerHash || !PHASES.includes(r.phase) || r.outcome !== "error" ||
      recordHash !== domainHash(SCHEMA, canonicalJson(body)) || !atomic(r.lastValidBlockHeight) ||
      r.currentBlockHeight !== null && !atomic(r.currentBlockHeight) ||
      !Number.isFinite(Date.parse(r.observedAt)) || new Date(r.observedAt).toISOString() !== r.observedAt ||
      r.observedAt < op.submissionMarker.markedAt ||
      canonicalJson(sanitized) !== canonicalJson({ outcome: r.outcome, errorCode: r.errorCode, rpcErrorCode: r.rpcErrorCode,
        rpcErrorReason: r.rpcErrorReason, httpStatus: r.httpStatus, retryAfterMs: r.retryAfterMs })) corrupt();
    return JSON.parse(canonicalJson(r)) as JupiterV1ExecutionFailure;
  }
  private path(op: SwapOperationRecord): string {
    stateIdentifier(op.ownerProfileHash, "Jupiter profile"); stateIdentifier(op.operationId, "Jupiter operation");
    return `jupiter-v1-execution-failures/${op.ownerProfileHash}/${op.operationId}.json`;
  }
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("jupiter-v1-execution-failures"); })();
    await this.initialized;
  }
}
function atomic(value: unknown): boolean { return typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/u.test(value); }
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Jupiter execution failure has invalid marker binding or public fields."); }
