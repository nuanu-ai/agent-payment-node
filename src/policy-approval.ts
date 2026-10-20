import { approvalCode } from "./approval-code.js";
import { isatty } from "node:tty";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
import type { Address } from "./model.js";
import { loadAllowlistInventory } from "./allowlist-inventory.js";
import { releasedX402Pair, type X402PolicyNetwork } from "./x402-network.js";

const POLICY_APPROVAL_DEADLINE_MS = 60_000;
const MAX_APPROVAL_INPUT_BYTES = 128;

export interface ProfilePolicyApprovalIntent {
  readonly x402Network?: X402PolicyNetwork;
  readonly profile: string;
  readonly walletAddress: Address;
  readonly fingerprint: string;
  readonly change: "create" | "increase";
  readonly maxBalanceUsdcAtomic: string;
  readonly maxX402AmountAtomic: string;
  readonly maxBalanceEthWei?: string;
  /** The x402 payee pin the change leaves in force; absent means payees are not restricted. */
  readonly x402Payees?: readonly string[];
}

export interface ProfilePolicyApprovalPort {
  approve(intent: ProfilePolicyApprovalIntent): Promise<void>;
}

interface ApprovalTerminal {
  readonly fd: number;
  write(contents: string): Promise<void>;
  read(signal: AbortSignal): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

export interface TtyProfilePolicyApprovalOptions {
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
  readonly openTerminal?: () => Promise<ApprovalTerminal>;
  readonly isTerminal?: (fd: number) => boolean;
}

export class TtyProfilePolicyApproval implements ProfilePolicyApprovalPort {
  private readonly deadlineMs: number;
  private readonly signal: AbortSignal | undefined;
  private readonly openTerminal: () => Promise<ApprovalTerminal>;
  private readonly isTerminal: (fd: number) => boolean;

  constructor(options: TtyProfilePolicyApprovalOptions = {}) {
    const deadlineMs = options.deadlineMs ?? POLICY_APPROVAL_DEADLINE_MS;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
      throw new ApnError("APN_INTERNAL", "The profile-policy approval deadline is invalid.");
    }
    this.deadlineMs = deadlineMs;
    this.signal = options.signal;
    this.openTerminal = options.openTerminal ?? openApprovalTerminal;
    this.isTerminal = options.isTerminal ?? isatty;
  }

  async approve(intent: ProfilePolicyApprovalIntent): Promise<void> {
    let tty: ApprovalTerminal;
    try {
      tty = await this.openTerminal();
    } catch {
      throw approvalFailure("APN_TTY_UNAVAILABLE", "A foreground terminal is required to create or increase profile policy.");
    }
    try {
      if (!this.isTerminal(tty.fd)) {
        throw approvalFailure("APN_TTY_UNAVAILABLE", "Profile-policy approval is not attached to a terminal.");
      }
      const phrase = profilePolicyApprovalPhrase(intent.fingerprint);
      const unit = x402Unit(intent.x402Network);
      await tty.write([
        "\nAgent Payment Node policy approval",
        `Change: ${intent.change}`,
        `Profile: ${intent.profile}`,
        intent.x402Network === undefined ? `Chain: Base (${CHAIN_ID})` : `Chain: eip155:${intent.x402Network.chainId}`,
        `Token: ${intent.x402Network?.token ?? BASE_USDC}${unit.note}`,
        `Wallet: ${intent.walletAddress}`,
        `Maximum wallet ${unit.symbol}: ${intent.maxBalanceUsdcAtomic} atomic`,
        `Maximum unattended x402: ${intent.maxX402AmountAtomic} atomic`,
        `Maximum wallet ETH: ${intent.maxBalanceEthWei ?? "not configured"} wei`,
        intent.x402Payees === undefined ? "x402 payees: not restricted" : `x402 payees pinned (${intent.x402Payees.length}): ${intent.x402Payees.join(", ")}`,
        "These values are owner policy, not product defaults.",
        `Fingerprint: ${intent.fingerprint}`,
        `Type ${phrase} and press Enter to confirm.`,
        "> ",
      ].join("\n"));
      const supplied = await readApprovalInput(tty, this.deadlineMs, this.signal);
      if (supplied !== phrase) {
        throw approvalFailure("APN_APPROVAL_REFUSED", "Profile-policy approval was refused.");
      }
    } finally {
      await tty.close();
    }
  }
}

/** What the owner reads beside the token address: its symbol and decimals from APN's frozen token list, if listed. */
function x402Unit(network: X402PolicyNetwork | undefined): { readonly symbol: string; readonly note: string } {
  if (network === undefined || releasedX402Pair(network.chainId, network.token)) return { symbol: "USDC", note: "" };
  const listed = loadAllowlistInventory().assets.find((row) => row.chain === `eip155:${network.chainId}` &&
    row.identifier?.toLowerCase() === network.token.toLowerCase());
  return listed === undefined ? { symbol: "token", note: " (not in APN's token list: verify this contract yourself)" }
    : { symbol: listed.symbol, note: ` (${listed.symbol}, ${listed.decimals} decimals, APN token list)` };
}

export function profilePolicyApprovalPhrase(fingerprint: string): string {
  return approvalCode("policy", fingerprint);
}

async function openApprovalTerminal(): Promise<ApprovalTerminal> {
  const input = process.stdin;
  const output = process.stderr;
  if (input.isTTY !== true || output.isTTY !== true) throw new Error("foreground terminal unavailable");
  return {
    fd: input.fd,
    write: async (contents) => await new Promise<void>((resolve, reject) => {
      output.write(contents, (error) => error === null || error === undefined ? resolve() : reject(error));
    }),
    read: (signal) => readTerminal(input, signal),
    close: async () => { input.pause(); },
  };
}

async function* readTerminal(input: NodeJS.ReadStream, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const queued: Buffer[] = [];
  let ended = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const notify = (): void => { wake?.(); };
  const onData = (chunk: Buffer | string): void => {
    queued.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8"));
    notify();
  };
  const onEnd = (): void => { ended = true; notify(); };
  const onError = (): void => { failure = new Error("approval terminal read failed"); notify(); };
  const abort = (): void => { failure = new Error("approval terminal read aborted"); notify(); };
  input.on("data", onData);
  input.once("end", onEnd);
  input.once("error", onError);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  input.resume();
  try {
    while (true) {
      if (failure !== undefined) throw failure;
      const next = queued.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => { wake = resolve; });
      wake = undefined;
    }
  } finally {
    input.pause();
    input.removeListener("data", onData);
    input.removeListener("end", onEnd);
    input.removeListener("error", onError);
    signal.removeEventListener("abort", abort);
    for (const chunk of queued) chunk.fill(0);
  }
}

async function readApprovalInput(
  tty: ApprovalTerminal,
  deadlineMs: number,
  externalSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  let abortKind: "deadline" | "external" | "sigint" | undefined;
  const abort = (kind: NonNullable<typeof abortKind>): void => {
    if (abortKind !== undefined) return;
    abortKind = kind;
    controller.abort();
  };
  const onExternalAbort = (): void => abort("external");
  const onSigint = (): void => abort("sigint");
  const timeout = setTimeout(() => abort("deadline"), deadlineMs);
  timeout.unref();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  process.once("SIGINT", onSigint);
  if (externalSignal?.aborted === true) abort("external");
  const input = Buffer.alloc(MAX_APPROVAL_INPUT_BYTES);
  let length = 0;
  try {
    for await (const chunk of tty.read(controller.signal)) {
      for (const byte of chunk) {
        if (byte === 10) return input.subarray(0, length).toString("ascii");
        if (byte === 13 || byte < 32 || byte > 126 || length >= input.length) {
          throw approvalFailure("APN_APPROVAL_REFUSED", "Profile-policy approval was refused.");
        }
        input[length] = byte;
        length += 1;
      }
    }
    return input.subarray(0, length).toString("ascii");
  } catch (error) {
    if (abortKind === "deadline") throw approvalFailure("APN_APPROVAL_TIMEOUT", "Profile-policy approval timed out.");
    if (abortKind === "external" || abortKind === "sigint") {
      throw approvalFailure("APN_APPROVAL_ABORTED", "Profile-policy approval was interrupted.");
    }
    if (error instanceof ApnError) throw error;
    throw approvalFailure("APN_APPROVAL_ABORTED", "Profile-policy approval was interrupted.");
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    process.off("SIGINT", onSigint);
    input.fill(0);
    controller.abort();
  }
}

function approvalFailure(nativeCode: string, message: string): ApnError {
  return new ApnError("APN_NATIVE_REJECTED", message, { nativeCode });
}
