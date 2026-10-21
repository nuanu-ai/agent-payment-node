import { isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { Address, Hex } from "../../model.js";
import { isMetaMaskEvmNamespace } from "../../metamask-namespace.js";
import { classifyMetaMaskPendingNotices, parseMetaMaskProcessOutput } from "../../metamask-process-output.js";
import type { MetaMaskProcessObservation } from "../../metamask-process-observation.js";
import { NodeMetaMaskProcessRunner, takeMetaMaskProcessFailureObservation, type MetaMaskProcessRunnerPort } from "../../metamask-process-runner.js";

/**
 * What the wallet answered; an unknown answer is never a reason to send again (the pinned nonce allows one landing).
 * An unknown answer carries the child process's exit and stream shape (`provider`), so its cause can be read later.
 */
export type MetaMaskRevocationSubmission =
  | { readonly disposition: "acknowledged"; readonly transactionHash: Hex; readonly requestIdHash: string | null }
  | { readonly disposition: "pending"; readonly requestIdHash: string }
  | { readonly disposition: "unknown"; readonly reason: string; readonly provider?: MetaMaskProcessObservation };
export interface MetaMaskRevocationWalletPort {
  send(input: { readonly chainId: number; readonly from: Address; readonly payload: Readonly<Record<string, Hex>>;
    readonly intent: string }): Promise<MetaMaskRevocationSubmission>;
}
const PENDING = new Set(["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"]);
const TOKEN = /^[A-Za-z0-9._:-]{1,256}$/u;

/**
 * The owner's MetaMask Agent Wallet CLI signs and broadcasts (`mm wallet send-transaction`, the path the native lane
 * uses), after its own Guard policy and MFA. APN first checks that the selected wallet is the delegator; a selected
 * wallet that differs refuses before anything is handed over.
 */
export class MetaMaskCliRevocationWallet implements MetaMaskRevocationWalletPort {
  constructor(private readonly runner: MetaMaskProcessRunnerPort = new NodeMetaMaskProcessRunner()) {}
  async send(input: Parameters<MetaMaskRevocationWalletPort["send"]>[0]): Promise<MetaMaskRevocationSubmission> {
    const selected = await this.runner.runJson(["wallet", "address", "--chain-namespace", "evm", "--json"]);
    try {
      const parsed = parseMetaMaskProcessOutput(selected.stdout), data = parsed?.envelope?.data;
      if (selected.exitCode !== 0 || parsed?.envelope?.ok !== true || !isPlainRecord(data) || data.mode !== "server" ||
        !isMetaMaskEvmNamespace(data.chainNamespace) || typeof data.address !== "string" || data.address.toLowerCase() !== input.from) {
        throw new ApnError("APN_PROFILE_DRIFT", "The MetaMask Agent Wallet's selected wallet is not this delegation's server wallet; nothing was sent.",
          { reason: "mm_revoke_wallet_mismatch" });
      }
    } finally { selected.stdout.fill(0); }
    let result: Awaited<ReturnType<MetaMaskProcessRunnerPort["runJson"]>>;
    try {
      result = await this.runner.runJson(["wallet", "send-transaction", "--chain-id", String(input.chainId),
        "--payload", JSON.stringify(input.payload), "--intent", input.intent, "--json"]);
    } catch (error) {
      return withProvider({ disposition: "unknown", reason: "provider_handoff_outcome_unknown" }, takeMetaMaskProcessFailureObservation(error));
    }
    try { return withProvider(submission(result.exitCode, result.stdout, input.from), result.observation); } finally { result.stdout.fill(0); }
  }
}

function withProvider(answer: MetaMaskRevocationSubmission, provider: MetaMaskProcessObservation | undefined): MetaMaskRevocationSubmission {
  return answer.disposition === "unknown" && provider !== undefined ? { ...answer, provider } : answer;
}

function submission(exitCode: number, stdout: Buffer, from: Address): MetaMaskRevocationSubmission {
  const parsed = parseMetaMaskProcessOutput(stdout);
  if (parsed === null) {
    return { disposition: "unknown", reason: stdout.toString("utf8").trim().length === 0 ? "provider_response_empty" : "provider_response_malformed" };
  }
  const notice = classifyMetaMaskPendingNotices(parsed.notices), data = parsed.envelope?.data;
  const hash = isPlainRecord(data) && typeof data.hash === "string" && /^0x[a-fA-F0-9]{64}$/u.test(data.hash) ? data.hash.toLowerCase() as Hex : undefined;
  const token = isPlainRecord(data) && typeof data.pollingId === "string" && TOKEN.test(data.pollingId) ? data.pollingId
    : notice.disposition === "pending" ? notice.recoveryToken : undefined;
  // The provider's request id stays private; its hash names it in output, as the gasless lane names its own.
  const requestIdHash = token === undefined ? null : sha256(`apn.metamask-revocation.request-id.v1\0${token}`);
  if (notice.disposition === "invalid" || (notice.disposition === "pending" && token !== notice.recoveryToken)) {
    return { disposition: "unknown", reason: "provider_identity_conflict" };
  }
  if (exitCode !== 0) return { disposition: "unknown", reason: "provider_handoff_outcome_unknown" };
  if (parsed.envelope?.ok === true && isPlainRecord(data)) {
    if (data.mode !== "server" || typeof data.address !== "string" || data.address.toLowerCase() !== from) {
      return { disposition: "unknown", reason: "provider_sender_mismatch" };
    }
    if (hash !== undefined) return { disposition: "acknowledged", transactionHash: hash, requestIdHash };
    if (requestIdHash !== null && typeof data.status === "string" && PENDING.has(data.status)) return { disposition: "pending", requestIdHash };
  }
  if (notice.disposition === "pending" && parsed.envelope === null && requestIdHash !== null) return { disposition: "pending", requestIdHash };
  return { disposition: "unknown", reason: "provider_handoff_outcome_unknown" };
}
