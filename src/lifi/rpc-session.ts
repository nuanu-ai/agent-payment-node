import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { BridgeChainId } from "./chains.js";

export const MAX_READ_ATTEMPTS = 2;
export const RPC_RETRY_DELAY_MS = 2_000;
export const RPC_ARCHIVE_DEPLOYMENT_BATCH_MAX_ITEMS = 3;
const RPC_DEFAULT_LOGICAL_ITEMS = 96;
const RPC_DEFAULT_HTTP_REQUESTS = 8;
const RPC_DEFAULT_HTTP_ATTEMPTS = 10;
const RPC_DEFAULT_DEADLINE_MS = 180_000;
const RPC_ORIGIN_GAP_MS = 750;
export const RPC_BATCH_MAX_ITEMS = 33;
const TRANSIENT_TRANSPORT_REASONS = new Set(["DNS_deadline", "request_deadline", "request_interrupted", "response_aborted", "response_interrupted"]);
const IMMUTABLE_READ_METHODS = new Set(["eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getTransactionReceipt",
  "eth_getTransactionByHash", "eth_getLogs"]);

export type RpcBatchAttempt = (canonicalBody: string) => Promise<unknown>;
export interface RpcBatchReadItem<T = unknown> {
  readonly method: string;
  readonly params: readonly unknown[];
  readonly cachePolicy?: "auto" | "immutable" | "snapshot" | "none";
  readonly decoder: (value: unknown) => T;
  /** Transport-owned whole-batch attempt. All uncached items in one readBatch call must use the same function. */
  readonly batchAttempt: RpcBatchAttempt;
}
export interface RpcReadSessionOptions {
  readonly maxLogicalItems?: number;
  readonly maxHttpRequests?: number;
  readonly maxHttpAttempts?: number;
  readonly deadlineMs?: number;
  /** HTTP chunk bound for one atomic historical deployment read. General batches retain RPC_BATCH_MAX_ITEMS. */
  readonly archiveDeploymentBatchMaxItems?: number;
  /** Backward-compatible alias. */
  readonly maxUniqueCalls?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  /** Shared by related commands so one provider family cannot be burst through separate sessions. */
  readonly providerScheduler?: RpcProviderScheduler;
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

interface ScheduledRpcRead {
  readonly family: string;
  readonly now: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly beforeWait: (milliseconds: number) => void;
  readonly task: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}
export interface RpcProviderPacingCoordinator {
  coordinate<T>(family: string, work: (lastStart: number | null, saveStart: (value: number) => Promise<void>) => Promise<T>): Promise<T>;
}

/** Provider-family coordination. A coordinator can serialize starts and retain pacing across CLI processes. */
export class RpcProviderScheduler {
  private readonly families = new Map<string, { active: boolean; lastStart: number }>();
  private readonly queue: ScheduledRpcRead[] = [];
  private active = 0;
  constructor(private readonly coordinator?: RpcProviderPacingCoordinator) {}

  schedule(origin: string, now: () => number, wait: (milliseconds: number) => Promise<void>, beforeWait: (milliseconds: number) => void,
    task: () => Promise<unknown>): Promise<unknown> {
    const family = rpcProviderFamily(origin);
    return new Promise((resolve, reject) => { this.queue.push({ family, now, wait, beforeWait, task, resolve, reject }); this.pump(); });
  }

  private pump(): void {
    while (this.active < 2) {
      const index = this.queue.findIndex((entry) => !(this.families.get(entry.family)?.active ?? false));
      if (index < 0) return;
      const entry = this.queue.splice(index, 1)[0]!, state = this.families.get(entry.family) ?? { active: false, lastStart: Number.NEGATIVE_INFINITY };
      state.active = true; this.families.set(entry.family, state); this.active += 1; void this.run(entry, state);
    }
  }

  private async run(entry: ScheduledRpcRead, state: { active: boolean; lastStart: number }): Promise<void> {
    try {
      const execute = async (persisted: number | null, saveStart: (value: number) => Promise<void>) => {
        const lastStart = Math.max(state.lastStart, persisted ?? Number.NEGATIVE_INFINITY), before = entry.now();
        const delay = Math.max(0, lastStart + RPC_ORIGIN_GAP_MS - before);
        entry.beforeWait(delay); if (delay > 0) await entry.wait(delay);
        const current = entry.now(); state.lastStart = current > before ? current : before;
        await saveStart(state.lastStart);
        return await entry.task();
      };
      entry.resolve(this.coordinator === undefined ? await execute(null, async () => {}) : await this.coordinator.coordinate(entry.family, execute));
    } catch (error) { entry.reject(error); }
    finally { state.active = false; this.active -= 1; this.pump(); }
  }
}

type RpcDecoder<T = unknown> = (value: unknown) => T;
interface BatchExecution {
  readonly raw: readonly unknown[];
  readonly decoded: readonly unknown[];
}

/** Command-scoped read coordination with no persistence hook across approval or signing boundaries. */
export class RpcReadSession {
  private readonly maxLogicalItems: number;
  private readonly maxHttpRequests: number;
  private readonly maxHttpAttempts: number;
  private readonly archiveDeploymentBatchMaxItems: number;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly deadline: number;
  private readonly providerScheduler: RpcProviderScheduler;
  private readonly cache = new Map<string, unknown>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly batchInflight = new Map<string, Promise<BatchExecution>>();
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
    this.archiveDeploymentBatchMaxItems = positiveBound(options.archiveDeploymentBatchMaxItems ?? RPC_ARCHIVE_DEPLOYMENT_BATCH_MAX_ITEMS,
      "archiveDeploymentBatchMaxItems");
    if (this.archiveDeploymentBatchMaxItems > RPC_ARCHIVE_DEPLOYMENT_BATCH_MAX_ITEMS) {
      throw new ApnError("APN_RPC_CONFIG", "RPC archiveDeploymentBatchMaxItems bound is invalid.");
    }
    const deadlineMs = positiveBound(options.deadlineMs ?? RPC_DEFAULT_DEADLINE_MS, "deadlineMs");
    this.now = options.now ?? (() => Date.now());
    this.wait = options.wait ?? (async (milliseconds) => await new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    this.providerScheduler = options.providerScheduler ?? new RpcProviderScheduler();
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

  async read(origin: string, chainId: BridgeChainId, method: string, params: readonly unknown[], oneAttempt: EvmRpcCall,
    decoder: RpcDecoder = identity): Promise<unknown> {
    const key = this.key(origin, chainId, method, params);
    const cached = this.cache.get(key);
    if (cached !== undefined || this.cache.has(key)) {
      this.dedupHits += 1; this.cacheHits += 1; return decodeRpcValue(decoder, cloneRpcValue(cached));
    }
    const current = this.inflight.get(key);
    if (current !== undefined) {
      this.assertBeforeQueue(method); this.singleflightHits += 1;
      return decodeRpcValue(decoder, cloneRpcValue(await current));
    }
    this.reserveLogical(method);
    this.reserveRequest(method);
    const operation = this.retry(origin, method, () => oneAttempt(method, params))
      .then((raw) => { if (isSessionCacheable(method, params, raw)) this.cache.set(key, cloneRpcValue(raw)); return raw; })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, operation);
    return decodeRpcValue(decoder, cloneRpcValue(await operation));
  }

  /** Strict whole-batch read. Cached exact immutable/snapshot keys are removed before the one HTTP request. */
  async readBatch<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T): Promise<{ readonly [K in keyof T]: unknown }> {
    return await this.readBatchBounded(origin, chainId, items, RPC_BATCH_MAX_ITEMS, false, true);
  }

  /** One logical archive deployment read, transported sequentially in provider-sized chunks with one atomic cache commit. */
  async readArchiveDeploymentBatch<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T): Promise<{ readonly [K in keyof T]: unknown }> {
    return await this.readBatchBounded(origin, chainId, items, this.archiveDeploymentBatchMaxItems, false, false);
  }

  /** One atomic receipt identity read. Partial cache hits never remove chainId or receipt from the logical read. */
  async readReceiptBatch<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T,
    maxItemsPerRequest: 1 | 3): Promise<{ readonly [K in keyof T]: unknown }> {
    return await this.readBatchBounded(origin, chainId, items, maxItemsPerRequest, true);
  }

  private async readBatchBounded<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T,
    maxItemsPerRequest: number, atomicCache: boolean, retryHttp500 = true): Promise<{ readonly [K in keyof T]: unknown }> {
    if (!Array.isArray(items) || items.length === 0) return [] as unknown as { readonly [K in keyof T]: unknown };
    const batchKey = hashObject({ endpoint: rpcEndpointIdentity(origin), chainId, items: items.map((item) => ({
      key: hashObject({ method: item.method, params: item.params }), cachePolicy: item.cachePolicy ?? "auto",
    })), maxItemsPerRequest, atomicCache, retryHttp500 });
    const current = this.batchInflight.get(batchKey);
    if (current !== undefined) {
      this.assertBeforeQueue("batch"); this.singleflightHits += 1;
      const execution = await current;
      return this.decodeBatch(items, execution.raw) as { readonly [K in keyof T]: unknown };
    }
    const operation = this.executeBatch(origin, chainId, items, maxItemsPerRequest, atomicCache, retryHttp500)
      .finally(() => this.batchInflight.delete(batchKey));
    this.batchInflight.set(batchKey, operation);
    return cloneRpcValue((await operation).decoded) as { readonly [K in keyof T]: unknown };
  }

  private async executeBatch(origin: string, chainId: BridgeChainId, items: readonly RpcBatchReadItem[], maxItemsPerRequest: number,
    atomicCache: boolean, retryHttp500: boolean): Promise<BatchExecution> {
    const rawResults = new Array<unknown>(items.length), decodedResults = new Array<unknown>(items.length);
    const unique = new Map<string, { cacheKey: string; item: RpcBatchReadItem;
      decoders: Array<{ index: number; decoder: RpcDecoder }> }>();
    const atomicCacheHit = atomicCache && items.every((item) => item.cachePolicy !== "none" &&
      this.cache.has(this.key(origin, chainId, item.method, item.params)));
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      if (typeof item.method !== "string" || item.method.length === 0 || !Array.isArray(item.params) ||
          typeof item.decoder !== "function" || typeof item.batchAttempt !== "function") {
        throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch item is malformed.");
      }
      const cacheKey = this.key(origin, chainId, item.method, item.params), policy = item.cachePolicy ?? "auto";
      if (policy !== "none" && (!atomicCache || atomicCacheHit) && this.cache.has(cacheKey)) {
        const raw = cloneRpcValue(this.cache.get(cacheKey));
        rawResults[index] = raw; decodedResults[index] = decodeRpcValue(item.decoder, raw);
        this.cacheHits += 1; this.dedupHits += 1; continue;
      }
      const uniqueKey = hashObject({ cacheKey, policy }), existing = unique.get(uniqueKey);
      if (existing !== undefined) {
        existing.decoders.push({ index, decoder: item.decoder }); this.dedupHits += 1; continue;
      }
      unique.set(uniqueKey, { cacheKey, item, decoders: [{ index, decoder: item.decoder }] });
    }
    const pending = [...unique.entries()];
    if (pending.length === 0) return { raw: rawResults, decoded: decodedResults };
    if (pending.length > RPC_BATCH_MAX_ITEMS) throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Bridge RPC batch exceeds its item bound.",
      telemetryDetails(this.telemetry(), "batch", "maxBatchItems"));
    const attempt = pending[0]![1].item.batchAttempt;
    if (pending.some(([, entry]) => entry.item.batchAttempt !== attempt)) throw new ApnError("APN_RPC_CONFIG", "RPC batch transport identity is inconsistent.");
    for (const [, entry] of pending) this.reserveLogical(entry.item.method);
    const rpcMethod = pending.length === 1 ? pending[0]![1].item.method : "batch";
    const requests = pending.map(([, entry], index) => ({ jsonrpc: "2.0", id: String(index + 1), method: entry.item.method, params: entry.item.params }));
    const raw = new Array<unknown>(pending.length), seen = new Set<string>();
    for (let start = 0; start < requests.length; start += maxItemsPerRequest) {
      const chunk = requests.slice(start, start + maxItemsPerRequest), chunkMethod = chunk.length === 1 ? chunk[0]!.method : rpcMethod;
      this.reserveRequest(chunkMethod); this.batchCount += chunk.length === 1 ? 0 : 1;
      const body = canonicalJson(chunk.length === 1 ? chunk[0] : chunk);
      const response = await this.retry(origin, chunkMethod, async () => await attempt(body), retryHttp500);
      const responses = chunk.length === 1 ? [response] : response;
      if (!Array.isArray(responses)) throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC endpoint does not support JSON-RPC batching.", { rpcMethod: chunkMethod });
      if (responses.length !== chunk.length) throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch result count is invalid.", { rpcMethod: chunkMethod });
      const expected = new Set(chunk.map((request) => request.id));
      for (const candidate of responses) {
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response item is malformed.", { rpcMethod: chunkMethod });
        const row = candidate as Record<string, unknown>, id = row.id;
        if (row.jsonrpc !== "2.0" || typeof id !== "string" || !expected.has(id) || seen.has(id)) {
          throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response id set is invalid.", { rpcMethod: chunkMethod });
        }
        const offset = Number(id) - 1;
        if (!Number.isSafeInteger(offset) || offset < start || offset >= start + chunk.length) throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response id set is invalid.", { rpcMethod: chunkMethod });
        seen.add(id);
        if (Object.hasOwn(row, "error")) {
          const error = row.error;
          if (typeof error === "object" && error !== null && !Array.isArray(error) &&
              [-32600, -32601].includes((error as Record<string, unknown>).code as number)) {
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC endpoint does not support JSON-RPC batching.", { rpcMethod: chunkMethod });
          }
          throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch contains a JSON-RPC sub-error.", { rpcMethod: chunkMethod });
        }
        if (!Object.hasOwn(row, "result") || Object.keys(row).some((key) => !["jsonrpc", "id", "result"].includes(key))) {
          throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response item is malformed.", { rpcMethod: chunkMethod });
        }
        raw[offset] = row.result;
      }
    }
    if (seen.size !== pending.length) throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response id set is invalid.", { rpcMethod });
    // Validate every caller's decoder against the raw response before mutating the cache.
    for (let index = 0; index < pending.length; index += 1) {
      const [, entry] = pending[index]!, rawValue = cloneRpcValue(raw[index]);
      for (const reference of entry.decoders) {
        rawResults[reference.index] = cloneRpcValue(rawValue);
        decodedResults[reference.index] = decodeRpcValue(reference.decoder, rawValue);
      }
    }
    // Commit cache only after every response item and decoder succeeds.
    for (let index = 0; index < pending.length; index += 1) {
      const [, entry] = pending[index]!, value = raw[index];
      const policy = entry.item.cachePolicy ?? "auto";
      if (policy === "immutable" || policy === "snapshot" || policy === "auto" && isSessionCacheable(entry.item.method, entry.item.params, value)) {
        this.cache.set(entry.cacheKey, cloneRpcValue(value));
      }
    }
    return { raw: rawResults, decoded: decodedResults };
  }

  private decodeBatch(items: readonly RpcBatchReadItem[], raw: readonly unknown[]): readonly unknown[] {
    const decoded = new Array<unknown>(items.length);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      if (typeof item.decoder !== "function") throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch item is malformed.");
      decoded[index] = decodeRpcValue(item.decoder, cloneRpcValue(raw[index]));
    }
    return decoded;
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
  private async retry(origin: string, method: string, oneAttempt: () => Promise<unknown>, retryHttp500 = true): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.schedule(origin, () => {
          this.assertBeforeAttempt(method); this.httpAttempts += 1; return oneAttempt();
        });
      } catch (error) {
        const http = error instanceof RpcHttpFailure ? error : undefined, transport = approvedTransportReason(error);
        // Archive deployment HTTP 500 commonly represents deterministic provider rejection (including an oversized batch).
        // Replaying the identical chunk cannot change that shape; other bounded reads retain their existing retry contract.
        const retryable = http !== undefined ? http.status === 408 || http.status === 429 || http.status >= 500 && http.status <= 599 &&
          (http.status !== 500 || retryHttp500) : transport !== undefined;
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
    this.assertBeforeQueue("rpc");
    return this.providerScheduler.schedule(originInput, this.now, this.wait, (delay) => this.assertBeforeWait("rpc", delay), async () => {
      this.assertDeadline("rpc"); return await task();
    });
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
export function rpcProviderFamily(origin: string): string {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "publicnode.com" || hostname.endsWith(".publicnode.com") ? "publicnode.com" : hostname;
  } catch { return "invalid-origin"; }
}
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
function identity(value: unknown): unknown { return value; }
function decodeRpcValue<T>(decoder: RpcDecoder<T>, raw: unknown): T {
  try { return decoder(raw); }
  catch (error) { if (error instanceof ApnError) throw error; throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC item decoding failed."); }
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
