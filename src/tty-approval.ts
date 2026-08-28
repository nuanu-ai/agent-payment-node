import { open } from "node:fs/promises";
import { isatty } from "node:tty";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
import type { Address } from "./model.js";

export const TTY_APPROVAL_DEADLINE_MS = 60_000;
const MAX_APPROVAL_INPUT_BYTES = 128;

export interface TransferApprovalIntent {
  readonly profile: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly walletAddress: Address;
  readonly recipient: Address;
  readonly amountAtomic: string;
  readonly amountDecimal: string;
  readonly nonceAtomic: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
  readonly expiresAt: string;
}

export interface TransferApprovalPort {
  approve(intent: TransferApprovalIntent): Promise<void>;
}

interface ApprovalTerminal {
  readonly fd: number;
  write(contents: string): Promise<void>;
  read(signal: AbortSignal): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

export interface TtyTransferApprovalOptions {
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
  readonly openTerminal?: () => Promise<ApprovalTerminal>;
  readonly isTerminal?: (fd: number) => boolean;
}

export class TtyTransferApproval implements TransferApprovalPort {
  private readonly deadlineMs: number;
  private readonly signal: AbortSignal | undefined;
  private readonly openTerminal: () => Promise<ApprovalTerminal>;
  private readonly isTerminal: (fd: number) => boolean;

  constructor(options: TtyTransferApprovalOptions = {}) {
    const deadlineMs = options.deadlineMs ?? TTY_APPROVAL_DEADLINE_MS;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
      throw new ApnError("APN_INTERNAL", "The direct-transfer approval deadline is invalid.");
    }
    this.deadlineMs = deadlineMs;
    this.signal = options.signal;
    this.openTerminal = options.openTerminal ?? openApprovalTerminal;
    this.isTerminal = options.isTerminal ?? isatty;
  }

  async approve(intent: TransferApprovalIntent): Promise<void> {
    if (Date.now() >= Date.parse(intent.expiresAt)) throw approvalFailure("APN_APPROVAL_EXPIRED", "Transfer approval expired.");
    let tty: ApprovalTerminal;
    try {
      tty = await this.openTerminal();
    } catch {
      throw approvalFailure("APN_TTY_UNAVAILABLE", "A foreground terminal is required for direct-transfer approval.");
    }
    try {
      if (!this.isTerminal(tty.fd)) throw approvalFailure("APN_TTY_UNAVAILABLE", "Direct-transfer approval is not attached to a terminal.");
      const phrase = transferApprovalPhrase(intent.fingerprint);
      await tty.write([
        "\nAgent Payment Node approval",
        `Profile: ${intent.profile}`,
        `Operation: ${intent.operationId}`,
        `Chain: Base (${CHAIN_ID})`,
        `Token: ${BASE_USDC}`,
        `Sender: ${intent.walletAddress}`,
        `Recipient: ${intent.recipient}`,
        `Amount: ${intent.amountDecimal} USDC (${intent.amountAtomic} atomic)`,
        `Nonce: ${intent.nonceAtomic}`,
        `Gas limit: ${intent.gasLimitAtomic}`,
        `Max fee per gas: ${intent.maxFeePerGasAtomic} wei`,
        `Max priority fee per gas: ${intent.maxPriorityFeePerGasAtomic} wei`,
        `Expires: ${intent.expiresAt}`,
        `Fingerprint: ${intent.fingerprint}`,
        `Type exactly: ${phrase}`,
        "> ",
      ].join("\n"));
      const supplied = await readApprovalInput(tty, intent.expiresAt, this.deadlineMs, this.signal);
      if (!isExactTransferApproval(phrase, supplied)) throw approvalFailure("APN_APPROVAL_REFUSED", "Direct-transfer approval was refused.");
      if (Date.now() >= Date.parse(intent.expiresAt)) throw approvalFailure("APN_APPROVAL_EXPIRED", "Transfer approval expired.");
    } finally {
      await tty.close();
    }
  }
}

export function transferApprovalPhrase(fingerprint: string): string {
  return `APPROVE APN TRANSFER ${fingerprint.slice(-16)}`;
}

export function isExactTransferApproval(expected: string, supplied: string): boolean {
  return supplied === expected;
}

async function openApprovalTerminal(): Promise<ApprovalTerminal> {
  const handle = await open("/dev/tty", "r+");
  return {
    fd: handle.fd,
    write: async (contents) => await handle.writeFile(contents),
    read: (signal) => handle.createReadStream({ autoClose: false, highWaterMark: 1, signal }),
    close: async () => await handle.close(),
  };
}

async function readApprovalInput(
  tty: ApprovalTerminal,
  expiresAt: string,
  deadlineMs: number,
  externalSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const expiryMs = Date.parse(expiresAt);
  const remainingMs = Math.max(1, Math.min(deadlineMs, expiryMs - Date.now()));
  let abortKind: "deadline" | "external" | "sigint" | undefined;
  const abort = (kind: NonNullable<typeof abortKind>): void => {
    if (abortKind !== undefined) return;
    abortKind = kind;
    controller.abort();
  };
  const onExternalAbort = (): void => abort("external");
  const onSigint = (): void => abort("sigint");
  const timeout = setTimeout(() => abort("deadline"), remainingMs);
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
          throw approvalFailure("APN_APPROVAL_REFUSED", "Direct-transfer approval was refused.");
        }
        input[length] = byte;
        length += 1;
      }
    }
    return input.subarray(0, length).toString("ascii");
  } catch (error) {
    if (abortKind === "deadline") {
      if (Date.now() >= expiryMs) throw approvalFailure("APN_APPROVAL_EXPIRED", "Transfer approval expired.");
      throw approvalFailure("APN_APPROVAL_TIMEOUT", "Direct-transfer approval timed out.");
    }
    if (abortKind === "external" || abortKind === "sigint") {
      throw approvalFailure("APN_APPROVAL_ABORTED", "Direct-transfer approval was interrupted.");
    }
    if (error instanceof ApnError) throw error;
    throw approvalFailure("APN_APPROVAL_ABORTED", "Direct-transfer approval was interrupted.");
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
