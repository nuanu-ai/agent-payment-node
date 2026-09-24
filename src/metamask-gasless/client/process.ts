import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClockPort } from "../../ports.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessIntent, MetaMaskGaslessProfileIdentity,
  MetaMaskGaslessProviderObservation, MetaMaskGaslessQuote, MetaMaskGaslessUnsignedResult } from "../model.js";
import type { MetaMaskGaslessProviderPort, MetaMaskGaslessQuoteInput, MetaMaskGaslessUnsignedInput } from "../ports.js";
import { mmError, mmFail } from "../reasons.js";
import { helperResponse, MM_HELPER_VERSION, type HelperRequest } from "./protocol.js";

const MAX_IO = 1024 * 1024;
const HELPER_ENTRY = fileURLToPath(new URL("./helper-bootstrap.js", import.meta.url));

export interface HelperRunnerOptions { readonly environment: NodeJS.ProcessEnv; readonly timeoutMs: number }
export interface MetaMaskGaslessHelperRunner { run(request: HelperRequest, options: HelperRunnerOptions): Promise<unknown> }
export interface MetaMaskGaslessProviderClientOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly clock?: ClockPort;
  readonly runner?: MetaMaskGaslessHelperRunner;
}

export class MetaMaskGaslessProviderClient implements MetaMaskGaslessProviderPort {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly clock: ClockPort;
  private readonly runner: MetaMaskGaslessHelperRunner;
  constructor(options: MetaMaskGaslessProviderClientOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.clock = options.clock ?? { now: () => new Date() };
    this.runner = options.runner ?? new SubprocessMetaMaskGaslessHelperRunner();
  }
  inspect(expected: MetaMaskGaslessProfileIdentity): Promise<MetaMaskGaslessBinding> {
    return this.invoke({ version: MM_HELPER_VERSION, mode: "inspect", expected }) as Promise<MetaMaskGaslessBinding>;
  }
  quote(input: MetaMaskGaslessQuoteInput): Promise<MetaMaskGaslessQuote> {
    return this.invoke({ version: MM_HELPER_VERSION, mode: "quote", input }) as Promise<MetaMaskGaslessQuote>;
  }
  buildUnsigned(input: MetaMaskGaslessUnsignedInput): Promise<MetaMaskGaslessUnsignedResult> {
    return this.invoke({ version: MM_HELPER_VERSION, mode: "buildUnsigned", input }) as Promise<MetaMaskGaslessUnsignedResult>;
  }
  async submit(intent: MetaMaskGaslessIntent): Promise<MetaMaskGaslessProviderObservation> {
    assertBeforeDeadline(intent.expiresAt, this.clock.now());
    return await this.invoke({ version: MM_HELPER_VERSION, mode: "submit", intent }) as MetaMaskGaslessProviderObservation;
  }
  observe(intent: MetaMaskGaslessIntent): Promise<MetaMaskGaslessProviderObservation> {
    return this.invoke({ version: MM_HELPER_VERSION, mode: "observe", intent }) as Promise<MetaMaskGaslessProviderObservation>;
  }
  private async invoke(request: HelperRequest): Promise<unknown> {
    const timeoutMs = request.mode === "submit" ? 120_000 : 60_000;
    let raw: unknown;
    try { raw = await this.runner.run(request, { environment: this.environment, timeoutMs }); }
    catch { return mmFail(request.mode === "submit" ? "mm_gasless_submit_unknown" : "mm_gasless_provider_unavailable"); }
    const response = helperResponse(raw, request);
    if (!response.ok) throw mmError(response.failure.reason);
    return response.result;
  }
}

export class SubprocessMetaMaskGaslessHelperRunner implements MetaMaskGaslessHelperRunner {
  async run(request: HelperRequest, options: HelperRunnerOptions): Promise<unknown> {
    if (!isAbsolute(process.execPath) || !isAbsolute(HELPER_ENTRY) || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new Error("helper launch rejected");
    }
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > MAX_IO) throw new Error("helper input rejected");
    const environment = sanitizedEnvironment(options.environment);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [HELPER_ENTRY], { shell: false, stdio: ["pipe", "pipe", "ignore"], env: environment });
      let size = 0, settled = false; const chunks: Buffer[] = [];
      const finish = (error: unknown, result?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
      child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_IO) { child.kill("SIGKILL"); finish(new Error("helper output rejected")); } else chunks.push(chunk); });
      child.on("error", () => finish(new Error("helper launch failed")));
      child.on("close", (code, signal) => {
        if (code !== 0 || signal !== null || size < 1) { finish(new Error("helper failed")); return; }
        try { finish(null, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)))); }
        catch { finish(new Error("helper response rejected")); }
      });
      child.stdin.on("error", () => { child.kill("SIGKILL"); finish(new Error("helper input failed")); });
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("helper timed out")); }, options.timeoutMs);
      child.stdin.end(input);
    });
  }
}

function sanitizedEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!(key === "HOME" || key === "TMPDIR" || key === "LANG" || key === "TZ" || /^LC_[A-Z_]+$/u.test(key))) continue;
    if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) throw new Error("helper environment rejected");
    result[key] = value;
  }
  return result;
}
function assertBeforeDeadline(value: string, now: Date): void {
  const expires = Date.parse(value), current = now.getTime();
  if (!Number.isSafeInteger(expires) || !Number.isSafeInteger(current) || current >= expires) mmFail("mm_gasless_expired");
}
