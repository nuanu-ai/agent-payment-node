import { isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { Address, Hex } from "../../model.js";
import { isMetaMaskEvmNamespace } from "../../metamask-namespace.js";
import { readMetaMaskNativeServerRequest, type MetaMaskNativeRequestBinding, type MetaMaskNativeServerRequestAnswer,
  type MetaMaskNativeServerRequestPort } from "../../metamask-native-request-server-read.js";
import { parseMetaMaskProcessOutput } from "../../metamask-process-output.js";
import { NodeMetaMaskProcessRunner, type MetaMaskProcessResult, type MetaMaskProcessRunnerPort } from "../../metamask-process-runner.js";
import { MM_REQUEST_CLOSED_STATUSES, MM_REQUEST_PENDING_STATUSES, metaMaskServerTransaction, sendMetaMaskServerTransaction,
  type MetaMaskCliPayload, type MetaMaskServerTransactionOutcome, type MetaMaskServerTransactionPort } from "../../metamask-server-transaction.js";
import type { MetaMaskServerTransactionInput } from "../client/server-transaction.js";
import { MetaMaskGaslessProviderClient } from "../client/process.js";
import type { MetaMaskSubmitDiagnostic } from "../client/submit-diagnostic.js";
import { metaMaskRevocationRequestIdHash, type MetaMaskRevocationReadPort, type MetaMaskRevocationSessionProject } from "./requests.js";

/**
 * What the wallet answered for the one disable request, named in every answer by the hash of APN's own request id
 * (`metaMaskRevocationRequestIdHash`, the hash its seal is filed under). An unknown answer is not proof that nothing was
 * sent; the revoke's next actions say which chain reads must hold before another disable. It names MetaMask's error code from a refusing answer (`providerErrorCode`), the request's job status
 * when MetaMask answered one APN does not treat as live (`providerStatus`), the send's closed facts (`submitDiagnostic`)
 * and the helper's own closed refusal reason (`helperFailure`, an `mm_gasless_*` reason), so its cause can be read later.
 */
export type MetaMaskRevocationSubmission =
  | { readonly disposition: "acknowledged"; readonly transactionHash: Hex; readonly requestIdHash: string }
  | { readonly disposition: "pending"; readonly requestIdHash: string }
  | { readonly disposition: "unknown"; readonly reason: string; readonly requestIdHash: string; readonly transactionHash?: Hex;
      readonly providerStatus?: string; readonly providerErrorCode?: string; readonly submitDiagnostic?: MetaMaskSubmitDiagnostic;
      readonly helperFailure?: string };
/** One disable request, under the id APN named for it (a v4 UUID). */
export interface MetaMaskRevocationSendInput {
  readonly requestId: string;
  readonly chainId: number;
  readonly from: Address;
  readonly payload: MetaMaskCliPayload;
  readonly intent: string;
}
/**
 * The owner's wallet in two steps around the seal of the request id: `check` before it (nothing is sealed when it
 * refuses), `send` after it.
 */
export interface MetaMaskRevocationWalletPort {
  /** The selected-wallet check and the request built and checked as the send builds it; nothing is sent. */
  check(input: MetaMaskRevocationSendInput): Promise<void>;
  /** Sends the checked request once under its sealed id; never sends it again. */
  send(input: MetaMaskRevocationSendInput): Promise<MetaMaskRevocationSubmission>;
}
/** The revoke's send bound, as the gasless relay submit's: the helper is killed after it and the outcome stays unknown. */
const SUBMIT_TIMEOUT_MS = 120_000;

/**
 * The owner's MetaMask server wallet signs and broadcasts the disable after its own Guard policy and MFA. `check` asks
 * the MetaMask Agent Wallet CLI whether its selected wallet is the delegator (a read): a selected wallet that differs
 * refuses before anything is sealed or handed over. `send` sends the request, under the id APN named and sealed, once
 * through the sandboxed MetaMask helper the gasless lane uses (metamask-server-transaction.ts): the very request
 * `mm wallet send-transaction` sent for the same payload and intent, from mm's signed-in session in whichever project
 * holds the server wallet, as before. mm's own local request list does not hold it. For `operation resume` it also
 * reads a sealed request again: the session's project from `mm auth status`, then the request by its id from
 * MetaMask's server through the same helper (the read the native transfer uses).
 */
export class MetaMaskSdkRevocationWallet implements MetaMaskRevocationWalletPort, MetaMaskRevocationReadPort {
  constructor(private readonly runner: MetaMaskProcessRunnerPort = new NodeMetaMaskProcessRunner(),
    private readonly client: MetaMaskServerTransactionPort & MetaMaskNativeServerRequestPort = new MetaMaskGaslessProviderClient()) {}
  async check(input: MetaMaskRevocationSendInput): Promise<void> {
    const selected = await this.runner.runJson(["wallet", "address", "--chain-namespace", "evm", "--json"]);
    try {
      const parsed = parseMetaMaskProcessOutput(selected.stdout), data = parsed?.envelope?.data;
      if (selected.exitCode !== 0 || parsed?.envelope?.ok !== true || !isPlainRecord(data) || data.mode !== "server" ||
        !isMetaMaskEvmNamespace(data.chainNamespace) || typeof data.address !== "string" || data.address.toLowerCase() !== input.from) {
        throw new ApnError("APN_PROFILE_DRIFT", "The MetaMask Agent Wallet's selected wallet is not this delegation's server wallet; nothing was sent.",
          { reason: "mm_revoke_wallet_mismatch" });
      }
    } finally { selected.stdout.fill(0); }
    // Built and checked before the id is sealed: a malformed request refuses with nothing sealed or sent.
    revocationTransaction(input);
  }
  async send(input: MetaMaskRevocationSendInput): Promise<MetaMaskRevocationSubmission> {
    return revocationSubmission(await sendMetaMaskServerTransaction(revocationTransaction(input), SUBMIT_TIMEOUT_MS, this.client),
      metaMaskRevocationRequestIdHash(input.requestId));
  }
  async sessionProject(): Promise<MetaMaskRevocationSessionProject> {
    let status: MetaMaskProcessResult;
    try { status = await this.runner.runJson(["auth", "status", "--json"]); }
    catch { return { reason: "metamask_session_read_failed" }; }
    try {
      const parsed = parseMetaMaskProcessOutput(status.stdout), data = parsed?.envelope?.data;
      const summary = isPlainRecord(data) ? data.summary : undefined;
      if (status.exitCode !== 0 || parsed?.envelope?.ok !== true || !isPlainRecord(data) || data.authenticated !== true ||
        !isPlainRecord(summary) || summary.mode !== "session" || typeof summary.projectId !== "string" ||
        !PROJECT_ID.test(summary.projectId)) return { reason: "metamask_session_required" };
      return { projectHash: sha256(summary.projectId) };
    } finally { status.stdout.fill(0); }
  }
  async read(requestId: string, projectHash: string, binding: MetaMaskNativeRequestBinding): Promise<MetaMaskNativeServerRequestAnswer> {
    return await readMetaMaskNativeServerRequest(requestId, projectHash, binding, this.client);
  }
}
/** The project id form the native transfer accepts from `mm auth status`. */
const PROJECT_ID = /^[A-Za-z0-9._:-]{1,256}$/u;

/** The helper's request; the helper lets the POST leave only within its own kill bound. */
function revocationTransaction(input: MetaMaskRevocationSendInput): MetaMaskServerTransactionInput {
  return metaMaskServerTransaction({ requestId: input.requestId, projectHash: null, from: input.from, chainId: input.chainId,
    payload: input.payload, intent: input.intent, expiresAt: new Date(Date.now() + SUBMIT_TIMEOUT_MS).toISOString() });
}

/**
 * Why the disable never reached the network, when the helper's own closed facts say so: its deadline or clock check right
 * before the bytes would go, its process that never started, the session read (another project or selected wallet,
 * signed out or expired, another `mm` writing its files, files not private to this user, or files that could not be
 * read), the SDK load, the SDK's session restore, or the SDK's server wallet. Any other fact is `undefined`: the request
 * may have left. The disposition stays unknown either way; only the next step differs.
 */
export type MetaMaskRevocationUnsentCause = "deadline" | "clock" | "launch" | "session_binding" | "session_signed_out" | "session_busy" |
  "session_permissions" | "session_files" | "sdk_load" | "hydrate" | "binding";
/** The session read's closed reasons with a cause of their own; any other reason there is `session_files`. */
const SESSION_CAUSES: Readonly<Record<string, MetaMaskRevocationUnsentCause>> = {
  mm_gasless_binding_changed: "session_binding", mm_gasless_session_unavailable: "session_signed_out",
  mm_gasless_session_expired: "session_signed_out", mm_gasless_state_busy: "session_busy", mm_gasless_state_security: "session_permissions",
};
export function metaMaskRevocationUnsentCause(submission: MetaMaskRevocationSubmission): MetaMaskRevocationUnsentCause | undefined {
  if (submission.disposition !== "unknown" || submission.submitDiagnostic === undefined || submission.submitDiagnostic.post !== "not_reached") return undefined;
  const d = submission.submitDiagnostic;
  if (d.check === "deadline" || d.check === "clock") return d.check;
  if (d.stage === "private_state") {
    const reason = submission.helperFailure;
    return reason !== undefined && Object.hasOwn(SESSION_CAUSES, reason) ? SESSION_CAUSES[reason]! : "session_files";
  }
  return d.stage === "launch" || d.stage === "sdk_load" || d.stage === "hydrate" || d.stage === "binding" ? d.stage : undefined;
}

/**
 * A hash with a live or settled status is acknowledged; a request still before its hash is pending (MetaMask may wait on
 * the owner's MFA); a closed request, a status APN does not know and every failure once the helper may have started
 * stay unknown, with what MetaMask said when it said something.
 */
function revocationSubmission(outcome: MetaMaskServerTransactionOutcome, requestIdHash: string): MetaMaskRevocationSubmission {
  if (outcome.kind === "unknown") {
    const d = outcome.diagnostic;
    return { disposition: "unknown", reason: outcome.reason, requestIdHash,
      ...(d !== undefined && d.providerError !== null ? { providerErrorCode: d.providerError } : {}), ...(d === undefined ? {} : { submitDiagnostic: d }),
      ...(outcome.helperFailure === undefined ? {} : { helperFailure: outcome.helperFailure }) };
  }
  const { status, txHash } = outcome.answer, closed = MM_REQUEST_CLOSED_STATUSES.includes(status);
  if (txHash !== null && !closed) return { disposition: "acknowledged", transactionHash: txHash, requestIdHash };
  if (txHash === null && MM_REQUEST_PENDING_STATUSES.includes(status)) return { disposition: "pending", requestIdHash };
  return { disposition: "unknown", reason: closed ? "provider_request_closed" : "provider_request_outcome_unknown", requestIdHash,
    providerStatus: status, ...(txHash === null ? {} : { transactionHash: txHash }) };
}
