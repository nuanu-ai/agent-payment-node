import { isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import type { Address, Hex } from "./model.js";
import type { DirectExecutionPort } from "./provider-ports.js";
import type { MetaMaskProcessResult, MetaMaskProcessRunnerPort } from "./metamask-process-runner.js";

type DirectResult = Awaited<ReturnType<NonNullable<DirectExecutionPort["execute"]>>>;
type ObserveResult = Awaited<ReturnType<NonNullable<DirectExecutionPort["observe"]>>>;
type EffectResult = Exclude<DirectResult, { readonly disposition: "not_started" }>;
type Exclusive = <T>(work: () => Promise<T>) => Promise<T>;

const PENDING_STATES = new Set(["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"]);
const UNSAFE_FAILURE_STATES = new Set([
  "FAILED", "BROADCAST_FAILED", "BROADCAST_TRACKING_EXPIRED", "CONFIRMATION_TRACKING_EXPIRED",
]);
const PROVIDER_WATCH_DEFAULT_SECONDS = 60;

export class MetaMaskDirectAdapter implements DirectExecutionPort {
  readonly mode = "provider_atomic_send" as const;

  constructor(
    private readonly runner: MetaMaskProcessRunnerPort,
    private readonly exclusive: Exclusive = async (work) => await work(),
  ) {}

  async execute(input: {
    readonly amountDecimal: string;
    readonly recipient: Address;
    readonly sender: Address;
  }): Promise<DirectResult> {
    return await this.exclusive(async () => {
      try {
        await this.selectAndCrossCheck(input.sender);
      } catch {
        return { disposition: "not_started", reason: "provider_child_not_created" };
      }
      let result: MetaMaskProcessResult;
      try {
        result = await this.runner.runJson([
          "transfer",
          "--to", input.recipient,
          "--amount", input.amountDecimal,
          "--chain-id", String(CHAIN_ID),
          "--token", BASE_USDC,
          "--json",
        ]);
      } catch {
        return { disposition: "ambiguous", reason: "provider_invocation_outcome_unknown" };
      }
      try { return parseTransferResult(result, input.sender); }
      finally { result.stdout.fill(0); }
    });
  }

  async observe(input: {
    readonly recoveryToken: string;
    readonly sender: Address;
    readonly waitSeconds?: number;
  }): Promise<ObserveResult> {
    return await this.exclusive(async () => {
      if (!isRecoveryToken(input.recoveryToken)) {
        return { disposition: "ambiguous", reason: "provider_recovery_token_invalid" };
      }
      await this.selectAndCrossCheck(input.sender);
      const waitSeconds = input.waitSeconds ?? PROVIDER_WATCH_DEFAULT_SECONDS;
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
      if (!isSuccess(selected)) throw new Error("selection failed");
    } finally {
      selected.stdout.fill(0);
    }
    const observed = await this.runner.runJson([
      "wallet", "address", "--chain-namespace", "evm", "--json",
    ]);
    try {
      const data = successData(observed);
      if (
        data === null || data.mode !== "server" || data.chainNamespace !== "eip155" ||
        typeof data.address !== "string" || data.address.toLowerCase() !== expected.toLowerCase()
      ) throw new Error("selected sender mismatch");
    } finally {
      observed.stdout.fill(0);
    }
  }
}

function parseTransferResult(result: MetaMaskProcessResult, expected: Address): DirectResult {
  const value = parseEnvelope(result.stdout);
  if (!isPlainRecord(value)) return { disposition: "ambiguous", reason: "provider_response_malformed" };
  if (result.exitCode !== 0 || value.ok !== true) return parseProviderFailure(value);
  if (!isPlainRecord(value.data)) return { disposition: "ambiguous", reason: "provider_response_malformed" };
  const data = value.data;
  if (
    data.mode !== "server" || typeof data.address !== "string" ||
    data.address.toLowerCase() !== expected.toLowerCase()
  ) return { disposition: "ambiguous", reason: "provider_sender_mismatch" };
  return classifyEffect(data);
}

function parseWatchResult(result: MetaMaskProcessResult, recoveryToken: string): ObserveResult {
  const value = parseEnvelope(result.stdout);
  if (!isPlainRecord(value)) return { disposition: "ambiguous", reason: "provider_response_malformed" };
  if (result.exitCode !== 0 || value.ok !== true) {
    return parseProviderFailure(value, recoveryToken);
  }
  if (!isPlainRecord(value.data) || !isPlainRecord(value.data.request) || !isPlainRecord(value.data.status)) {
    return { disposition: "ambiguous", reason: "provider_response_malformed" };
  }
  const request = value.data.request;
  if (request.pollingId !== recoveryToken || request.kind !== "transaction") {
    return { disposition: "ambiguous", reason: "provider_recovery_identity_mismatch" };
  }
  const status = value.data.status;
  const requestHash = validHash(request.txHash) ? request.txHash : undefined;
  const statusHash = validHash(status.txHash) ? status.txHash : undefined;
  if (requestHash !== undefined && statusHash !== undefined && requestHash.toLowerCase() !== statusHash.toLowerCase()) {
    return { disposition: "ambiguous", reason: "provider_transaction_identity_conflict" };
  }
  return classifyEffect({ ...status, hash: statusHash ?? requestHash, pollingId: recoveryToken });
}

function classifyEffect(data: Record<string, unknown>): EffectResult {
  const hash = validHash(data.hash) ? data.hash : validHash(data.txHash) ? data.txHash : undefined;
  if (hash !== undefined) return { disposition: "acknowledged", transactionHash: hash as Hex };
  const status = typeof data.status === "string" ? data.status : undefined;
  if (status === "DENIED") return { disposition: "rejected", reason: "provider_denied" };
  if (status === "EXPIRED") return { disposition: "rejected", reason: "provider_expired" };
  const pollingId = typeof data.pollingId === "string" && isRecoveryToken(data.pollingId) ? data.pollingId : undefined;
  if (status !== undefined && PENDING_STATES.has(status) && pollingId !== undefined) {
    return { disposition: "pending", recoveryToken: pollingId, providerState: status };
  }
  if (status !== undefined && UNSAFE_FAILURE_STATES.has(status)) {
    return { disposition: "ambiguous", reason: "provider_terminal_state_without_transaction_identity" };
  }
  return { disposition: "ambiguous", reason: "provider_transaction_identity_missing" };
}

function parseProviderFailure(value: Record<string, unknown>, recoveryToken?: string): EffectResult {
  const error = isPlainRecord(value.error) ? value.error : {};
  const code = typeof error.code === "string" ? error.code : undefined;
  if (code === "TX_DENIED") return { disposition: "rejected", reason: "provider_denied" };
  if (code === "TX_EXPIRED") return { disposition: "rejected", reason: "provider_expired" };
  if (code === "JOB_TIMEOUT" && recoveryToken !== undefined) {
    return { disposition: "pending", recoveryToken, providerState: "WATCH_TIMEOUT" };
  }
  return { disposition: "ambiguous", reason: code === "REQUEST_NOT_FOUND"
    ? "provider_request_not_found" : "provider_exit_unclassified" };
}

function isSuccess(result: MetaMaskProcessResult): boolean {
  const value = parseEnvelope(result.stdout);
  return result.exitCode === 0 && isPlainRecord(value) && value.ok === true && isPlainRecord(value.data);
}

function successData(result: MetaMaskProcessResult): Record<string, unknown> | null {
  const value = parseEnvelope(result.stdout);
  return result.exitCode === 0 && isPlainRecord(value) && value.ok === true && isPlainRecord(value.data)
    ? value.data : null;
}

function parseEnvelope(bytes: Buffer): unknown {
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { return null; }
}

function validHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value);
}

function isRecoveryToken(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,256}$/u.test(value);
}
