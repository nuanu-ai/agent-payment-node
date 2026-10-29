import { ApnError } from "../../errors.js";
import { type MetaMaskGaslessFailureReason } from "../reasons.js";
/**
 * Where a MetaMask gasless submit stopped (QA 0.5.79 MM-GASLESS-SUBMIT-UNKNOWN-079-002), as closed facts only: the
 * helper stage, whether APN's network policy let the one POST out, its HTTP status, the check that refused, and the
 * provider's error code or job status when they have a closed token form. No body, URL, header or identifier leaves.
 * It is shown with the attempt's own output and never stored: the outcome stays unknown whatever it says.
 */
/** `launch` is before the helper process exists; `runner` is the parent's view of a helper that ran and failed. */
export type SubmitStage = "launch" | "runner" | "private_state" | "sdk_load" | "hydrate" | "binding" | "body" | "post" | "response" | "complete" | "helper_response";
/**
 * `not_reached`: no POST could have left (only APN's own checks before it ran, or no helper process started);
 * `refused`: APN's body check refused it before sending; `sent`: it may have reached the provider; `unknown`: a helper
 * that ran failed, so it may or may not have left. Nothing but `not_reached` and `refused` rules out a sent POST.
 */
export type SubmitPost = "not_reached" | "refused" | "sent" | "unknown";
export type SubmitCheck = "none" | "body_mismatch" | "duplicate_request" | "unexpected_request" | "deadline" | "clock" | "session" | "http_status" | "no_answer" | "response_body" | "response_request_id" | "response_kind" | "response_status" | "response_tx" | "response_hash" | "incomplete" | "runner_launch" | "runner_exit" | "runner_timeout" | "runner_output" | "response_invalid" | "unclassified";
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
/** An upper-case token, or null: provider text never crosses as anything else. */
export declare function submitToken(value: unknown): string | null;
/** The error code a non-2xx JSON answer names at `error.code`, `code` or `errorCode`, as a token. */
export declare function submitErrorCode(body: string): string | null;
export declare function validateSubmitDiagnostic(value: unknown): MetaMaskSubmitDiagnostic;
export declare function submitDiagnostic(stage: SubmitStage, facts: Omit<MetaMaskSubmitDiagnostic, "mode" | "stage">): MetaMaskSubmitDiagnostic;
/** The parent's diagnostic of a helper that failed: before it existed nothing was sent; after it ran nothing is known. */
export declare function runnerDiagnostic(check: Extract<SubmitCheck, "runner_launch" | "runner_exit" | "runner_timeout" | "runner_output" | "response_invalid">, started: boolean): MetaMaskSubmitDiagnostic;
/** The submit failure as an APN error whose details carry the diagnostic as flat fields (ErrorDetail values only). */
export declare function submitFailureError(reason: MetaMaskGaslessFailureReason, d: MetaMaskSubmitDiagnostic): ApnError;
/** The diagnostic a submit failure carried across the helper boundary, if any. */
export declare function takeSubmitDiagnostic(error: unknown): MetaMaskSubmitDiagnostic | undefined;
