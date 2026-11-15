import { randomUUID } from "node:crypto";
import { isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { Address, Hex } from "../../model.js";
import { isMetaMaskEvmNamespace } from "../../metamask-namespace.js";
import { parseMetaMaskProcessOutput } from "../../metamask-process-output.js";
import { NodeMetaMaskProcessRunner, type MetaMaskProcessRunnerPort } from "../../metamask-process-runner.js";
import { MM_REQUEST_CLOSED_STATUSES, MM_REQUEST_PENDING_STATUSES, metaMaskServerTransaction, sendMetaMaskServerTransaction,
  type MetaMaskCliPayload, type MetaMaskServerTransactionOutcome, type MetaMaskServerTransactionPort } from "../../metamask-server-transaction.js";
import { MetaMaskGaslessProviderClient } from "../client/process.js";
import type { MetaMaskSubmitDiagnostic } from "../client/submit-diagnostic.js";

/**
 * What the wallet answered for the one disable request, named by the hash of APN's own request id in every answer. An
 * unknown answer is not proof that nothing was sent; the revoke's next actions say which chain reads must hold before
 * another disable. It names MetaMask's error code from a refusing answer (`providerErrorCode`), the request's job status
 * when MetaMask answered one APN does not treat as live (`providerStatus`), and the send's closed facts
 * (`submitDiagnostic`), so its cause can be read later.
 */
export type MetaMaskRevocationSubmission =
  | { readonly disposition: "acknowledged"; readonly transactionHash: Hex; readonly requestIdHash: string }
  | { readonly disposition: "pending"; readonly requestIdHash: string }
  | { readonly disposition: "unknown"; readonly reason: string; readonly requestIdHash: string; readonly transactionHash?: Hex;
      readonly providerStatus?: string; readonly providerErrorCode?: string; readonly submitDiagnostic?: MetaMaskSubmitDiagnostic };
export interface MetaMaskRevocationWalletPort {
  send(input: { readonly chainId: number; readonly from: Address; readonly payload: MetaMaskCliPayload;
    readonly intent: string }): Promise<MetaMaskRevocationSubmission>;
}
/** The revoke's send bound, as the gasless relay submit's: the helper is killed after it and the outcome stays unknown. */
const SUBMIT_TIMEOUT_MS = 120_000;

/**
 * The owner's MetaMask server wallet signs and broadcasts the disable after its own Guard policy and MFA. APN first
 * checks with the MetaMask Agent Wallet CLI that its selected wallet is the delegator (a read): a selected wallet that
 * differs refuses before anything is handed over. APN then names the request id itself and sends the request once
 * through the sandboxed MetaMask helper the gasless lane uses (metamask-server-transaction.ts): the very request
 * `mm wallet send-transaction` sent for the same payload and intent, from mm's signed-in session in whichever project
 * holds the server wallet, as before. mm's own local request list does not hold it.
 */
export class MetaMaskSdkRevocationWallet implements MetaMaskRevocationWalletPort {
  constructor(private readonly runner: MetaMaskProcessRunnerPort = new NodeMetaMaskProcessRunner(),
    private readonly client: MetaMaskServerTransactionPort = new MetaMaskGaslessProviderClient()) {}
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
    // Built and checked before the helper starts: a malformed request refuses with nothing sent.
    const requestId = randomUUID();
    const transaction = metaMaskServerTransaction({ requestId, projectHash: null, from: input.from, chainId: input.chainId,
      payload: input.payload, intent: input.intent });
    return revocationSubmission(await sendMetaMaskServerTransaction(transaction, SUBMIT_TIMEOUT_MS, this.client),
      metaMaskRevocationRequestIdHash(requestId));
  }
}

/** The provider's request id stays private; its hash names it in output, as it has since 0.5.105. */
export function metaMaskRevocationRequestIdHash(requestId: string): string {
  return sha256(`apn.metamask-revocation.request-id.v1\0${requestId}`);
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
      ...(d !== undefined && d.providerError !== null ? { providerErrorCode: d.providerError } : {}), ...(d === undefined ? {} : { submitDiagnostic: d }) };
  }
  const { status, txHash } = outcome.answer, closed = MM_REQUEST_CLOSED_STATUSES.includes(status);
  if (txHash !== null && !closed) return { disposition: "acknowledged", transactionHash: txHash, requestIdHash };
  if (txHash === null && MM_REQUEST_PENDING_STATUSES.includes(status)) return { disposition: "pending", requestIdHash };
  return { disposition: "unknown", reason: closed ? "provider_request_closed" : "provider_request_outcome_unknown", requestIdHash,
    providerStatus: status, ...(txHash === null ? {} : { transactionHash: txHash }) };
}
