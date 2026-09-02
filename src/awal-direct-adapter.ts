import { spawn } from "node:child_process";
import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { Address, Hex } from "./model.js";
import type { DirectExecutionPort } from "./provider-ports.js";
import { AWAL_PROCESS_TIMEOUT_MS, resolveAwalBin } from "./awal-package.js";

const MAX_SEND_OUTPUT_BYTES = 1024 * 1024;

interface AwalSendStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

interface AwalSendChild {
  readonly stdout: AwalSendStream;
  readonly stderr: AwalSendStream;
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: () => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  removeListener(event: "spawn", listener: () => void): unknown;
  removeListener(event: "error", listener: () => void): unknown;
  removeListener(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

export type AwalSendLaunchPort = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: readonly ["ignore", "pipe", "pipe"] },
) => AwalSendChild;

type DirectResult = Awaited<ReturnType<NonNullable<DirectExecutionPort["execute"]>>>;

export class AwalDirectAdapter implements DirectExecutionPort {
  readonly mode = "provider_atomic_send" as const;

  constructor(
    private readonly binResolver: () => Promise<string> = resolveAwalBin,
    private readonly launch: AwalSendLaunchPort = defaultSendLaunch,
    private readonly timeoutMs: number = AWAL_PROCESS_TIMEOUT_MS,
  ) {}

  assertCompatibleIntent(input: {
    readonly amountAtomic: string;
    readonly amountDecimal: string;
    readonly recipient: Address;
  }): void {
    if (pinnedAwalUsdcAtomic(input.amountDecimal) !== input.amountAtomic) {
      throw new ApnError(
        "APN_PROVIDER_PROTOCOL",
        "The pinned wallet provider cannot encode this exact decimal amount safely.",
        { retryable: false, provider_version: "2.12.1" },
      );
    }
  }

  async execute(input: {
    readonly amountDecimal: string;
    readonly recipient: Address;
    readonly sender: Address;
  }): Promise<DirectResult> {
    let script: string;
    try {
      script = await this.binResolver();
    } catch {
      return { disposition: "not_started", reason: "provider_binary_unavailable" };
    }
    const args = [
      script, "send", input.amountDecimal, input.recipient,
      "--chain", "base", "--asset", "usdc", "--json",
    ];
    return await new Promise<DirectResult>((resolveResult) => {
      let child: AwalSendChild;
      try {
        child = this.launch(process.execPath, args, {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        resolveResult({ disposition: "not_started", reason: "provider_child_not_created" });
        return;
      }
      let spawned = false;
      let settled = false;
      let size = 0;
      const chunks: Buffer[] = [];
      const zeroChunks = (): void => { for (const chunk of chunks) chunk.fill(0); };
      const cleanup = (): void => {
        clearTimeout(timeout);
        child.stdout.removeListener("data", onStdout);
        child.stderr.removeListener("data", onStderr);
        child.removeListener("spawn", onSpawn);
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
      };
      const finish = (result: DirectResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        zeroChunks();
        resolveResult(result);
      };
      const onSpawn = (): void => { spawned = true; };
      const onStdout = (chunk: Buffer | string): void => {
        const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
        size += bytes.length;
        if (size > MAX_SEND_OUTPUT_BYTES) {
          bytes.fill(0);
          finish({ disposition: "ambiguous", reason: "provider_output_too_large" });
          child.kill();
          return;
        }
        chunks.push(bytes);
      };
      const onStderr = (chunk: Buffer | string): void => {
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
        else Buffer.from(chunk, "utf8").fill(0);
      };
      const onError = (): void => finish({
        disposition: "ambiguous",
        reason: spawned ? "provider_process_lost" : "provider_launch_outcome_unknown",
      });
      const onClose = (code: number | null): void => {
        if (code !== 0) {
          finish({ disposition: "ambiguous", reason: "provider_exit_unclassified" });
          return;
        }
        const stdout = Buffer.concat(chunks);
        try {
          finish(parseAcknowledgement(stdout));
        } finally {
          stdout.fill(0);
        }
      };
      const timeout = setTimeout(() => {
        finish({
          disposition: "ambiguous",
          reason: spawned ? "provider_process_timeout" : "provider_launch_outcome_unknown",
        });
        child.kill();
      }, this.timeoutMs);
      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.once("spawn", onSpawn);
      child.once("error", onError);
      child.once("close", onClose);
    });
  }
}

function pinnedAwalUsdcAtomic(amountDecimal: string): string | null {
  const numeric = Number.parseFloat(amountDecimal);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const atomic = Number.isInteger(numeric) && numeric > 100
    ? Math.floor(numeric)
    : Math.floor(numeric * 1_000_000);
  return Number.isSafeInteger(atomic) && atomic > 0 ? atomic.toString() : null;
}

const defaultSendLaunch: AwalSendLaunchPort = (executable, args, options) => spawn(executable, [...args], {
  shell: options.shell,
  stdio: [...options.stdio],
}) as AwalSendChild;

function parseAcknowledgement(bytes: Buffer): DirectResult {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return { disposition: "ambiguous", reason: "provider_response_malformed" };
  }
  if (!isPlainRecord(value) || typeof value.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value.transactionHash)) {
    return { disposition: "ambiguous", reason: "provider_transaction_identity_missing" };
  }
  return { disposition: "acknowledged", transactionHash: value.transactionHash as Hex };
}
