import { ApnError } from "../../errors.js";
import { mmError, mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";
import { jobTxDetails, takeJobTx, validateJobTx, type MetaMaskJobTx } from "./job-tx.js";
import { readDataRecord } from "./read-diagnostic.js";
import { submitToken, type SubmitCheck } from "./submit-diagnostic.js";

/**
 * Which of APN's checks refused MetaMask's answer to one job status read, as closed facts: the check, the job status
 * when it is a token, and how the answer's `tx` compared with the request (job-tx.ts). It is shown with that read's
 * own output and never stored; a failure outside these checks (network, HTTP status, session) carries none.
 */
export type ObserveCheck = Extract<SubmitCheck, "response_body" | "response_request_id" | "response_kind" | "response_status" |
  "response_tx" | "response_hash">;
export interface MetaMaskObserveDiagnostic {
  readonly mode: "observe";
  readonly check: ObserveCheck;
  /** The job status of an answer APN does not recognize or whose `tx` it refused, when it is an upper-case token. */
  readonly providerStatus: string | null;
  /** The answer's `tx` compared with the request, exactly when the `response_tx` check refused it. */
  readonly responseTx: MetaMaskJobTx | null;
}
const CHECKS: readonly string[] = ["response_body", "response_request_id", "response_kind", "response_status", "response_tx", "response_hash"];
const WITH_STATUS: readonly string[] = ["response_status", "response_tx"];
const KEYS = ["mode", "check", "providerStatus", "responseTx"] as const;
const REASON = "mm_gasless_provider_unavailable";

export function validateObserveDiagnostic(value: unknown): MetaMaskObserveDiagnostic {
  const d = readDataRecord(value);
  const responseTx = d.responseTx === null || d.responseTx === undefined ? d.responseTx : validateJobTx(d.responseTx, REASON);
  if (Object.keys(d).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(d, key)) || d.mode !== "observe" ||
    typeof d.check !== "string" || !CHECKS.includes(d.check) ||
    !(d.providerStatus === null || submitToken(d.providerStatus) !== null) || d.providerStatus !== null && !WITH_STATUS.includes(d.check) ||
    responseTx === undefined || (responseTx !== null) !== (d.check === "response_tx")) mmFail(REASON);
  return Object.freeze({ mode: "observe", check: d.check, providerStatus: d.providerStatus, responseTx }) as MetaMaskObserveDiagnostic;
}
export function observeDiagnostic(check: ObserveCheck, providerStatus: string | null, responseTx: MetaMaskJobTx | null): MetaMaskObserveDiagnostic {
  return validateObserveDiagnostic({ mode: "observe", check, providerStatus, responseTx });
}

/** The read failure as an APN error whose details carry the diagnostic as flat fields (ErrorDetail values only). */
export function observeFailureError(reason: MetaMaskGaslessFailureReason, d: MetaMaskObserveDiagnostic): ApnError {
  const base = mmError(reason);
  return new ApnError(base.code, base.message, { ...base.details, observeCheck: d.check,
    ...(d.providerStatus === null ? {} : { observeProviderStatus: d.providerStatus }), ...jobTxDetails("observe", d.responseTx) });
}

/** The diagnostic a read failure carried across the helper boundary, if any. */
export function takeObserveDiagnostic(error: unknown): MetaMaskObserveDiagnostic | undefined {
  if (!(error instanceof ApnError) || typeof error.details?.observeCheck !== "string") return undefined;
  const x = error.details;
  try {
    return observeDiagnostic(x.observeCheck as ObserveCheck, typeof x.observeProviderStatus === "string" ? x.observeProviderStatus : null,
      takeJobTx("observe", x, REASON));
  } catch { return undefined; }
}
