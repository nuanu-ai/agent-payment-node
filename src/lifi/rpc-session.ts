import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { BridgeChainId } from "./chains.js";
import { RpcHttpFailure, RpcProviderScheduler, RPC_RETRY_DELAY_MS, rpcOriginIdentity } from "./rpc-scheduler.js";
export { RpcHttpFailure, RpcProviderScheduler, RPC_RETRY_DELAY_MS, rpcOriginIdentity, rpcProviderFamily } from "./rpc-scheduler.js";
export type { RpcProviderPacingCoordinator } from "./rpc-scheduler.js";

export const MAX_READ_ATTEMPTS = 2;
export const RPC_ARCHIVE_DEPLOYMENT_BATCH_MAX_ITEMS = 3;
const RPC_DEFAULT_LOGICAL_ITEMS = 96;
const RPC_DEFAULT_HTTP_REQUESTS = 8;
const RPC_DEFAULT_HTTP_ATTEMPTS = 10;
const RPC_DEFAULT_DEADLINE_MS = 180_000;
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
  /** Attempts permitted for one logical read. Defaults to the established two-attempt LI.FI contract. */
  readonly maxReadAttempts?: 1 | 2;
  readonly deadlineMs?: number;
  /** HTTP chunk bound for one atomic historical deployment read. General batches retain RPC_BATCH_MAX_ITEMS. */
  readonly archiveDeploymentBatchMaxItems?: number;
  /** One-prepare opt-in: Linea deployment code reads use scalar archive POSTs. */
  readonly lineaArchiveDeploymentScalarCode?: boolean;
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
  readonly attemptsByEndpointRole: Readonly<Record<"primary" | "receipt" | "archive", number>>;
  readonly attemptsByMethodClass: Readonly<Record<string, number>>;
  readonly attemptsByBatchSize: Readonly<Record<string, number>>;
  readonly maxBatchSize: number;
  readonly budgetRejectedBeforeTransport: number;
  /** Backward-compatible telemetry aliases. */
  readonly uniqueCalls: number;
  readonly totalAttempts: number;
  readonly perMethod: Readonly<Record<string, number>>;
  readonly remainingUniqueCalls: number;
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
  private readonly maxReadAttempts: 1 | 2;
  private readonly archiveDeploymentBatchMaxItems: number;
  private readonly lineaArchiveDeploymentScalarCode: boolean;
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
  private externalAttempts = 0;
  private externalReservations = 0;
  private batchCount = 0;
  private dedupHits = 0;
  private cacheHits = 0;
  private singleflightHits = 0;
  private retryAfterMs: number | undefined;
  private readonly methods = new Map<string, number>();
  private readonly endpoints = new Set<string>();
  private readonly roleAttempts = { primary: 0, receipt: 0, archive: 0 };
  private readonly methodClassAttempts = new Map<string, number>();
  private readonly batchSizeAttempts = new Map<number, number>();
  private maxBatchSize = 0;
  private budgetRejectedBeforeTransport = 0;

  constructor(options: RpcReadSessionOptions = {}) {
    this.maxLogicalItems = positiveBound(options.maxLogicalItems ?? options.maxUniqueCalls ?? RPC_DEFAULT_LOGICAL_ITEMS, "maxLogicalItems");
    this.maxHttpRequests = positiveBound(options.maxHttpRequests ?? RPC_DEFAULT_HTTP_REQUESTS, "maxHttpRequests");
    this.maxHttpAttempts = positiveBound(options.maxHttpAttempts ?? RPC_DEFAULT_HTTP_ATTEMPTS, "maxHttpAttempts");
    this.maxReadAttempts = options.maxReadAttempts ?? MAX_READ_ATTEMPTS;
    this.archiveDeploymentBatchMaxItems = positiveBound(options.archiveDeploymentBatchMaxItems ?? RPC_ARCHIVE_DEPLOYMENT_BATCH_MAX_ITEMS,
      "archiveDeploymentBatchMaxItems");
    this.lineaArchiveDeploymentScalarCode = options.lineaArchiveDeploymentScalarCode === true;
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
      attemptsByEndpointRole: { ...this.roleAttempts }, attemptsByMethodClass: Object.fromEntries(this.methodClassAttempts),
      attemptsByBatchSize: Object.fromEntries(this.batchSizeAttempts),
      maxBatchSize: this.maxBatchSize, budgetRejectedBeforeTransport: this.budgetRejectedBeforeTransport,
      uniqueCalls: this.logicalItems, totalAttempts: this.httpAttempts, perMethod,
      remainingUniqueCalls: Math.max(0, this.maxLogicalItems - this.logicalItems),
      ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }) };
  }

  currentTime(): number { return this.now(); }
  /** Reserve a physical POST for an effect before signing. Reads and pool probes share this limit. */
  reserveExternalAttempt(): void {
    if (this.externalReservations > 0) return;
    this.assertBeforeAttempt("eth_sendRawTransaction");
    this.externalReservations += 1;
  }
  consumeExternalAttempt(): void {
    this.reserveExternalAttempt();
    this.externalReservations -= 1;
    this.externalAttempts += 1;
  }
  recordPhysicalAttempt(endpointRole: "primary" | "receipt" | "archive", methods: readonly string[]): void {
    this.roleAttempts[endpointRole] += 1;
    for (const method of methods) {
      const category = rpcMethodClass(method); this.methodClassAttempts.set(category, (this.methodClassAttempts.get(category) ?? 0) + 1);
    }
  }

  wrap(origin: string, chainId: BridgeChainId, call: EvmRpcCall, oneAttempt: EvmRpcCall = call): EvmRpcCall {
    return async (method, params) => {
      return await this.read(origin, chainId, method, params, oneAttempt);
    };
  }

  async read(origin: string, chainId: BridgeChainId, method: string, params: readonly unknown[], oneAttempt: EvmRpcCall,
    decoder: RpcDecoder = identity): Promise<unknown> {
    assertRpcReadMethod(method);
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
    const operation = this.retry(origin, method, () => oneAttempt(method, params), true, [method])
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
    return await this.readBatchBounded(origin, chainId, items, this.archiveDeploymentBatchMaxItems, false, false,
      chainId === 59144 && this.lineaArchiveDeploymentScalarCode);
  }

  /** One atomic receipt identity read. Partial cache hits never remove chainId or receipt from the logical read. */
  async readReceiptBatch<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T,
    maxItemsPerRequest: 1 | 3): Promise<{ readonly [K in keyof T]: unknown }> {
    return await this.readBatchBounded(origin, chainId, items, maxItemsPerRequest, true);
  }

  private async readBatchBounded<T extends readonly RpcBatchReadItem[]>(origin: string, chainId: BridgeChainId, items: T,
    maxItemsPerRequest: number, atomicCache: boolean, retryHttp500 = true,
    scalarizeLineaCode = false): Promise<{ readonly [K in keyof T]: unknown }> {
    if (!Array.isArray(items) || items.length === 0) return [] as unknown as { readonly [K in keyof T]: unknown };
    for (const item of items as readonly unknown[]) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) throw invalidRpcReadMethod();
      assertRpcReadMethod((item as { readonly method?: unknown }).method);
    }
    const batchKey = hashObject({ endpoint: rpcEndpointIdentity(origin), chainId, items: items.map((item) => ({
      key: hashObject({ method: item.method, params: item.params }), cachePolicy: item.cachePolicy ?? "auto",
    })), maxItemsPerRequest, atomicCache, retryHttp500, scalarizeLineaCode });
    const current = this.batchInflight.get(batchKey);
    if (current !== undefined) {
      this.assertBeforeQueue("batch"); this.singleflightHits += 1;
      const execution = await current;
      return this.decodeBatch(items, execution.raw) as { readonly [K in keyof T]: unknown };
    }
    const operation = this.executeBatch(origin, chainId, items, maxItemsPerRequest, atomicCache, retryHttp500, scalarizeLineaCode)
      .finally(() => this.batchInflight.delete(batchKey));
    this.batchInflight.set(batchKey, operation);
    return cloneRpcValue((await operation).decoded) as { readonly [K in keyof T]: unknown };
  }

  private async executeBatch(origin: string, chainId: BridgeChainId, items: readonly RpcBatchReadItem[], maxItemsPerRequest: number,
    atomicCache: boolean, retryHttp500: boolean, scalarizeLineaCode: boolean): Promise<BatchExecution> {
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
    const chunks: Array<typeof requests> = [];
    if (scalarizeLineaCode) {
      const code = requests.filter((row) => row.method === "eth_getCode");
      for (const row of code) {
        if (row.params.length !== 2 || typeof row.params[1] !== "string" || !/^0x[0-9a-f]+$/iu.test(row.params[1])) {
          throw new ApnError("APN_RPC_PROTOCOL", "Linea deployment code read is not pinned to a block.");
        }
      }
      const other = requests.filter((row) => row.method !== "eth_getCode");
      for (let start = 0; start < other.length; start += maxItemsPerRequest) chunks.push(other.slice(start, start + maxItemsPerRequest));
      for (const row of code) chunks.push([row]);
    } else {
      for (let start = 0; start < requests.length; start += maxItemsPerRequest) chunks.push(requests.slice(start, start + maxItemsPerRequest));
    }
    for (const chunk of chunks) {
      const chunkMethod = chunk.length === 1 ? chunk[0]!.method : rpcMethod;
      this.reserveRequest(chunkMethod);
      const body = canonicalJson(chunk.length === 1 ? chunk[0] : chunk);
      const response = await this.retry(origin, chunkMethod, async () => await attempt(body), retryHttp500,
        chunk.map((row) => row.method), !(scalarizeLineaCode && chunk.length === 1 && chunk[0]!.method === "eth_getCode"));
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
        if (!Number.isSafeInteger(offset) || requests[offset]?.id !== id) throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response id set is invalid.", { rpcMethod: chunkMethod });
        seen.add(id);
        if (Object.hasOwn(row, "error")) {
          const error = row.error;
          const provider = typeof error === "object" && error !== null && !Array.isArray(error)
            ? error as Record<string, unknown> : null;
          const details = { rpcMethod: requests[offset]!.method, rpcSubcallId: id,
            ...(provider !== null && typeof provider.code === "number" && Number.isSafeInteger(provider.code)
              ? { providerCode: provider.code } : {}),
            ...(provider !== null && typeof provider.retryable === "boolean" ? { retryable: provider.retryable } : {}) };
          if (provider !== null && [-32600, -32601].includes(provider.code as number)) {
            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC endpoint does not support JSON-RPC batching.", details);
          }
          throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch contains a JSON-RPC sub-error.", details);
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
  private async retry(origin: string, method: string, oneAttempt: () => Promise<unknown>, retryHttp500 = true,
    methodsForAttempt: readonly string[] = [method], allowRetry = true): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.schedule(origin, () => {
          this.assertBeforeAttempt(method); this.httpAttempts += 1; this.recordAttemptShape(methodsForAttempt); return oneAttempt();
        });
      } catch (error) {
        const http = error instanceof RpcHttpFailure ? error : undefined, transport = approvedTransportReason(error);
        // Archive deployment HTTP 500 commonly represents deterministic provider rejection (including an oversized batch).
        // Replaying the identical chunk cannot change that shape; other bounded reads retain their existing retry contract.
        const retryable = http !== undefined ? http.status === 408 || http.status === 429 || http.status >= 500 && http.status <= 599 &&
          (http.status !== 500 || retryHttp500) : transport !== undefined;
        if (!retryable || !allowRetry || attempt + 1 >= this.maxReadAttempts) {
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
  private recordAttemptShape(methods: readonly string[]): void {
    this.maxBatchSize = Math.max(this.maxBatchSize, methods.length);
    this.batchSizeAttempts.set(methods.length, (this.batchSizeAttempts.get(methods.length) ?? 0) + 1);
    if (methods.length > 1) this.batchCount += 1;
  }
  private assertBeforeAttempt(method: string): void {
    this.assertDeadline(method);
    if (this.httpAttempts + this.externalAttempts + this.externalReservations >= this.maxHttpAttempts)
      this.budgetError(method, "maxHttpAttempts");
  }
  private assertBeforeQueue(method: string): void { this.assertDeadline(method); }
  private assertBeforeWait(method: string, milliseconds: number): void {
    this.assertDeadline(method); if (milliseconds > Math.max(0, this.deadline - this.now())) this.budgetError(method, "deadline");
  }
  private assertDeadline(method: string): void { if (this.now() >= this.deadline) this.budgetError(method, "deadline"); }
  private budgetError(method: string, reason: string): never {
    this.budgetRejectedBeforeTransport += 1;
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

export function rpcEndpointIdentity(endpoint: string): string {
  try { const parsed = new URL(endpoint); return hashObject({ protocol: parsed.protocol, hostname: parsed.hostname.toLowerCase(), port: parsed.port, pathname: parsed.pathname }); }
  catch { return "invalid-endpoint"; }
}
function invalidRpcReadMethod(): ApnError {
  return new ApnError("APN_RPC_PROTOCOL", "Bridge RPC read method is not allowlisted.", { reason: "bridge_RPC_read_method" });
}
function assertRpcReadMethod(method: unknown): asserts method is RpcReadMethod {
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
function rpcMethodClass(method: string): string {
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
