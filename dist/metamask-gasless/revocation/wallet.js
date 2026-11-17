import { isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { isMetaMaskEvmNamespace } from "../../metamask-namespace.js";
import { readMetaMaskNativeServerRequest } from "../../metamask-native-request-server-read.js";
import { parseMetaMaskProcessOutput } from "../../metamask-process-output.js";
import { NodeMetaMaskProcessRunner } from "../../metamask-process-runner.js";
import { MM_REQUEST_CLOSED_STATUSES, MM_REQUEST_PENDING_STATUSES, metaMaskServerTransaction, sendMetaMaskServerTransaction } from "../../metamask-server-transaction.js";
import { MetaMaskGaslessProviderClient } from "../client/process.js";
import { metaMaskRevocationRequestIdHash } from "./requests.js";
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
export class MetaMaskSdkRevocationWallet {
    runner;
    client;
    constructor(runner = new NodeMetaMaskProcessRunner(), client = new MetaMaskGaslessProviderClient()) {
        this.runner = runner;
        this.client = client;
    }
    async check(input) {
        const selected = await this.runner.runJson(["wallet", "address", "--chain-namespace", "evm", "--json"]);
        try {
            const parsed = parseMetaMaskProcessOutput(selected.stdout), data = parsed?.envelope?.data;
            if (selected.exitCode !== 0 || parsed?.envelope?.ok !== true || !isPlainRecord(data) || data.mode !== "server" ||
                !isMetaMaskEvmNamespace(data.chainNamespace) || typeof data.address !== "string" || data.address.toLowerCase() !== input.from) {
                throw new ApnError("APN_PROFILE_DRIFT", "The MetaMask Agent Wallet's selected wallet is not this delegation's server wallet; nothing was sent.", { reason: "mm_revoke_wallet_mismatch" });
            }
        }
        finally {
            selected.stdout.fill(0);
        }
        // Built and checked before the id is sealed: a malformed request refuses with nothing sealed or sent. The helper lets
        // the POST leave only before `expiresAt`, its own kill bound from now.
        return metaMaskServerTransaction({ requestId: input.requestId, projectHash: null, from: input.from, chainId: input.chainId,
            payload: input.payload, intent: input.intent, expiresAt: new Date(Date.now() + SUBMIT_TIMEOUT_MS).toISOString() });
    }
    async send(request) {
        return revocationSubmission(await sendMetaMaskServerTransaction(request, SUBMIT_TIMEOUT_MS, this.client), metaMaskRevocationRequestIdHash(request.requestId));
    }
    async sessionProject() {
        let status;
        try {
            status = await this.runner.runJson(["auth", "status", "--json"]);
        }
        catch {
            return { reason: "metamask_session_read_failed" };
        }
        try {
            const parsed = parseMetaMaskProcessOutput(status.stdout), data = parsed?.envelope?.data;
            const summary = isPlainRecord(data) ? data.summary : undefined;
            if (status.exitCode !== 0 || parsed?.envelope?.ok !== true || !isPlainRecord(data) || data.authenticated !== true ||
                !isPlainRecord(summary) || summary.mode !== "session" || typeof summary.projectId !== "string" ||
                !PROJECT_ID.test(summary.projectId))
                return { reason: "metamask_session_required" };
            return { projectHash: sha256(summary.projectId) };
        }
        finally {
            status.stdout.fill(0);
        }
    }
    async read(requestId, projectHash, binding) {
        return await readMetaMaskNativeServerRequest(requestId, projectHash, binding, this.client);
    }
}
/** The project id form the native transfer accepts from `mm auth status`. */
const PROJECT_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
/** The session read's closed reasons with a cause of their own; any other reason there is `session_files`. */
const SESSION_CAUSES = {
    mm_gasless_binding_changed: "session_binding", mm_gasless_session_unavailable: "session_signed_out",
    mm_gasless_session_expired: "session_signed_out", mm_gasless_state_busy: "session_busy", mm_gasless_state_security: "session_permissions",
};
export function metaMaskRevocationUnsentCause(submission) {
    if (submission.disposition !== "unknown" || submission.submitDiagnostic === undefined || submission.submitDiagnostic.post !== "not_reached")
        return undefined;
    const d = submission.submitDiagnostic;
    if (d.check === "deadline" || d.check === "clock")
        return d.check;
    if (d.stage === "private_state") {
        const reason = submission.helperFailure;
        return reason !== undefined && Object.hasOwn(SESSION_CAUSES, reason) ? SESSION_CAUSES[reason] : "session_files";
    }
    return d.stage === "launch" || d.stage === "sdk_load" || d.stage === "hydrate" || d.stage === "binding" ? d.stage : undefined;
}
/**
 * A hash with a live or settled status is acknowledged; a request still before its hash is pending (MetaMask may wait on
 * the owner's MFA); a closed request, a status APN does not know and every failure once the helper may have started
 * stay unknown, with what MetaMask said when it said something.
 */
function revocationSubmission(outcome, requestIdHash) {
    if (outcome.kind === "unknown") {
        const d = outcome.diagnostic;
        return { disposition: "unknown", reason: outcome.reason, requestIdHash,
            ...(d !== undefined && d.providerError !== null ? { providerErrorCode: d.providerError } : {}), ...(d === undefined ? {} : { submitDiagnostic: d }),
            ...(outcome.helperFailure === undefined ? {} : { helperFailure: outcome.helperFailure }) };
    }
    const { status, txHash } = outcome.answer, closed = MM_REQUEST_CLOSED_STATUSES.includes(status);
    if (txHash !== null && !closed)
        return { disposition: "acknowledged", transactionHash: txHash, requestIdHash };
    if (txHash === null && MM_REQUEST_PENDING_STATUSES.includes(status))
        return { disposition: "pending", requestIdHash };
    return { disposition: "unknown", reason: closed ? "provider_request_closed" : "provider_request_outcome_unknown", requestIdHash,
        providerStatus: status, ...(txHash === null ? {} : { transactionHash: txHash }) };
}
//# sourceMappingURL=wallet.js.map