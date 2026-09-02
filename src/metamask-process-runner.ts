import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { ApnError } from "./errors.js";
import {
  METAMASK_FOREGROUND_TIMEOUT_MS,
  METAMASK_PROCESS_TIMEOUT_MS,
  resolveMetaMaskBin,
} from "./metamask-package.js";

const MAX_JSON_BYTES = 1024 * 1024;

interface CapturedStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

interface CapturedChild {
  readonly stdout: CapturedStream;
  readonly stderr: CapturedStream;
  once(event: "error", listener: () => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  removeListener(event: "error", listener: () => void): unknown;
  removeListener(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

interface ForegroundChild {
  once(event: "error", listener: () => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  removeListener(event: "error", listener: () => void): unknown;
  removeListener(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

export type MetaMaskCapturedLaunchPort = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: readonly ["ignore", "pipe", "pipe"] },
) => CapturedChild;

export type MetaMaskForegroundLaunchPort = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: readonly [number, number, number] },
) => ForegroundChild;

export interface MetaMaskProcessResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
}

export interface MetaMaskProcessRunnerPort {
  runJson(argv: readonly string[]): Promise<MetaMaskProcessResult>;
  runForeground(argv: readonly string[]): Promise<number>;
}

export class NodeMetaMaskProcessRunner implements MetaMaskProcessRunnerPort {
  constructor(
    private readonly binResolver: () => Promise<string> = resolveMetaMaskBin,
    private readonly capturedLaunch: MetaMaskCapturedLaunchPort = defaultCapturedLaunch,
    private readonly foregroundLaunch: MetaMaskForegroundLaunchPort = defaultForegroundLaunch,
    private readonly jsonTimeoutMs: number = METAMASK_PROCESS_TIMEOUT_MS,
    private readonly foregroundTimeoutMs: number = METAMASK_FOREGROUND_TIMEOUT_MS,
    private readonly openTerminal: () => number = defaultOpenTerminal,
    private readonly closeTerminal: (fd: number) => void = closeSync,
  ) {}

  async runJson(argv: readonly string[]): Promise<MetaMaskProcessResult> {
    const script = await this.binResolver();
    return await new Promise<MetaMaskProcessResult>((resolveResult, reject) => {
      let child: CapturedChild;
      try {
        child = this.capturedLaunch(process.execPath, [script, ...argv], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        reject(providerUnavailable("The MetaMask Agent Wallet process could not start."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const zero = (): void => { for (const chunk of chunks) chunk.fill(0); };
      const cleanup = (): void => {
        clearTimeout(timeout);
        child.stdout.removeListener("data", onStdout);
        child.stderr.removeListener("data", onStderr);
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
      };
      const fail = (error: ApnError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        zero();
        reject(error);
      };
      const onStdout = (chunk: Buffer | string): void => {
        const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
        size += bytes.length;
        if (size > MAX_JSON_BYTES) {
          bytes.fill(0);
          fail(providerProtocol());
          child.kill();
          return;
        }
        chunks.push(bytes);
      };
      const onStderr = (chunk: Buffer | string): void => {
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
        else Buffer.from(chunk, "utf8").fill(0);
      };
      const onError = (): void => fail(providerUnavailable("The MetaMask Agent Wallet process could not start."));
      const onClose = (code: number | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const stdout = Buffer.concat(chunks);
        zero();
        resolveResult({ exitCode: code ?? 1, stdout });
      };
      const timeout = setTimeout(() => {
        fail(providerUnavailable("The MetaMask Agent Wallet process timed out safely."));
        child.kill();
      }, this.jsonTimeoutMs);
      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.once("error", onError);
      child.once("close", onClose);
    });
  }

  async runForeground(argv: readonly string[]): Promise<number> {
    const script = await this.binResolver();
    let ttyFd: number;
    try { ttyFd = this.openTerminal(); }
    catch { throw new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "A foreground terminal is required for MetaMask login."); }
    try {
      return await new Promise<number>((resolveResult, reject) => {
        let child: ForegroundChild;
        try {
          child = this.foregroundLaunch(process.execPath, [script, ...argv], {
            shell: false,
            stdio: [ttyFd, ttyFd, ttyFd],
          });
        } catch {
          reject(providerUnavailable("The MetaMask Agent Wallet foreground process could not start."));
          return;
        }
        let settled = false;
        const cleanup = (): void => {
          clearTimeout(timeout);
          child.removeListener("error", onError);
          child.removeListener("close", onClose);
        };
        const onError = (): void => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(providerUnavailable("The MetaMask Agent Wallet foreground process was lost."));
        };
        const onClose = (code: number | null): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolveResult(code ?? 1);
        };
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          child.kill();
          reject(providerUnavailable("MetaMask foreground login timed out safely."));
        }, this.foregroundTimeoutMs);
        child.once("error", onError);
        child.once("close", onClose);
      });
    } finally {
      this.closeTerminal(ttyFd);
    }
  }
}

const defaultCapturedLaunch: MetaMaskCapturedLaunchPort = (executable, args, options) => spawn(executable, [...args], {
  shell: options.shell,
  stdio: [...options.stdio],
}) as CapturedChild;

const defaultForegroundLaunch: MetaMaskForegroundLaunchPort = (executable, args, options) => spawn(executable, [...args], {
  shell: options.shell,
  stdio: [...options.stdio],
}) as ForegroundChild;

function defaultOpenTerminal(): number {
  return openSync("/dev/tty", "r+");
}

function providerProtocol(): ApnError {
  return new ApnError("APN_PROVIDER_PROTOCOL", "The MetaMask Agent Wallet response exceeded its accepted contract.", { retryable: false });
}

function providerUnavailable(message: string): ApnError {
  return new ApnError("APN_PROVIDER_UNAVAILABLE", message, { retryable: true });
}
