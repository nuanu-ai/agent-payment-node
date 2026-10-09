import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { WBTC_ACROSS_CONTINUATION_POST_LIMIT, type BridgeRpcPhysicalPolicy } from "./rpc-execution-budget.js";
import type { RpcReadTelemetry } from "./rpc-session.js";

export type RpcDecoder<T = unknown> = (value: unknown) => T;

export const MAX_READ_ATTEMPTS = 2;
export const BRIDGE_INVOCATION_RPC_POST_LIMIT = 24;
/** One invocation's physical transport gate, shared by every chain and read/observation session. */
export class BridgeRpcPhysicalBudget {
  private posts = 0;
  private lastStart = Number.NEGATIVE_INFINITY;
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number) => Promise<void> = async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly policy: BridgeRpcPhysicalPolicy = "default") {}
  remaining(): number { return (this.policy === "canonical_wbtc_across_approval_continuation" ? WBTC_ACROSS_CONTINUATION_POST_LIMIT : BRIDGE_INVOCATION_RPC_POST_LIMIT) - this.posts; }
  require(posts: number, method: string): void {
    if (this.remaining() < posts) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Bridge RPC invocation POST budget exhausted.",
      { reason: "physical_post_limit", rpcMethod: method, physicalPosts: this.posts.toString(), remainingPhysicalPosts: this.remaining().toString() });
  }
  async beforePost(method: string): Promise<void> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      this.require(1, method);
      const nextStart = this.lastStart + 750;
      while (this.now() < nextStart) {
        const before = this.now();
        await this.wait(nextStart - before);
        if (this.now() <= before) throw new ApnError("APN_RPC_CONFIG", "Bridge RPC invocation pacing clock did not advance.");
      }
      this.require(1, method);
      this.posts += 1; this.lastStart = this.now();
    } finally { release(); }
  }
}
export const RPC_ARCHIVE_DEPLOYMENT_BATCH_MAX_ITEMS = 3;
export const RPC_DEFAULT_LOGICAL_ITEMS = 96;
export const RPC_DEFAULT_HTTP_REQUESTS = 8;
export const RPC_DEFAULT_HTTP_ATTEMPTS = 10;
export const RPC_DEFAULT_DEADLINE_MS = 180_000;
export const RPC_BATCH_MAX_ITEMS = 33;
const TRANSIENT_TRANSPORT_REASONS = new Set(["DNS_deadline", "request_deadline", "request_interrupted", "response_aborted", "response_interrupted"]);
export const RPC_READ_METHODS = [
  "eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount",
  "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getLogs", "debug_traceTransaction",
] as const;
export type RpcReadMethod = typeof RPC_READ_METHODS[number];
const RPC_READ_METHOD_SET: ReadonlySet<string> = new Set(RPC_READ_METHODS);
const IMMUTABLE_READ_METHODS = new Set(["eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getTransactionReceipt",
  "eth_getTransactionByHash", "eth_getLogs"]);

export function rpcEndpointIdentity(endpoint: string): string {
  try { const parsed = new URL(endpoint); return hashObject({ protocol: parsed.protocol, hostname: parsed.hostname.toLowerCase(), port: parsed.port, pathname: parsed.pathname }); }
  catch { return "invalid-endpoint"; }
}
export function invalidRpcReadMethod(): ApnError {
  return new ApnError("APN_RPC_PROTOCOL", "Bridge RPC read method is not allowlisted.", { reason: "bridge_RPC_read_method" });
}
export function assertRpcReadMethod(method: unknown): asserts method is RpcReadMethod {
  if (typeof method !== "string" || !RPC_READ_METHOD_SET.has(method)) throw invalidRpcReadMethod();
}
export function approvedTransportReason(error: unknown): string | undefined {
  if (!(error instanceof ApnError) || error.code !== "APN_RPC_AMBIGUOUS") return undefined;
  const reason = error.details?.transportReason;
  return typeof reason === "string" && TRANSIENT_TRANSPORT_REASONS.has(reason) ? reason : undefined;
}
export function parseRetryAfter(headers: Readonly<Record<string, string | readonly string[] | undefined>> | undefined, now: number): number | undefined {
  if (headers === undefined) return undefined;
  const raw = Object.entries(headers).find(([key]) => key.toLowerCase() === "retry-after")?.[1];
  const value = (typeof raw === "string" ? raw : raw?.[0])?.trim();
  if (value === undefined || value === "" || value.startsWith("-")) return undefined;
  if (/^[0-9]+$/u.test(value)) return Math.min(30_000, Number(value) * 1_000);
  if (!value.includes(",") || !/GMT$/iu.test(value)) return undefined;
  const at = Date.parse(value), delay = at - now;
  if (!Number.isFinite(at) || delay < 0) return undefined;
  return Math.min(30_000, delay);
}
export function telemetryDetails(telemetry: RpcReadTelemetry, method: string, reason: string): Record<string, string> {
  return { reason, rpcMethod: method, logicalItems: telemetry.logicalItems.toString(), httpRequests: telemetry.httpRequests.toString(),
    httpAttempts: telemetry.httpAttempts.toString(), batchCount: telemetry.batchCount.toString(),
    batchItemsByMethod: canonicalJson(telemetry.batchItemsByMethod), dedupHits: telemetry.dedupHits.toString(), cacheHits: telemetry.cacheHits.toString(),
    singleflightHits: telemetry.singleflightHits.toString(), endpointIdentities: canonicalJson(telemetry.endpointIdentities),
    remainingLogicalItems: telemetry.remainingLogicalItems.toString(), remainingHttpRequests: telemetry.remainingHttpRequests.toString(),
    remainingHttpAttempts: telemetry.remainingHttpAttempts.toString(), deadline: telemetry.deadline.toString(),
    uniqueCalls: telemetry.uniqueCalls.toString(), totalAttempts: telemetry.totalAttempts.toString(), perMethod: canonicalJson(telemetry.perMethod),
    remainingUniqueCalls: telemetry.remainingUniqueCalls.toString(),
    attemptsByEndpointRole: canonicalJson(telemetry.attemptsByEndpointRole),
    attemptsByMethodClass: canonicalJson(telemetry.attemptsByMethodClass), maxBatchSize: telemetry.maxBatchSize.toString(),
    attemptsByBatchSize: canonicalJson(telemetry.attemptsByBatchSize),
    budgetRejectedBeforeTransport: telemetry.budgetRejectedBeforeTransport.toString(),
    ...(telemetry.retryAfterMs === undefined ? {} : { retryAfterMs: telemetry.retryAfterMs.toString() }) };
}
export function rpcMethodClass(method: string): string {
  if (method === "eth_chainId") return "chain";
  if (method === "eth_getTransactionByHash") return "transaction";
  if (method === "eth_getTransactionReceipt") return "receipt";
  if (method === "eth_getBlockByNumber") return "block";
  if (method === "eth_getCode") return "code";
  if (method === "eth_getStorageAt") return "storage";
  if (method === "eth_call") return "call";
  if (method === "eth_getLogs") return "logs";
  return "other";
}
export function positiveBound(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApnError("APN_RPC_CONFIG", `RPC ${name} bound is invalid.`); return value;
}
export function identity(value: unknown): unknown { return value; }
export function decodeRpcValue<T>(decoder: RpcDecoder<T>, raw: unknown): T {
  try { return decoder(raw); }
  catch (error) { if (error instanceof ApnError) throw error; throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC item decoding failed."); }
}
export function cloneRpcValue(value: unknown): unknown { if (value === undefined) return undefined; try { return structuredClone(value); } catch { return value; } }
function isNumericBlockTag(value: unknown): boolean { return typeof value === "string" && /^0x[0-9a-f]+$/u.test(value); }
function isBlockHashTag(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).blockHash === "string" &&
    /^0x[0-9a-f]{64}$/iu.test((value as Record<string, unknown>).blockHash as string);
}
export function isSessionCacheable(method: string, params: readonly unknown[], value: unknown): boolean {
  if (method === "eth_chainId") return true;
  if (!IMMUTABLE_READ_METHODS.has(method)) return false;
  if (method === "eth_getBlockByNumber") return isNumericBlockTag(params[0]) || isBlockHashTag(params[0]) || params[0] === "safe" || params[0] === "finalized";
  if (method === "eth_getLogs") {
    const query = params[0]; if (typeof query !== "object" || query === null || Array.isArray(query)) return false;
    const record = query as Record<string, unknown>; if (isBlockHashTag(record)) return true;
    return (isNumericBlockTag(record.fromBlock) || isBlockHashTag(record.fromBlock)) && (isNumericBlockTag(record.toBlock) || isBlockHashTag(record.toBlock));
  }
  const tag = params.at(-1); if (isNumericBlockTag(tag) || isBlockHashTag(tag)) return true;
  if ((method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") && value !== null && typeof value === "object" &&
    typeof (value as Record<string, unknown>).blockHash === "string" && /^0x[0-9a-f]{64}$/iu.test((value as Record<string, unknown>).blockHash as string)) return true;
  return false;
}
