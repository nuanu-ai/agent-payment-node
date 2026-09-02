import { canonicalJson, isPlainRecord } from "./canonical.js";
import { isMetaMaskEvmNamespace } from "./metamask-namespace.js";
import type { Address, Hex } from "./model.js";
import type { X402SigningIntent, X402SigningPort, X402SigningResult } from "./provider-ports.js";
import type { MetaMaskProcessResult, MetaMaskProcessRunnerPort } from "./metamask-process-runner.js";
import { classifyMetaMaskPendingNotices, parseMetaMaskProcessOutput } from "./metamask-process-output.js";

type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;

const PENDING_STATES = new Set(["EVALUATING", "AWAITING_MFA", "SIGNING"]);
const SUCCESS_STATES = new Set(["SIGNED", "APPROVED"]);
const FAILURE_STATES = new Set(["FAILED"]);
const DEFAULT_WATCH_SECONDS = 60;

export class MetaMaskX402Adapter implements X402SigningPort {
  readonly mode = "provider_detached_eip3009_apn_paid_retry" as const;

  constructor(
    private readonly runner: MetaMaskProcessRunnerPort,
    private readonly exclusive: Exclusive = async (work) => await work(),
  ) {}

  async request(input: X402SigningIntent): Promise<X402SigningResult> {
    return await this.exclusive(async () => {
      await this.selectAndCrossCheck(input.sender);
      const payload = canonicalJson({
        domain: {
          name: input.tokenDomain.name,
          version: input.tokenDomain.version,
          chainId: Number(input.chainId),
          verifyingContract: input.token,
        },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: input.authorization,
      });
      let result: MetaMaskProcessResult;
      try {
        result = await this.runner.runJson([
          "wallet", "sign-typed-data",
          "--chain-id", input.chainId,
          "--payload", payload,
          "--intent", input.humanIntent,
          "--json",
        ]);
      } catch {
        return { disposition: "ambiguous", reason: "provider_invocation_outcome_unknown" };
      }
      try { return parseSigningResult(result, input.sender); }
      finally { result.stdout.fill(0); }
    });
  }

  async observe(input: {
    readonly recoveryToken: string;
    readonly sender: Address;
    readonly waitSeconds?: number;
  }): Promise<X402SigningResult> {
    return await this.exclusive(async () => {
      if (!validRecoveryToken(input.recoveryToken)) {
        return { disposition: "ambiguous", reason: "provider_recovery_token_invalid" };
      }
      await this.selectAndCrossCheck(input.sender);
      const waitSeconds = input.waitSeconds ?? DEFAULT_WATCH_SECONDS;
      let result: MetaMaskProcessResult;
      try {
        result = await this.runner.runJson([
          "wallet", "requests", "watch", input.recoveryToken,
          "--wallet-timeout", String(waitSeconds),
          "--json",
        ], waitSeconds * 1000 + 5_000);
      } catch {
        return { disposition: "pending", recoveryToken: input.recoveryToken, providerState: "WATCH_TIMEOUT" };
      }
      try { return parseWatchResult(result, input.recoveryToken); }
      finally { result.stdout.fill(0); }
    });
  }

  private async selectAndCrossCheck(expected: Address): Promise<void> {
    const selected = await this.runner.runJson([
      "wallet", "select", expected, "--chain-namespace", "evm", "--json",
    ]);
    try {
      if (!successfulData(selected)) throw new Error("selection failed");
    } finally { selected.stdout.fill(0); }

    const observed = await this.runner.runJson([
      "wallet", "address", "--chain-namespace", "evm", "--json",
    ]);
    try {
      const data = successfulData(observed);
      if (
        data === null || data.mode !== "server" || !isMetaMaskEvmNamespace(data.chainNamespace) ||
        typeof data.address !== "string" || data.address.toLowerCase() !== expected.toLowerCase()
      ) throw new Error("selected signer mismatch");
    } finally { observed.stdout.fill(0); }
  }
}

function parseSigningResult(result: MetaMaskProcessResult, expected: Address): X402SigningResult {
  const parsed = parseMetaMaskProcessOutput(result.stdout);
  if (parsed === null) return ambiguous("provider_response_malformed");
  const pendingNotice = classifyMetaMaskPendingNotices(parsed.notices);
  if (pendingNotice.disposition === "invalid") return ambiguous(pendingNotice.reason);
  const envelope = parsed.envelope;
  if (envelope === null) return pendingNotice.disposition === "pending" ? pendingNotice : ambiguous("provider_response_malformed");
  if (!isPlainRecord(envelope)) return ambiguous("provider_response_malformed");
  if (result.exitCode !== 0 || envelope.ok !== true) {
    const failure = parseFailure(envelope);
    return pendingNotice.disposition === "pending" && failure.disposition === "ambiguous" ? pendingNotice : failure;
  }
  if (!isPlainRecord(envelope.data)) return ambiguous("provider_response_malformed");
  const data = envelope.data;
  if (
    data.mode !== "server" || typeof data.address !== "string" ||
    data.address.toLowerCase() !== expected.toLowerCase()
  ) return ambiguous("provider_signer_mismatch");
  return reconcilePendingNotice(classify(data), pendingNotice, data.pollingId);
}

function parseWatchResult(result: MetaMaskProcessResult, recoveryToken: string): X402SigningResult {
  const parsed = parseMetaMaskProcessOutput(result.stdout);
  if (parsed === null) return ambiguous("provider_response_malformed");
  const pendingNotice = classifyMetaMaskPendingNotices(parsed.notices, recoveryToken);
  if (pendingNotice.disposition === "invalid") return ambiguous(pendingNotice.reason);
  const envelope = parsed.envelope;
  if (envelope === null) return pendingNotice.disposition === "pending" ? pendingNotice : ambiguous("provider_response_malformed");
  if (!isPlainRecord(envelope)) return ambiguous("provider_response_malformed");
  if (result.exitCode !== 0 || envelope.ok !== true) {
    const failure = parseFailure(envelope, recoveryToken);
    return pendingNotice.disposition === "pending" && failure.disposition === "ambiguous" ? pendingNotice : failure;
  }
  if (!isPlainRecord(envelope.data) || !isPlainRecord(envelope.data.request) || !isPlainRecord(envelope.data.status)) {
    return ambiguous("provider_response_malformed");
  }
  const request = envelope.data.request;
  if (request.pollingId !== recoveryToken || request.kind !== "signature") {
    return ambiguous("provider_recovery_identity_mismatch");
  }
  const status = envelope.data.status;
  const requestSignature = canonicalSignature(request.signature);
  const statusSignature = canonicalSignature(status.signature);
  if (requestSignature !== undefined && statusSignature !== undefined && requestSignature !== statusSignature) {
    return ambiguous("provider_signature_identity_conflict");
  }
  return reconcilePendingNotice(
    classify({ ...status, signature: statusSignature ?? requestSignature, pollingId: recoveryToken }),
    pendingNotice,
  );
}

function classify(data: Record<string, unknown>): X402SigningResult {
  const status = typeof data.status === "string" ? data.status : undefined;
  const signature = canonicalSignature(data.signature);
  if (signature !== undefined && status !== undefined && SUCCESS_STATES.has(status)) {
    return { disposition: "signed", signature };
  }
  if (status === "DENIED") return { disposition: "rejected", reason: "provider_denied" };
  if (status === "EXPIRED") return { disposition: "rejected", reason: "provider_expired" };
  const pollingId = typeof data.pollingId === "string" && validRecoveryToken(data.pollingId)
    ? data.pollingId : undefined;
  if (status !== undefined && PENDING_STATES.has(status) && pollingId !== undefined) {
    return { disposition: "pending", recoveryToken: pollingId, providerState: status };
  }
  if (status !== undefined && FAILURE_STATES.has(status)) {
    return ambiguous("provider_terminal_state_without_signature");
  }
  return ambiguous(signature === undefined ? "provider_signature_missing" : "provider_signature_state_invalid");
}

function parseFailure(value: Record<string, unknown>, recoveryToken?: string): X402SigningResult {
  const error = isPlainRecord(value.error) ? value.error : {};
  const code = typeof error.code === "string" ? error.code : undefined;
  if (code === "TX_DENIED") {
    return { disposition: "rejected", reason: "provider_denied" };
  }
  if (code === "TX_EXPIRED") {
    return { disposition: "rejected", reason: "provider_expired" };
  }
  if (code === "JOB_TIMEOUT" && recoveryToken !== undefined) {
    return { disposition: "pending", recoveryToken, providerState: "WATCH_TIMEOUT" };
  }
  return ambiguous(code === "REQUEST_NOT_FOUND" ? "provider_request_not_found" : "provider_exit_unclassified");
}

function successfulData(result: MetaMaskProcessResult): Record<string, unknown> | null {
  const value = parseMetaMaskProcessOutput(result.stdout)?.envelope;
  return result.exitCode === 0 && isPlainRecord(value) && value.ok === true && isPlainRecord(value.data)
    ? value.data : null;
}

function reconcilePendingNotice(
  result: X402SigningResult,
  notice: ReturnType<typeof classifyMetaMaskPendingNotices>,
  summaryToken?: unknown,
): X402SigningResult {
  if (notice.disposition !== "pending") return result;
  if (summaryToken !== undefined && (
    typeof summaryToken !== "string" || !validRecoveryToken(summaryToken) || summaryToken !== notice.recoveryToken
  )) return ambiguous("provider_recovery_identity_mismatch");
  if (result.disposition !== "pending") return result;
  return notice.recoveryToken === result.recoveryToken
    ? result
    : ambiguous("provider_recovery_identity_mismatch");
}

function canonicalSignature(value: unknown): Hex | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]{130}$/u.test(value)
    ? value.toLowerCase() as Hex : undefined;
}

function validRecoveryToken(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,256}$/u.test(value);
}

function ambiguous(reason: string): X402SigningResult {
  return { disposition: "ambiguous", reason };
}
