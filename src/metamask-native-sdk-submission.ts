import { performance } from "node:perf_hooks";
import { validateMetaMaskNativeDiagnostic, type MetaMaskNativeDeadline, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import type { MetaMaskSubmitDiagnostic } from "./metamask-gasless/client/submit-diagnostic.js";
import { MM_REQUEST_CLOSED_STATUSES as CLOSED, MM_REQUEST_PENDING_STATUSES as PENDING,
  type MetaMaskServerTransactionOutcome } from "./metamask-server-transaction.js";
import type { MetaMaskNativeSubmission } from "./metamask-native-transfer-adapter.js";

/**
 * A native transfer's hand-off outcome from the helper's send. A hash with a live or settled status is acknowledged; a
 * request still before its hash is pending, with the owner's MFA window when MetaMask waits on it; a closed request, a
 * status APN does not know and every failure once the helper may have started stay UNKNOWN. The request id is APN's own
 * and was sealed before the send, so every outcome keeps it; none is a refusal before the effect.
 */
export function metaMaskNativeSdkSubmission(outcome: MetaMaskServerTransactionOutcome, startedAt: number,
  deadline: MetaMaskNativeDeadline): MetaMaskNativeSubmission {
  if (outcome.kind === "unknown") return { disposition: "unknown", reason: outcome.reason, diagnostic: failedDiagnostic(outcome.diagnostic, startedAt, deadline) };
  const answer = outcome.answer, diagnostic = sendDiagnostic("ok", 0, "none", startedAt, deadline);
  if (answer.txHash !== null) return CLOSED.includes(answer.status)
    ? { disposition: "unknown", reason: "provider_request_closed", transactionHash: answer.txHash, diagnostic }
    : { disposition: "acknowledged", transactionHash: answer.txHash, diagnostic };
  if (PENDING.includes(answer.status)) return { disposition: "pending", diagnostic,
    ...(answer.mfa === null ? {} : { mfa: { ...answer.mfa, evidenceHash: answer.responseHash } }) };
  return { disposition: "unknown", reason: CLOSED.includes(answer.status) ? "provider_request_closed" : "provider_request_outcome_unknown", diagnostic };
}

/**
 * The submit's closed facts as the native lane's diagnostic: the helper's own check names the class (the runner's
 * timeout, exit or launch, the deadline, a refusing HTTP answer, a protocol check), and the provider's HTTP status or
 * error code its kind. Without facts it is `internal`: the outcome is unknown either way.
 */
function failedDiagnostic(d: MetaMaskSubmitDiagnostic | undefined, startedAt: number, deadline: MetaMaskNativeDeadline): MetaMaskNativeDiagnostic {
  if (d === undefined) return sendDiagnostic("internal", null, "none", startedAt, deadline);
  const code: MetaMaskNativeDiagnostic["code"] = d.check === "runner_timeout" ? "timeout" : d.check === "runner_exit" ? "exit"
    : d.check === "runner_launch" ? "start" : d.check === "deadline" || d.check === "clock" ? "deadline"
      : d.check === "session" || d.check === "http_status" ? "refused" : d.check === "unclassified" ? "internal" : "protocol";
  return sendDiagnostic(code, null, providerCode(d), startedAt, deadline);
}
function providerCode(d: MetaMaskSubmitDiagnostic): MetaMaskNativeDiagnostic["providerCode"] {
  const error = d.providerError, status = d.httpStatus;
  if (d.check === "session" || status === 401 || status === 403 || error === "UNAUTHORIZED" || error === "AUTH_REQUIRED") return "auth";
  if (error === "POLICY_VIOLATION" || error === "POLICY_REJECTED") return "policy";
  if (error === "MFA_REQUIRED") return "mfa";
  if (error === "INSUFFICIENT_FUNDS") return "funds";
  if (status === 429 || error === "RATE_LIMITED") return "rate_limit";
  return error !== null || status !== null && status >= 300 ? "other" : "none";
}
function sendDiagnostic(code: MetaMaskNativeDiagnostic["code"], exitCode: number | null, provider: MetaMaskNativeDiagnostic["providerCode"],
  startedAt: number, deadline: MetaMaskNativeDeadline): MetaMaskNativeDiagnostic {
  const left = Math.min(Date.parse(deadline.utcExpiresAt) - Date.now(), deadline.monotonicDeadlineMs - performance.now());
  return validateMetaMaskNativeDiagnostic({ stage: "sdk_send", code, exitCode, signal: null,
    durationMs: Math.min(86_400_000, Math.max(0, Math.floor(performance.now() - startedAt))),
    remainingMs: Math.max(0, Math.min(60_000, Math.floor(Number.isFinite(left) ? left : 0))), stderrClass: "none", providerCode: provider });
}
