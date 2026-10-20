import { isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { isMetaMaskEvmNamespace } from "../../metamask-namespace.js";
import { classifyMetaMaskPendingNotices, parseMetaMaskProcessOutput } from "../../metamask-process-output.js";
import { NodeMetaMaskProcessRunner } from "../../metamask-process-runner.js";
const PENDING = new Set(["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"]);
const TOKEN = /^[A-Za-z0-9._:-]{1,256}$/u;
/**
 * The owner's MetaMask Agent Wallet CLI signs and broadcasts (`mm wallet send-transaction`, the path the native lane
 * uses), after its own Guard policy and MFA. APN first checks that the selected wallet is the delegator; a selected
 * wallet that differs refuses before anything is handed over.
 */
export class MetaMaskCliRevocationWallet {
    runner;
    constructor(runner = new NodeMetaMaskProcessRunner()) {
        this.runner = runner;
    }
    async send(input) {
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
        let result;
        try {
            result = await this.runner.runJson(["wallet", "send-transaction", "--chain-id", String(input.chainId),
                "--payload", JSON.stringify(input.payload), "--intent", input.intent, "--json"]);
        }
        catch {
            return { disposition: "unknown", reason: "provider_handoff_outcome_unknown" };
        }
        try {
            return submission(result.exitCode, result.stdout, input.from);
        }
        finally {
            result.stdout.fill(0);
        }
    }
}
function submission(exitCode, stdout, from) {
    const parsed = parseMetaMaskProcessOutput(stdout);
    if (parsed === null)
        return { disposition: "unknown", reason: "provider_response_malformed" };
    const notice = classifyMetaMaskPendingNotices(parsed.notices), data = parsed.envelope?.data;
    const hash = isPlainRecord(data) && typeof data.hash === "string" && /^0x[a-fA-F0-9]{64}$/u.test(data.hash) ? data.hash.toLowerCase() : undefined;
    const token = isPlainRecord(data) && typeof data.pollingId === "string" && TOKEN.test(data.pollingId) ? data.pollingId
        : notice.disposition === "pending" ? notice.recoveryToken : undefined;
    // The provider's request id stays private; its hash names it in output, as the gasless lane names its own.
    const requestIdHash = token === undefined ? null : sha256(`apn.metamask-revocation.request-id.v1\0${token}`);
    if (notice.disposition === "invalid" || (notice.disposition === "pending" && token !== notice.recoveryToken)) {
        return { disposition: "unknown", reason: "provider_identity_conflict" };
    }
    if (exitCode !== 0)
        return { disposition: "unknown", reason: "provider_handoff_outcome_unknown" };
    if (parsed.envelope?.ok === true && isPlainRecord(data)) {
        if (data.mode !== "server" || typeof data.address !== "string" || data.address.toLowerCase() !== from) {
            return { disposition: "unknown", reason: "provider_sender_mismatch" };
        }
        if (hash !== undefined)
            return { disposition: "acknowledged", transactionHash: hash, requestIdHash };
        if (requestIdHash !== null && typeof data.status === "string" && PENDING.has(data.status))
            return { disposition: "pending", requestIdHash };
    }
    if (notice.disposition === "pending" && parsed.envelope === null && requestIdHash !== null)
        return { disposition: "pending", requestIdHash };
    return { disposition: "unknown", reason: "provider_handoff_outcome_unknown" };
}
//# sourceMappingURL=wallet.js.map