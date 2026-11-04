import { ApnError } from "../../errors.js";
import { type MetaMaskGaslessFailureReason } from "../reasons.js";
import { type MetaMaskJobTx } from "./job-tx.js";
import { type SubmitCheck } from "./submit-diagnostic.js";
/**
 * Which of APN's checks refused MetaMask's answer to one job status read, as closed facts: the check, the job status
 * when it is a token, and how the answer's `tx` compared with the request (job-tx.ts). It is shown with that read's
 * own output and never stored; a failure outside these checks (network, HTTP status, session) carries none.
 */
export type ObserveCheck = Extract<SubmitCheck, "response_body" | "response_request_id" | "response_kind" | "response_status" | "response_tx" | "response_hash">;
export interface MetaMaskObserveDiagnostic {
    readonly mode: "observe";
    readonly check: ObserveCheck;
    /** The job status of an answer APN does not recognize or whose `tx` it refused, when it is an upper-case token. */
    readonly providerStatus: string | null;
    /** The answer's `tx` compared with the request, exactly when the `response_tx` check refused it. */
    readonly responseTx: MetaMaskJobTx | null;
}
export declare function validateObserveDiagnostic(value: unknown): MetaMaskObserveDiagnostic;
export declare function observeDiagnostic(check: ObserveCheck, providerStatus: string | null, responseTx: MetaMaskJobTx | null): MetaMaskObserveDiagnostic;
/** The read failure as an APN error whose details carry the diagnostic as flat fields (ErrorDetail values only). */
export declare function observeFailureError(reason: MetaMaskGaslessFailureReason, d: MetaMaskObserveDiagnostic): ApnError;
/** The diagnostic a read failure carried across the helper boundary, if any. */
export declare function takeObserveDiagnostic(error: unknown): MetaMaskObserveDiagnostic | undefined;
