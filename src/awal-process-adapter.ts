import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import type {
  ForegroundAuthenticationPort,
  ProviderAdapterBundle,
  ProviderBalanceObservation,
  ProviderLifecyclePort,
  ProviderWalletReadPort,
} from "./provider-ports.js";
import { accountBindingHash, lifecycleReadOnlyCapabilitySnapshot } from "./provider-profile.js";
import type { Address } from "./model.js";

export const AWAL_PROVIDER_ID = "coinbase-agentic-wallet" as const;
export const AWAL_VERSION = "2.12.1" as const;
export const AWAL_BIN = "dist/index.js" as const;
export const AWAL_INTEGRITY = "sha512-z4whchSMbUhDuhwoI/+7vZ1ArwG9e8C9yIX9Y3W+JXJkR3E95iIZ1vIBZ6nPWSzakCw21YuZhFvOpGKEXtN6kQ==" as const;
export const AWAL_SHASUM = "9c4c077983d608e278ed84053199427026ebbaa8" as const;
const MAX_PROVIDER_OUTPUT_BYTES = 1024 * 1024;
const MAX_PROVIDER_CLASSIFICATION_BYTES = 4096;
export const AWAL_PROCESS_TIMEOUT_MS = 30_000;

type AwalCommand =
  | { readonly kind: "status" }
  | { readonly kind: "login"; readonly identity: string }
  | { readonly kind: "verify"; readonly challenge: string }
  | { readonly kind: "logout" }
  | { readonly kind: "balance" }
  | { readonly kind: "address" };

export interface AwalProcessResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly optionalFailure?: "unsupported" | "unavailable";
  readonly loginDisposition?: "already_authenticated";
}

export interface AwalProcessRunnerPort {
  run(argv: readonly string[], sensitive: boolean): Promise<AwalProcessResult>;
}

interface AwalStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

interface AwalChild {
  readonly stdout: AwalStream;
  readonly stderr: AwalStream;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  removeListener(event: "error", listener: (error: Error) => void): unknown;
  removeListener(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

export type AwalLaunchPort = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: readonly ["ignore", "pipe", "pipe"] },
) => AwalChild;

export class NodeAwalProcessRunner implements AwalProcessRunnerPort {
  constructor(
    private readonly binResolver: () => Promise<string> = resolveAwalBin,
    private readonly launch: AwalLaunchPort = defaultLaunch,
    private readonly timeoutMs: number = AWAL_PROCESS_TIMEOUT_MS,
  ) {}

  async run(argv: readonly string[], sensitive: boolean): Promise<AwalProcessResult> {
    const script = await this.binResolver();
    return await new Promise<AwalProcessResult>((resolveResult, reject) => {
      let child: AwalChild;
      try {
        child = this.launch(process.execPath, [script, ...argv], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        reject(providerFailure("The wallet provider process could not start."));
        return;
      }
      const chunks: Buffer[] = [];
      const classificationChunks: Buffer[] = [];
      let size = 0;
      let classificationSize = 0;
      let classificationTruncated = false;
      const classifyLogin = sensitive && isLoginArgv(argv);
      const loginStdoutMatcher = newAsciiMatcher();
      const loginStderrMatcher = newAsciiMatcher();
      let settled = false;
      const zeroChunks = (): void => {
        for (const chunk of chunks) chunk.fill(0);
        for (const chunk of classificationChunks) chunk.fill(0);
      };
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
        zeroChunks();
        reject(error);
      };
      const onStdout = (chunk: Buffer | string): void => {
        const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
        if (classifyLogin) consumeAsciiMatch(loginStdoutMatcher, bytes);
        if (sensitive) {
          bytes.fill(0);
          return;
        }
        size += bytes.length;
        if (size > MAX_PROVIDER_OUTPUT_BYTES) {
          bytes.fill(0);
          fail(providerProtocolError());
          child.kill();
          return;
        }
        chunks.push(bytes);
      };
      const onStderr = (chunk: Buffer | string): void => {
        const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
        if (classifyLogin) consumeAsciiMatch(loginStderrMatcher, bytes);
        if (sensitive || classificationTruncated) {
          bytes.fill(0);
          return;
        }
        classificationSize += bytes.length;
        if (classificationSize > MAX_PROVIDER_CLASSIFICATION_BYTES) {
          classificationTruncated = true;
          bytes.fill(0);
          for (const retained of classificationChunks) retained.fill(0);
          classificationChunks.length = 0;
          return;
        }
        classificationChunks.push(bytes);
      };
      const onError = (): void => fail(providerFailure("The wallet provider process could not start."));
      const onClose = (code: number | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const stdout = sensitive ? Buffer.alloc(0) : Buffer.concat(chunks);
        const exitCode = code ?? 1;
        const classification = classificationTruncated
          ? undefined
          : classifyOptionalAddressFailure(argv, exitCode, Buffer.concat(classificationChunks));
        const loginDisposition = exitCode === 0 && (loginStdoutMatcher.found || loginStderrMatcher.found)
          ? "already_authenticated" as const
          : undefined;
        zeroChunks();
        resolveResult({
          exitCode,
          stdout,
          ...(classification === undefined ? {} : { optionalFailure: classification }),
          ...(loginDisposition === undefined ? {} : { loginDisposition }),
        });
      };
      const timeout = setTimeout(() => {
        fail(providerFailure("The wallet provider process timed out safely."));
        child.kill();
      }, this.timeoutMs);
      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.once("error", onError);
      child.once("close", onClose);
    });
  }
}

const defaultLaunch: AwalLaunchPort = (executable, args, options) => spawn(executable, [...args], {
  shell: options.shell,
  stdio: [...options.stdio],
}) as AwalChild;

export class AwalProcessAdapter implements ProviderLifecyclePort, ProviderWalletReadPort {
  readonly capabilities = lifecycleReadOnlyCapabilitySnapshot();

  constructor(private readonly runner: AwalProcessRunnerPort = new NodeAwalProcessRunner()) {}

  bundle(): ProviderAdapterBundle {
    return {
      provider_id: AWAL_PROVIDER_ID,
      trust_class: "provider_managed_non_custodial_tee",
      capabilities: this.capabilities,
      lifecycle: this,
      reads: this,
    };
  }

  async connect(foreground: ForegroundAuthenticationPort): Promise<void> {
    const identity = await foreground.readIdentity();
    const disposition = await this.runSensitive({ kind: "login", identity });
    if (disposition === "already_authenticated") return;
    const challenge = await foreground.readChallengeResponse();
    await this.runSensitive({ kind: "verify", challenge });
  }

  async logout(): Promise<void> {
    await this.runSensitive({ kind: "logout" });
  }

  async observeBalance(): Promise<ProviderBalanceObservation> {
    const result = await this.runner.run(argv({ kind: "balance" }), false);
    try {
      if (result.exitCode !== 0) throw sessionFailure();
      return parseBalance(result.stdout);
    } finally {
      result.stdout.fill(0);
    }
  }

  async probeStatus(): Promise<void> {
    await this.runSensitive({ kind: "status" });
  }

  async crossCheckAddress(expected: Address): Promise<void> {
    const result = await this.runner.run(argv({ kind: "address" }), false);
    try {
      if (result.exitCode !== 0) {
        if (result.optionalFailure === "unsupported" || result.optionalFailure === "unavailable") return;
        throw sessionFailure();
      }
      const value = result.stdout.toString("utf8").trim();
      if (!/^0x[0-9a-fA-F]{40}$/u.test(value) || value.toLowerCase() !== expected.toLowerCase()) providerProtocol();
    } finally {
      result.stdout.fill(0);
    }
  }

  private async runSensitive(command: AwalCommand): Promise<AwalProcessResult["loginDisposition"]> {
    const result = await this.runner.run(argv(command), true);
    result.stdout.fill(0);
    if (result.loginDisposition !== undefined && command.kind !== "login") providerProtocol();
    if (result.exitCode !== 0) throw command.kind === "status" ? sessionFailure() : providerFailure("Wallet provider authentication failed safely.");
    return result.loginDisposition;
  }
}

interface AsciiMatchState {
  matched: number;
  found: boolean;
}

const ALREADY_SIGNED_IN = Buffer.from("already signed in", "ascii");
const ALREADY_SIGNED_IN_PREFIX = buildPrefixTable(ALREADY_SIGNED_IN);

function newAsciiMatcher(): AsciiMatchState {
  return { matched: 0, found: false };
}

function consumeAsciiMatch(state: AsciiMatchState, bytes: Buffer): void {
  if (state.found) return;
  for (const byte of bytes) {
    const folded = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
    while (state.matched > 0 && folded !== ALREADY_SIGNED_IN[state.matched]) {
      state.matched = ALREADY_SIGNED_IN_PREFIX[state.matched - 1] ?? 0;
    }
    if (folded === ALREADY_SIGNED_IN[state.matched]) state.matched += 1;
    if (state.matched === ALREADY_SIGNED_IN.length) {
      state.found = true;
      state.matched = 0;
      return;
    }
  }
}

function buildPrefixTable(pattern: Buffer): readonly number[] {
  const prefix = new Array<number>(pattern.length).fill(0);
  for (let index = 1, matched = 0; index < pattern.length; index += 1) {
    while (matched > 0 && pattern[index] !== pattern[matched]) matched = prefix[matched - 1] ?? 0;
    if (pattern[index] === pattern[matched]) matched += 1;
    prefix[index] = matched;
  }
  return prefix;
}

function isLoginArgv(commandArgv: readonly string[]): boolean {
  return commandArgv.length === 4 && commandArgv[0] === "auth" && commandArgv[1] === "login" &&
    commandArgv[2] !== undefined && commandArgv[3] === "--json";
}

export async function resolveAwalBin(): Promise<string> {
  const require = createRequire(import.meta.url);
  let manifestPath: string;
  try {
    manifestPath = require.resolve("awal/package.json");
  } catch {
    throw providerFailure("The exact wallet provider client is not installed.");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch {
    throw providerFailure("The wallet provider client manifest is unavailable.");
  }
  if (!isPlainRecord(value)) throw providerProtocol();
  const bin = typeof value.bin === "string"
    ? value.bin
    : isPlainRecord(value.bin) && typeof value.bin.awal === "string" ? value.bin.awal : undefined;
  const repository = isPlainRecord(value.repository) ? value.repository.url : undefined;
  if (
    value.name !== "awal" || value.version !== AWAL_VERSION || bin !== AWAL_BIN || value.license !== "Apache-2.0" ||
    !isPlainRecord(value.engines) || value.engines.node !== ">=18" ||
    typeof repository !== "string" || !repository.includes("github.com/coinbase/awal")
  ) throw providerProtocol();
  const script = resolve(dirname(manifestPath), bin);
  if (!script.startsWith(`${dirname(manifestPath)}/`)) throw providerProtocol();
  return script;
}

function argv(command: AwalCommand): readonly string[] {
  switch (command.kind) {
    case "status": return ["status", "--json"];
    case "login": return ["auth", "login", command.identity, "--json"];
    case "verify": return ["auth", "verify", command.challenge, "--json"];
    case "logout": return ["auth", "logout", "--json"];
    case "balance": return ["balance", "--chain", "base", "--asset", "usdc", "--json"];
    case "address": return ["address", "--chain", "base"];
  }
}

function parseBalance(bytes: Buffer): ProviderBalanceObservation {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw providerProtocol();
  }
  if (
    !isPlainRecord(value) || !exactKeys(value, ["address", "chain", "balances", "timestamp"]) ||
    !isPlainRecord(value.balances) || !exactKeys(value.balances, ["USDC"]) ||
    !isPlainRecord(value.balances.USDC) || !exactKeys(value.balances.USDC, ["raw", "formatted", "decimals"])
  ) providerProtocol();
  const usdc = value.balances.USDC;
  if (
    typeof value.address !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value.address) ||
    (value.chain !== "Base" && value.chain !== "base") ||
    typeof usdc.raw !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(usdc.raw) ||
    typeof usdc.formatted !== "string" || usdc.formatted.length === 0 || usdc.decimals !== 6 ||
    typeof value.timestamp !== "string" || !isTimestamp(value.timestamp)
  ) providerProtocol();
  const address = value.address as Address;
  return {
    address,
    account_binding_hash: accountBindingHash(AWAL_PROVIDER_ID, address),
    chain: "base",
    asset: "USDC",
    raw: usdc.raw,
    formatted: usdc.formatted,
    decimals: 6,
    observed_at: value.timestamp,
  };
}

function isTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function classifyOptionalAddressFailure(
  commandArgv: readonly string[],
  exitCode: number,
  stderr: Buffer,
): AwalProcessResult["optionalFailure"] {
  try {
    if (
      exitCode === 0 || commandArgv.length !== 3 || commandArgv[0] !== "address" ||
      commandArgv[1] !== "--chain" || commandArgv[2] !== "base"
    ) return undefined;
    const message = stderr.toString("utf8").trim();
    if (message === "error: unknown command 'address'") return "unsupported";
    if (message === "error: address command unavailable") return "unavailable";
    return undefined;
  } finally {
    stderr.fill(0);
  }
}

function providerProtocol(): never {
  throw new ApnError("APN_PROVIDER_PROTOCOL", "The wallet provider returned an unsupported safe response.", { retryable: false });
}

function providerProtocolError(): ApnError {
  return new ApnError("APN_PROVIDER_PROTOCOL", "The wallet provider returned an unsupported safe response.", { retryable: false });
}

function sessionFailure(): ApnError {
  return new ApnError("APN_PROVIDER_SESSION_REQUIRED", "The wallet provider session is unavailable.", { retryable: true });
}

function providerFailure(message: string): ApnError {
  return new ApnError("APN_PROVIDER_UNAVAILABLE", message, { retryable: true });
}
