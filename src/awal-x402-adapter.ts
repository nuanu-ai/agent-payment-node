import { spawn } from "node:child_process";
import { canonicalJson, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import type {
  ProviderX402Invocation,
  ProviderX402SellerResult,
  X402ExecutionPort,
} from "./provider-ports.js";
import { providerX402InvocationIntentHash } from "./provider-x402-model.js";
import { canonicalizeNormalizedProviderJson } from "./normalized-provider-json.js";
import { resolveAwalBin } from "./awal-package.js";

export const AWAL_X402_PROCESS_TIMEOUT_MS = 210_000;
export const AWAL_X402_INTERNAL_TIMEOUT_MS = 180_000;
export const AWAL_X402_SHUTDOWN_MARGIN_MS = 30_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_STATUS_TEXT_BYTES = 512;
const MAX_PROVIDER_ATOMIC = 9_007_199_254_740_991n;
const REQUIRED_ENVELOPE_KEYS = ["status", "data", "paymentMade", "amountPaid"] as const;
const KNOWN_ENVELOPE_KEYS = new Set([...REQUIRED_ENVELOPE_KEYS, "statusText"]);
const CONFLICTING_OUTER_KEYS = new Set([
  "status", "statustext", "data", "paymentmade", "amountpaid",
  "httpstatus", "statuscode", "amountpaidatomic",
  "result", "response", "payload", "body", "sellerresult",
]);

interface AwalX402Stream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

interface AwalX402Child {
  readonly pid?: number;
  readonly stdout: AwalX402Stream;
  readonly stderr: AwalX402Stream;
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: () => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  removeListener(event: "spawn", listener: () => void): unknown;
  removeListener(event: "error", listener: () => void): unknown;
  removeListener(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

export type AwalX402LaunchPort = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: readonly ["ignore", "pipe", "pipe"] },
) => AwalX402Child;

type ExecutionResult = Awaited<ReturnType<NonNullable<X402ExecutionPort["execute"]>>>;

export class AwalX402Adapter implements X402ExecutionPort {
  readonly mode = "provider_atomic_paid_fetch" as const;
  private script: string | undefined;

  constructor(
    private readonly binResolver: () => Promise<string> = resolveAwalBin,
    private readonly launch: AwalX402LaunchPort = defaultLaunch,
    private readonly timeoutMs: number = AWAL_X402_PROCESS_TIMEOUT_MS,
  ) {
    if (timeoutMs !== AWAL_X402_PROCESS_TIMEOUT_MS) {
      throw new ApnError("APN_PROVIDER_PROTOCOL", "The pinned x402 provider deadline is invalid.");
    }
  }

  assertCompatibleIntent(input: { readonly amountAtomic: string }): void {
    providerAtomic(input.amountAtomic);
  }

  async prime(): Promise<void> {
    this.script ??= await this.binResolver();
  }

  async execute(input: {
    readonly url: string;
    readonly amountAtomic: string;
    readonly correlationId: string;
    readonly requestDigest: string;
  }): Promise<ExecutionResult> {
    providerAtomic(input.amountAtomic);
    try { await this.prime(); }
    catch { return { disposition: "not_started", reason: "provider_binary_unavailable" }; }
    const script = this.script;
    if (script === undefined) return { disposition: "not_started", reason: "provider_binary_unavailable" };
    const args = [
      script, "x402", "pay", input.url, "-X", "GET", "--max-amount", input.amountAtomic,
      "--scheme", "exact", "--correlation-id", input.correlationId, "--json",
    ] as const;
    return await this.runChild(args, input, script);
  }

  private async runChild(
    args: readonly string[],
    input: {
      readonly url: string;
      readonly amountAtomic: string;
      readonly correlationId: string;
      readonly requestDigest: string;
    },
    script: string,
  ): Promise<ExecutionResult> {
    return await new Promise<ExecutionResult>((resolveResult) => {
      let child: AwalX402Child;
      try {
        child = this.launch(process.execPath, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        resolveResult({ disposition: "not_started", reason: "provider_child_not_created" });
        return;
      }
      let spawned = false;
      let settled = false;
      let size = 0;
      const chunks: Buffer[] = [];
      const invocation = (): ProviderX402Invocation => {
        const output = Buffer.concat(chunks);
        try {
          return {
            correlation_id: input.correlationId,
            request_digest: input.requestDigest,
            intent_binding_hash: providerX402InvocationIntentHash({
              correlationId: input.correlationId,
              canonicalUrl: input.url,
              amountAtomic: input.amountAtomic,
              requestDigest: input.requestDigest,
            }),
            child_identity_hash: sha256(canonicalJson({
              executable: process.execPath,
              script,
              argv: args,
              pid: child.pid ?? null,
              requestDigest: input.requestDigest,
            })),
            output_sha256: sha256(output),
            output_byte_length: output.byteLength.toString(),
          };
        } finally { output.fill(0); }
      };
      const zero = (): void => { for (const chunk of chunks) chunk.fill(0); };
      const cleanup = (): void => {
        clearTimeout(timeout);
        child.stdout.removeListener("data", onStdout);
        child.stderr.removeListener("data", onStderr);
        child.removeListener("spawn", onSpawn);
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
      };
      const finish = (result: ExecutionResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        zero();
        resolveResult(result);
      };
      const onSpawn = (): void => { spawned = true; };
      const onStdout = (chunk: Buffer | string): void => {
        const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
        size += bytes.byteLength;
        if (size > MAX_OUTPUT_BYTES) {
          bytes.fill(0);
          finish({ disposition: "ambiguous", reason: "provider_output_too_large", invocation: invocation() });
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
        invocation: invocation(),
      });
      const onClose = (code: number | null): void => {
        const evidence = invocation();
        if (!spawned || code !== 0) {
          finish({
            disposition: "ambiguous",
            reason: spawned ? "provider_exit_unclassified" : "provider_launch_outcome_unknown",
            invocation: evidence,
          });
          return;
        }
        const output = Buffer.concat(chunks);
        try {
          const result = parseSellerResult(output, input.amountAtomic);
          finish({ disposition: "seller_result", invocation: evidence, result });
        } catch {
          finish({ disposition: "ambiguous", reason: "provider_result_invalid", invocation: evidence });
        } finally { output.fill(0); }
      };
      const timeout = setTimeout(() => {
        finish({
          disposition: "ambiguous",
          reason: spawned ? "provider_process_timeout" : "provider_launch_outcome_unknown",
          invocation: invocation(),
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

function parseSellerResult(bytes: Buffer, expectedAmount: string): ProviderX402SellerResult {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw protocol(); }
  if (!isPlainRecord(value)) throw protocol();
  validateEnvelopeKeys(value);
  if (
    !Number.isSafeInteger(value.status) || Number(value.status) < 200 || Number(value.status) > 299 ||
    (Object.hasOwn(value, "statusText") && (
      typeof value.statusText !== "string" || Buffer.byteLength(value.statusText, "utf8") > MAX_STATUS_TEXT_BYTES
    )) ||
    value.paymentMade !== true || canonicalProviderAmount(value.amountPaid) !== expectedAmount
  ) throw protocol();
  let canonical: string;
  try { canonical = canonicalizeNormalizedProviderJson(value.data); }
  catch { throw protocol(); }
  const length = Buffer.byteLength(canonical, "utf8");
  if (length > MAX_OUTPUT_BYTES) throw protocol();
  return {
    classification: "normalized_provider_json",
    http_status: String(value.status),
    payment_made: true,
    amount_paid_atomic: expectedAmount,
    canonical_json: canonical,
    byte_length: length.toString(),
    sha256: sha256(canonical),
  };
}

function validateEnvelopeKeys(value: Record<string, unknown>): void {
  for (const required of REQUIRED_ENVELOPE_KEYS) if (!Object.hasOwn(value, required)) throw protocol();
  const keyShape = Object.create(null) as Record<string, null>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw protocol();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw protocol();
    const compact = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
    if (!KNOWN_ENVELOPE_KEYS.has(key) && CONFLICTING_OUTER_KEYS.has(compact)) throw protocol();
    Object.defineProperty(keyShape, key, { value: null, enumerable: true });
  }
  try { canonicalizeNormalizedProviderJson(keyShape); }
  catch { throw protocol(); }
}

function providerAtomic(value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw protocol();
  const atomic = BigInt(value);
  if (atomic < 1n || atomic > MAX_PROVIDER_ATOMIC) throw protocol();
  const numeric = Number(atomic);
  if (!Number.isSafeInteger(numeric) || BigInt(numeric) !== atomic) throw protocol();
  return numeric;
}

function canonicalProviderAmount(value: unknown): string | null {
  if (typeof value === "string") {
    try { providerAtomic(value); return value; } catch { return null; }
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value.toString()
    : null;
}

function protocol(): ApnError {
  return new ApnError("APN_PROVIDER_PROTOCOL", "The wallet provider returned an unsupported safe x402 response.");
}

const defaultLaunch: AwalX402LaunchPort = (executable, args, options) => spawn(executable, [...args], {
  shell: options.shell,
  stdio: [...options.stdio],
}) as AwalX402Child;
