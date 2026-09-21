import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { BridgeChainId } from "./chains.js";

export const MAX_READ_ATTEMPTS = 2;
export const RPC_RETRY_DELAY_MS = 2_000;
const RPC_DEFAULT_LOGICAL_ITEMS = 96;
const RPC_DEFAULT_HTTP_REQUESTS = 8;
const RPC_DEFAULT_HTTP_ATTEMPTS = 10;
const RPC_DEFAULT_DEADLINE_MS = 180_000;
const RPC_ORIGIN_GAP_MS = 750;
const RPC_BATCH_MAX_ITEMS = 32;
const TRANSIENT_TRANSPORT_REASONS = new Set(["DNS_deadline", "request_deadline", "request_interrupted", "response_aborted", "response_interrupted"]);
const IMMUTABLE_READ_METHODS = new Set(["eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getTransactionReceipt",
  "eth_getTransactionByHash", "eth_getLogs"]);

export type RpcBatchAttempt = (items: readonly Readonly<{ method: string; params: readonly unknown[] }>[]) => Promise<readonly unknown[]>;
export interface RpcBatchReadItem<T = unknown> {
  readonly method: string;
  readonly params: readonly unknown[];
  readonly cachePolicy?: "auto" | "immutable" | "snapshot" | "none";
  readonly expectedDecoder?: (value: unknown) => T;
  /** Transport-owned whole-batch attempt. All uncached items in one readBatch call must use the same function. */
  readonly batchAttempt: RpcBatchAttempt;
}
export interface RpcReadSessionOptions {
  readonly maxLogicalItems?: number;
  readonly maxHttpRequests?: number;
  readonly maxHttpAttempts?: number;
  readonly deadlineMs?: number;
  /** Backward-compatible alias. */
  readonly maxUniqueCalls?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}
export interface RpcReadTelemetry {
  readonly logicalItems: number;
  readonly httpRequests: number;
  readonly httpAttempts: number;
  readonly batchCount: number;
  readonly batchItemsByMethod: Readonly<Record<string, number>>;
  readonly dedupHits: number;
  readonly cacheHits: number;
  readonly singleflightHits: number;
  readonly endpointIdentities: readonly string[];
  readonly remainingLogicalItems: number;
  readonly remainingHttpRequests: number;
  readonly remainingHttpAttempts: number;
  readonly deadline: number;
  readonly retryAfterMs?: number;
  /** Backward-compatible telemetry aliases. */
  readonly uniqueCalls: number;
  readonly totalAttempts: number;
  readonly perMethod: Readonly<Record<string, number>>;
  readonly remainingUniqueCalls: number;
}
export class RpcHttpFailure extends Error {
  constructor(readonly method: string, readonly status: number, readonly retryAfterMs?: number) { super(`RPC HTTP ${status}`); }
}

/** Command-scoped read coordination with no persistence hook across approval or signing boundaries. */
export class RpcReadSession {
  private readonly maxLogicalItems: number;
  private readonly maxHttpRequests: number;
  private readonly maxHttpAttempts: number;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly deadline: number;
  private readonly cache = new Map<string, unknown>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly origins = new Map<string, { active: boolean; lastStart: number }>();
  private readonly queue: Array<{ origin: string; task: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
  private active = 0;
  private logicalItems = 0;
  private httpRequests = 0;
  private httpAttempts = 0;
  private batchCount = 0;
  private dedupHits = 0;
  private cacheHits = 0;
  private singleflightHits = 0;
  private retryAfterMs: number | undefined;
  private readonly methods = new Map<string, number>();
  private readonly endpoints = new Set<string>();

  constructor(options: RpcReadSessionOptions = {}) {
    this.maxLogicalItems = positiveBound(options.maxLogicalItems ?? options.maxUniqueCalls ?? RPC_DEFAULT_LOGICAL_ITEMS, "maxLogicalItems");
    this.maxHttpRequests = positiveBound(options.maxHttpRequests ?? RPC_DEFAULT_HTTP_REQUESTS, "maxHttpRequests");
    this.maxHttpAttempts = positiveBound(options.maxHttpAttempts ?? RPC_DEFAULT_HTTP_ATTEMPTS, "maxHttpAttempts");
    const deadlineMs = positiveBound(options.deadlineMs ?? RPC_DEFAULT_DEADLINE_MS, "deadlineMs");
    this.now = options.now ?? (() => Date.now());
    this.wait = options.wait ?? (async (milliseconds) => await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const started = this.now();
    if (!Number.isFinite(started)) throw new ApnError("APN_RPC_CONFIG", "RPC command clock is invalid.");
    this.deadline = started + deadlineMs;
  }

  telemetry(): RpcReadTelemetry {
    const perMethod = Object.fromEntries(this.methods);
    return { logicalItems: this.logicalItems, httpRequests: this.httpRequests, httpAttempts: this.httpAttempts,
      batchCount: this.batchCount, batchItemsByMethod: perMethod, dedupHits: this.dedupHits, cacheHits: this.cacheHits,
      singleflightHits: this.singleflightHits, endpointIdentities: [...this.endpoints].sort(),
      remainingLogicalItems: Math.max(0, this.maxLogicalItems - this.logicalItems),
      remainingHttpRequests: Math.max(0, this.maxHttpRequests - this.httpRequests),
      remainingHttpAttempts: Math.max(0, this.maxHttpAttempts - this.httpAttempts), deadline: this.deadline,
      uniqueCalls: this.logicalItems, totalAttempts: this.httpAttempts, perMethod,
      remainingUniqueCalls: Math.max(0, this.maxLogicalItems - this.logicalItems),
      ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }) };
  }

  currentTime(): number { return this.now(); }

  wrap(origin: string, chainId: BridgeChainId, call: EvmRpcCall, oneAttempt: EvmRpcCall = call): EvmRpcCall {
    return async (method, params) => {
      if (method === "eth_sendRawTransaction") return await submitDirect(method, params, oneAttempt);
      return await this.read(origin, chainId, method, params, oneAttempt);
    };
  }

  async read(origin: string, chainId: BridgeChainId, method: string, params: readonly unknown[], oneAttempt: EvmRpcCall): Promise<unknown> {
    const key = this.key(origin, chainId, method, params);
    const cached = this.cache.get(key);
    if (cached !== undefined || this.cache.has(key)) { this.dedupHits += 1; this.cacheHits += 1; return cloneRpcValue(cached); }
    const current = this.inflight.get(key);
    if (current !== undefined) {
      this.assertBeforeQueue(method); this.singleflightHits += 1;
      return cloneRpcValue(await current);
    }
    this.reserveLogical(method);
    this.reserveRequest(method);
    const operation = this.retry(origin, method, () => oneAttempt(method, params))
      .then((value) => { if (isSessionCacheable(method, params, value)) this.cache.set(key, cloneRpcValue(value)); return value; })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, operation);
    return cloneRpcValue(await operation);
  }

  /** Strict whole-batch read. Cached exact immutable/snapshot keys are removed before the one HTTP request. */
  async readBatch<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T): Promise<{ readonly [K in keyof T]: unknown }> {
    if (!Array.isArray(items) || items.length === 0) return [] as unknown as { readonly [K in keyof T]: unknown };
    const results = new Array<unknown>(items.length);
    const unique = new Map<string, { item: RpcBatchReadItem; indexes: number[] }>();
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      if (typeof item.method !== "string" || item.method.length === 0 || !Array.isArray(item.params) || typeof item.batchAttempt !== "function") {
        throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch item is malformed.");
      }
      const key = this.key(origin, chainId, item.method, item.params);
      if (this.cache.has(key)) {
        results[index] = cloneRpcValue(this.cache.get(key)); this.cacheHits += 1; this.dedupHits += 1; continue;
      }
      const existing = unique.get(key);
      if (existing !== undefined) { existing.indexes.push(index); this.dedupHits += 1; continue; }
      unique.set(key, { item, indexes: [index] });
    }
    const pending = [...unique.entries()];
    if (pending.length === 0) return results as { readonly [K in keyof T]: unknown };
    if (pending.length > RPC_BATCH_MAX_ITEMS) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Bridge RPC batch exceeds its item bound.",
      telemetryDetails(this.telemetry(), "batch", "maxBatchItems"));
    const attempt = pending[0]![1].item.batchAttempt;
    if (pending.some(([, entry]) => entry.item.batchAttempt !== attempt)) throw new ApnError("APN_RPC_CONFIG", "RPC batch transport identity is inconsistent.");
    for (const [, entry] of pending) this.reserveLogical(entry.item.method);
    this.reserveRequest("batch"); this.batchCount += 1;
    const requests = pending.map(([, entry]) => ({ method: entry.item.method, params: entry.item.params }));
    const raw = await this.retry(origin, "batch", async () => await attempt(requests));
    if (!Array.isArray(raw) || raw.length !== pending.length) throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch result count is invalid.");
    const decoded: unknown[] = [];
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index]![1].item;
      try { decoded[index] = item.expectedDecoder === undefined ? raw[index] : item.expectedDecoder(raw[index]); }
      catch (error) { if (error instanceof ApnError) throw error; throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch item decoding failed."); }
    }
    // Commit cache only after every response item and decoder succeeds.
    for (let index = 0; index < pending.length; index += 1) {
      const [key, entry] = pending[index]!, value = decoded[index];
      const policy = entry.item.cachePolicy ?? "auto";
      if (policy === "immutable" || policy === "snapshot" || policy === "auto" && isSessionCacheable(entry.item.method, entry.item.params, value)) {
        this.cache.set(key, cloneRpcValue(value));
      }
      for (const resultIndex of entry.indexes) results[resultIndex] = cloneRpcValue(value);
    }
    return results as { readonly [K in keyof T]: unknown };
  }

  private key(origin: string, chainId: BridgeChainId, method: string, params: readonly unknown[]): string {
    const endpoint = rpcEndpointIdentity(origin); this.endpoints.add(endpoint);
    return hashObject({ origin: endpoint, chainId, method, params });
  }
  private reserveLogical(method: string): void {
    this.assertDeadline(method);
    if (this.logicalItems >= this.maxLogicalItems) this.budgetError(method, "maxLogicalItems");
    this.logicalItems += 1; this.methods.set(method, (this.methods.get(method) ?? 0) + 1);
  }
  private reserveRequest(method: string): void {
    this.assertDeadline(method);
    if (this.httpRequests >= this.maxHttpRequests) this.budgetError(method, "maxHttpRequests");
    this.httpRequests += 1;
  }
  private async retry(origin: string, method: string, oneAttempt: () => Promise<unknown>): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.schedule(origin, () => {
          this.assertBeforeAttempt(method); this.httpAttempts += 1; return oneAttempt();
        });
      } catch (error) {
        const http = error instanceof RpcHttpFailure ? error : undefined, transport = approvedTransportReason(error);
        const retryable = http !== undefined ? http.status === 408 || http.status >= 500 && http.status <= 599 : transport !== undefined;
        if (!retryable || attempt + 1 >= MAX_READ_ATTEMPTS) {
          if (http !== undefined) {
            if (http.status === 429) throw this.rateLimit(method, http.retryAfterMs);
            if (method === "batch" && [400, 404, 405, 415].includes(http.status)) {
              throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC endpoint does not support JSON-RPC batching.",
                { ...telemetryDetails(this.telemetry(), method, "batch_unsupported"), httpStatus: http.status.toString(), attempts: (attempt + 1).toString() });
            }
            throw this.httpError(http, attempt + 1);
          }
          if (transport !== undefined) throw this.transportError(method, transport, attempt + 1);
          if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
          throw error;
        }
        const delay = Math.max(RPC_RETRY_DELAY_MS, http?.retryAfterMs ?? 0);
        this.assertBeforeWait(method, delay); await this.wait(delay);
      }
    }
  }
  private schedule(originInput: string, task: () => Promise<unknown>): Promise<unknown> {
    const origin = rpcOriginIdentity(originInput); this.assertBeforeQueue("rpc");
    return new Promise((resolve, reject) => { this.queue.push({ origin, task, resolve, reject }); this.pump(); });
  }
  private pump(): void {
    while (this.active < 2) {
      const index = this.queue.findIndex((entry) => !(this.origins.get(entry.origin)?.active ?? false));
      if (index < 0) return;
      const entry = this.queue.splice(index, 1)[0]!, state = this.origins.get(entry.origin) ?? { active: false, lastStart: Number.NEGATIVE_INFINITY };
      state.active = true; this.origins.set(entry.origin, state); this.active += 1; void this.runScheduled(entry, state);
    }
  }
  private async runScheduled(entry: { origin: string; task: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void },
    state: { active: boolean; lastStart: number }): Promise<void> {
    try {
      const before = this.now(), delay = Math.max(0, state.lastStart + RPC_ORIGIN_GAP_MS - before);
      this.assertBeforeWait("rpc", delay); if (delay > 0) await this.wait(delay);
      const now = this.now(); this.assertDeadline("rpc"); state.lastStart = Math.max(now, state.lastStart + RPC_ORIGIN_GAP_MS);
      entry.resolve(await entry.task());
    } catch (error) { entry.reject(error); }
    finally { state.active = false; this.active -= 1; this.pump(); }
  }
  private assertBeforeAttempt(method: string): void {
    this.assertDeadline(method); if (this.httpAttempts >= this.maxHttpAttempts) this.budgetError(method, "maxHttpAttempts");
  }
  private assertBeforeQueue(method: string): void { this.assertDeadline(method); }
  private assertBeforeWait(method: string, milliseconds: number): void {
    this.assertDeadline(method); if (milliseconds > Math.max(0, this.deadline - this.now())) this.budgetError(method, "deadline");
  }
  private assertDeadline(method: string): void { if (this.now() >= this.deadline) this.budgetError(method, "deadline"); }
  private budgetError(method: string, reason: string): never {
    throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Bridge RPC command budget exhausted.", telemetryDetails(this.telemetry(), method, reason));
  }
  private rateLimit(method: string, retryAfterMs?: number): ApnError {
    this.retryAfterMs = retryAfterMs;
    return new ApnError("APN_RPC_RATE_LIMITED", "Bridge RPC provider requested a cooldown.", telemetryDetails(this.telemetry(), method, "http_429"));
  }
  private httpError(error: RpcHttpFailure, attempts: number): ApnError {
    return new ApnError("APN_RPC_PROTOCOL", "Bridge validation failed: bridge_RPC_HTTP_status.",
      { ...telemetryDetails(this.telemetry(), error.method, "http_status"), httpStatus: error.status.toString(), attempts: attempts.toString() });
  }
  private transportError(method: string, reason: string, attempts: number): ApnError {
    return new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.",
      { ...telemetryDetails(this.telemetry(), method, reason), rpcMethod: method, attempts: attempts.toString(), transportReason: reason });
  }
}

export function rpcOriginIdentity(origin: string): string { try { return new URL(origin).origin; } catch { return "invalid-origin"; } }
export function rpcEndpointIdentity(endpoint: string): string {
  try { const parsed = new URL(endpoint); return hashObject({ protocol: parsed.protocol, hostname: parsed.hostname.toLowerCase(), port: parsed.port, pathname: parsed.pathname }); }
  catch { return "invalid-endpoint"; }
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
    ...(telemetry.retryAfterMs === undefined ? {} : { retryAfterMs: telemetry.retryAfterMs.toString() }) };
}
function positiveBound(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ApnError("APN_RPC_CONFIG", `RPC ${name} bound is invalid.`); return value;
}
function cloneRpcValue(value: unknown): unknown { if (value === undefined) return undefined; try { return structuredClone(value); } catch { return value; } }
function isNumericBlockTag(value: unknown): boolean { return typeof value === "string" && /^0x[0-9a-f]+$/u.test(value); }
function isBlockHashTag(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as Record<string, unknown>).blockHash === "string" &&
    /^0x[0-9a-f]{64}$/iu.test((value as Record<string, unknown>).blockHash as string);
}
function isSessionCacheable(method: string, params: readonly unknown[], value: unknown): boolean {
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
async function submitDirect(method: string, params: readonly unknown[], oneAttempt: EvmRpcCall): Promise<unknown> {
  try { return await oneAttempt(method, params); }
  catch (error) {
    if (error instanceof RpcHttpFailure) {
      if (error.status === 429) throw new ApnError("APN_RPC_RATE_LIMITED", "Bridge RPC provider requested a cooldown.", {
        rpcMethod: method, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs.toString() }), attempts: "1" });
      throw rpcHttpFailure("bridge_RPC_HTTP_status", method, error.status, 1);
    }
    const transport = approvedTransportReason(error);
    if (transport !== undefined) throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method, attempts: "1", transportReason: transport });
    if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
    throw error;
  }
}
function rpcHttpFailure(reason: string, method: string, status: number, attempts: number): ApnError {
  return new ApnError("APN_RPC_PROTOCOL", `Bridge validation failed: ${reason}.`, { reason, rpcMethod: method, httpStatus: status.toString(), attempts: attempts.toString() });
}
