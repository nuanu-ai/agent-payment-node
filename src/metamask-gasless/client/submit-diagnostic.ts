import { ApnError } from "../../errors.js";
import { mmError, mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";
import { readDataRecord } from "./read-diagnostic.js";

/**
 * Where a MetaMask gasless submit stopped (QA 0.5.79 MM-GASLESS-SUBMIT-UNKNOWN-079-002), as closed facts only: the
 * helper stage, whether APN's network policy let the one POST out, its HTTP status, the check that refused, and the
 * provider's error code or job status when they have a closed token form. No body, URL, header or identifier leaves.
 * It is shown with the attempt's own output and never stored: the outcome stays unknown whatever it says.
 */
/** `launch` is before the helper process exists; `runner` is the parent's view of a helper that ran and failed. */
export type SubmitStage = "launch" | "runner" | "private_state" | "sdk_load" | "hydrate" | "binding" | "body" | "post" | "response" |
  "complete" | "helper_response";
/**
 * `not_reached`: no POST could have left (only APN's own checks before it ran, or no helper process started);
 * `refused`: APN's body check refused it before sending; `sent`: it may have reached the provider; `unknown`: a helper
 * that ran failed, so it may or may not have left. Nothing but `not_reached` and `refused` rules out a sent POST.
 */
export type SubmitPost = "not_reached" | "refused" | "sent" | "unknown";
export type SubmitCheck = "none" | "body_mismatch" | "duplicate_request" | "unexpected_request" | "deadline" | "clock" | "session" |
  "http_status" | "no_answer" | "response_body" | "response_request_id" | "response_kind" | "response_status" | "response_tx" |
  "response_hash" | "incomplete" | "runner_launch" | "runner_exit" | "runner_timeout" | "runner_output" | "response_invalid" | "unclassified";
export interface MetaMaskSubmitDiagnostic {
  readonly mode: "submit";
  readonly stage: SubmitStage;
  readonly post: SubmitPost;
  /** The POST's own status, when it was sent and answered. */
  readonly httpStatus: number | null;
  readonly check: SubmitCheck;
  /** The provider's error code from a non-2xx answer, when it is an upper-case token. */
  readonly providerError: string | null;
  /** The job status of a 2xx answer APN does not recognize, when it is an upper-case token. */
  readonly providerStatus: string | null;
}
const STAGES: readonly string[] = ["launch", "runner", "private_state", "sdk_load", "hydrate", "binding", "body", "post", "response", "complete", "helper_response"];
const POSTS: readonly string[] = ["not_reached", "refused", "sent", "unknown"];
const CHECKS: readonly string[] = ["none", "body_mismatch", "duplicate_request", "unexpected_request", "deadline", "clock", "session",
  "http_status", "no_answer", "response_body", "response_request_id", "response_kind", "response_status", "response_tx", "response_hash",
  "incomplete", "runner_launch", "runner_exit", "runner_timeout", "runner_output", "response_invalid", "unclassified"];
const KEYS = ["mode", "stage", "post", "httpStatus", "check", "providerError", "providerStatus"] as const;
const TOKEN = /^[A-Z][A-Z0-9_]{0,39}$/u;
const BEFORE_ANSWER: readonly string[] = ["launch", "private_state", "sdk_load", "hydrate", "binding", "body", "post"];

/** An upper-case token, or null: provider text never crosses as anything else. */
export function submitToken(value: unknown): string | null { return typeof value === "string" && TOKEN.test(value) ? value : null; }

/** The error code a non-2xx JSON answer names at `error.code`, `code` or `errorCode`, as a token. */
export function submitErrorCode(body: string): string | null {
  try {
    const value = JSON.parse(body) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>, nested = record.error;
    const fromError = nested !== null && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>).code : undefined;
    return submitToken(fromError) ?? submitToken(record.code) ?? submitToken(record.errorCode);
  } catch { return null; }
}

export function validateSubmitDiagnostic(value: unknown): MetaMaskSubmitDiagnostic {
  const d = readDataRecord(value);
  const status = d.httpStatus;
  if (Object.keys(d).length !== KEYS.length || KEYS.some(key => !Object.hasOwn(d, key)) || d.mode !== "submit" ||
    typeof d.stage !== "string" || !STAGES.includes(d.stage) || typeof d.post !== "string" || !POSTS.includes(d.post) ||
    !(status === null || typeof status === "number" && Number.isSafeInteger(status) && status >= 100 && status <= 599) ||
    status !== null && d.post !== "sent" ||
    typeof d.check !== "string" || !CHECKS.includes(d.check) ||
    !(d.providerError === null || submitToken(d.providerError) !== null) || !(d.providerStatus === null || submitToken(d.providerStatus) !== null) ||
    d.providerError !== null && (status === null || status < 300) || d.providerStatus !== null && d.check !== "response_status" ||
    d.stage === "launch" && d.post !== "not_reached" || (d.stage === "runner" || d.stage === "helper_response") && d.post !== "unknown" ||
    // Only stages up to the POST can prove it did not leave; only APN's body check at the POST refuses it unsent.
    d.post === "not_reached" && !BEFORE_ANSWER.includes(String(d.stage)) || d.post === "refused" && d.stage !== "post") {
    mmFail("mm_gasless_submit_unknown");
  }
  return Object.freeze(Object.fromEntries(KEYS.map(key => [key, d[key]]))) as unknown as MetaMaskSubmitDiagnostic;
}

export function submitDiagnostic(stage: SubmitStage, facts: Omit<MetaMaskSubmitDiagnostic, "mode" | "stage">): MetaMaskSubmitDiagnostic {
  return validateSubmitDiagnostic({ mode: "submit", stage, ...facts });
}
/** The parent's diagnostic of a helper that failed: before it existed nothing was sent; after it ran nothing is known. */
export function runnerDiagnostic(check: Extract<SubmitCheck, "runner_launch" | "runner_exit" | "runner_timeout" | "runner_output" | "response_invalid">,
  started: boolean): MetaMaskSubmitDiagnostic {
  return submitDiagnostic(started ? (check === "response_invalid" ? "helper_response" : "runner") : "launch",
    { post: started ? "unknown" : "not_reached", httpStatus: null, check, providerError: null, providerStatus: null });
}

/** The submit failure as an APN error whose details carry the diagnostic as flat fields (ErrorDetail values only). */
export function submitFailureError(reason: MetaMaskGaslessFailureReason, d: MetaMaskSubmitDiagnostic): ApnError {
  const base = mmError(reason);
  return new ApnError(base.code, base.message, { ...base.details, submitStage: d.stage, submitPost: d.post, submitCheck: d.check,
    ...(d.httpStatus === null ? {} : { submitHttpStatus: d.httpStatus }), ...(d.providerError === null ? {} : { submitProviderError: d.providerError }),
    ...(d.providerStatus === null ? {} : { submitProviderStatus: d.providerStatus }) });
}

/** The diagnostic a submit failure carried across the helper boundary, if any. */
export function takeSubmitDiagnostic(error: unknown): MetaMaskSubmitDiagnostic | undefined {
  if (!(error instanceof ApnError) || typeof error.details?.submitStage !== "string") return undefined;
  const x = error.details;
  try {
    return submitDiagnostic(x.submitStage as SubmitStage, { post: x.submitPost as SubmitPost, check: x.submitCheck as SubmitCheck,
      httpStatus: typeof x.submitHttpStatus === "number" ? x.submitHttpStatus : null,
      providerError: typeof x.submitProviderError === "string" ? x.submitProviderError : null,
      providerStatus: typeof x.submitProviderStatus === "string" ? x.submitProviderStatus : null });
  } catch { return undefined; }
}
