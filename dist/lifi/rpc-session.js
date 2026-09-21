import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
export const MAX_READ_ATTEMPTS = 2;
export const RPC_RETRY_DELAY_MS = 2_000;
const RPC_DEFAULT_LOGICAL_ITEMS = 96;
const RPC_DEFAULT_HTTP_REQUESTS = 8;
const RPC_DEFAULT_HTTP_ATTEMPTS = 10;
const RPC_DEFAULT_DEADLINE_MS = 180_000;
const RPC_ORIGIN_GAP_MS = 750;
export const RPC_BATCH_MAX_ITEMS = 33;
const TRANSIENT_TRANSPORT_REASONS = new Set(["DNS_deadline", "request_deadline", "request_interrupted", "response_aborted", "response_interrupted"]);
const IMMUTABLE_READ_METHODS = new Set(["eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_getTransactionReceipt",
    "eth_getTransactionByHash", "eth_getLogs"]);
export class RpcHttpFailure extends Error {
    method;
    status;
    retryAfterMs;
    constructor(method, status, retryAfterMs) {
        super(`RPC HTTP ${status}`);
        this.method = method;
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}
/** Command-scoped read coordination with no persistence hook across approval or signing boundaries. */
export class RpcReadSession {
    maxLogicalItems;
    maxHttpRequests;
    maxHttpAttempts;
    archiveDeploymentBatchMaxItems;
    now;
    wait;
    deadline;
    cache = new Map();
    inflight = new Map();
    batchInflight = new Map();
    origins = new Map();
    queue = [];
    active = 0;
    logicalItems = 0;
    httpRequests = 0;
    httpAttempts = 0;
    batchCount = 0;
    dedupHits = 0;
    cacheHits = 0;
    singleflightHits = 0;
    retryAfterMs;
    methods = new Map();
    endpoints = new Set();
    constructor(options = {}) {
        this.maxLogicalItems = positiveBound(options.maxLogicalItems ?? options.maxUniqueCalls ?? RPC_DEFAULT_LOGICAL_ITEMS, "maxLogicalItems");
        this.maxHttpRequests = positiveBound(options.maxHttpRequests ?? RPC_DEFAULT_HTTP_REQUESTS, "maxHttpRequests");
        this.maxHttpAttempts = positiveBound(options.maxHttpAttempts ?? RPC_DEFAULT_HTTP_ATTEMPTS, "maxHttpAttempts");
        this.archiveDeploymentBatchMaxItems = positiveBound(options.archiveDeploymentBatchMaxItems ?? RPC_BATCH_MAX_ITEMS, "archiveDeploymentBatchMaxItems");
        if (this.archiveDeploymentBatchMaxItems > RPC_BATCH_MAX_ITEMS) {
            throw new ApnError("APN_RPC_CONFIG", "RPC archiveDeploymentBatchMaxItems bound is invalid.");
        }
        const deadlineMs = positiveBound(options.deadlineMs ?? RPC_DEFAULT_DEADLINE_MS, "deadlineMs");
        this.now = options.now ?? (() => Date.now());
        this.wait = options.wait ?? (async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds)));
        const started = this.now();
        if (!Number.isFinite(started))
            throw new ApnError("APN_RPC_CONFIG", "RPC command clock is invalid.");
        this.deadline = started + deadlineMs;
    }
    telemetry() {
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
    currentTime() { return this.now(); }
    wrap(origin, chainId, call, oneAttempt = call) {
        return async (method, params) => {
            if (method === "eth_sendRawTransaction")
                return await submitDirect(method, params, oneAttempt);
            return await this.read(origin, chainId, method, params, oneAttempt);
        };
    }
    async read(origin, chainId, method, params, oneAttempt, decoder = identity) {
        const key = this.key(origin, chainId, method, params);
        const cached = this.cache.get(key);
        if (cached !== undefined || this.cache.has(key)) {
            this.dedupHits += 1;
            this.cacheHits += 1;
            return decodeRpcValue(decoder, cloneRpcValue(cached));
        }
        const current = this.inflight.get(key);
        if (current !== undefined) {
            this.assertBeforeQueue(method);
            this.singleflightHits += 1;
            return decodeRpcValue(decoder, cloneRpcValue(await current));
        }
        this.reserveLogical(method);
        this.reserveRequest(method);
        const operation = this.retry(origin, method, () => oneAttempt(method, params))
            .then((raw) => { if (isSessionCacheable(method, params, raw))
            this.cache.set(key, cloneRpcValue(raw)); return raw; })
            .finally(() => this.inflight.delete(key));
        this.inflight.set(key, operation);
        return decodeRpcValue(decoder, cloneRpcValue(await operation));
    }
    /** Strict whole-batch read. Cached exact immutable/snapshot keys are removed before the one HTTP request. */
    async readBatch(origin, chainId, items) {
        return await this.readBatchBounded(origin, chainId, items, RPC_BATCH_MAX_ITEMS);
    }
    /** One logical archive deployment read, transported sequentially in provider-sized chunks with one atomic cache commit. */
    async readArchiveDeploymentBatch(origin, chainId, items) {
        return await this.readBatchBounded(origin, chainId, items, this.archiveDeploymentBatchMaxItems);
    }
    async readBatchBounded(origin, chainId, items, maxItemsPerRequest) {
        if (!Array.isArray(items) || items.length === 0)
            return [];
        const batchKey = hashObject({ endpoint: rpcEndpointIdentity(origin), chainId, items: items.map((item) => ({
                key: hashObject({ method: item.method, params: item.params }), cachePolicy: item.cachePolicy ?? "auto",
            })), maxItemsPerRequest });
        const current = this.batchInflight.get(batchKey);
        if (current !== undefined) {
            this.assertBeforeQueue("batch");
            this.singleflightHits += 1;
            const execution = await current;
            return this.decodeBatch(items, execution.raw);
        }
        const operation = this.executeBatch(origin, chainId, items, maxItemsPerRequest).finally(() => this.batchInflight.delete(batchKey));
        this.batchInflight.set(batchKey, operation);
        return cloneRpcValue((await operation).decoded);
    }
    async executeBatch(origin, chainId, items, maxItemsPerRequest) {
        const rawResults = new Array(items.length), decodedResults = new Array(items.length);
        const unique = new Map();
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            if (typeof item.method !== "string" || item.method.length === 0 || !Array.isArray(item.params) ||
                typeof item.decoder !== "function" || typeof item.batchAttempt !== "function") {
                throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch item is malformed.");
            }
            const cacheKey = this.key(origin, chainId, item.method, item.params), policy = item.cachePolicy ?? "auto";
            if (policy !== "none" && this.cache.has(cacheKey)) {
                const raw = cloneRpcValue(this.cache.get(cacheKey));
                rawResults[index] = raw;
                decodedResults[index] = decodeRpcValue(item.decoder, raw);
                this.cacheHits += 1;
                this.dedupHits += 1;
                continue;
            }
            const uniqueKey = hashObject({ cacheKey, policy }), existing = unique.get(uniqueKey);
            if (existing !== undefined) {
                existing.decoders.push({ index, decoder: item.decoder });
                this.dedupHits += 1;
                continue;
            }
            unique.set(uniqueKey, { cacheKey, item, decoders: [{ index, decoder: item.decoder }] });
        }
        const pending = [...unique.entries()];
        if (pending.length === 0)
            return { raw: rawResults, decoded: decodedResults };
        if (pending.length > RPC_BATCH_MAX_ITEMS)
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Bridge RPC batch exceeds its item bound.", telemetryDetails(this.telemetry(), "batch", "maxBatchItems"));
        const attempt = pending[0][1].item.batchAttempt;
        if (pending.some(([, entry]) => entry.item.batchAttempt !== attempt))
            throw new ApnError("APN_RPC_CONFIG", "RPC batch transport identity is inconsistent.");
        for (const [, entry] of pending)
            this.reserveLogical(entry.item.method);
        const rpcMethod = pending.length === 1 ? pending[0][1].item.method : "batch";
        const requests = pending.map(([, entry], index) => ({ jsonrpc: "2.0", id: String(index + 1), method: entry.item.method, params: entry.item.params }));
        const raw = new Array(pending.length), seen = new Set();
        for (let start = 0; start < requests.length; start += maxItemsPerRequest) {
            const chunk = requests.slice(start, start + maxItemsPerRequest), chunkMethod = chunk.length === 1 ? chunk[0].method : rpcMethod;
            this.reserveRequest(chunkMethod);
            this.batchCount += chunk.length === 1 ? 0 : 1;
            const body = canonicalJson(chunk.length === 1 ? chunk[0] : chunk);
            const response = await this.retry(origin, chunkMethod, async () => await attempt(body));
            const responses = chunk.length === 1 ? [response] : response;
            if (!Array.isArray(responses))
                throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC endpoint does not support JSON-RPC batching.", { rpcMethod: chunkMethod });
            if (responses.length !== chunk.length)
                throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch result count is invalid.", { rpcMethod: chunkMethod });
            const expected = new Set(chunk.map((request) => request.id));
            for (const candidate of responses) {
                if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
                    throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response item is malformed.", { rpcMethod: chunkMethod });
                const row = candidate, id = row.id;
                if (row.jsonrpc !== "2.0" || typeof id !== "string" || !expected.has(id) || seen.has(id)) {
                    throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response id set is invalid.", { rpcMethod: chunkMethod });
                }
                const offset = Number(id) - 1;
                if (!Number.isSafeInteger(offset) || offset < start || offset >= start + chunk.length)
                    throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response id set is invalid.", { rpcMethod: chunkMethod });
                seen.add(id);
                if (Object.hasOwn(row, "error")) {
                    const error = row.error;
                    if (typeof error === "object" && error !== null && !Array.isArray(error) &&
                        [-32600, -32601].includes(error.code)) {
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
        if (seen.size !== pending.length)
            throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch response id set is invalid.", { rpcMethod });
        // Validate every caller's decoder against the raw response before mutating the cache.
        for (let index = 0; index < pending.length; index += 1) {
            const [, entry] = pending[index], rawValue = cloneRpcValue(raw[index]);
            for (const reference of entry.decoders) {
                rawResults[reference.index] = cloneRpcValue(rawValue);
                decodedResults[reference.index] = decodeRpcValue(reference.decoder, rawValue);
            }
        }
        // Commit cache only after every response item and decoder succeeds.
        for (let index = 0; index < pending.length; index += 1) {
            const [, entry] = pending[index], value = raw[index];
            const policy = entry.item.cachePolicy ?? "auto";
            if (policy === "immutable" || policy === "snapshot" || policy === "auto" && isSessionCacheable(entry.item.method, entry.item.params, value)) {
                this.cache.set(entry.cacheKey, cloneRpcValue(value));
            }
        }
        return { raw: rawResults, decoded: decodedResults };
    }
    decodeBatch(items, raw) {
        const decoded = new Array(items.length);
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            if (typeof item.decoder !== "function")
                throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC batch item is malformed.");
            decoded[index] = decodeRpcValue(item.decoder, cloneRpcValue(raw[index]));
        }
        return decoded;
    }
    key(origin, chainId, method, params) {
        const endpoint = rpcEndpointIdentity(origin);
        this.endpoints.add(endpoint);
        return hashObject({ origin: endpoint, chainId, method, params });
    }
    reserveLogical(method) {
        this.assertDeadline(method);
        if (this.logicalItems >= this.maxLogicalItems)
            this.budgetError(method, "maxLogicalItems");
        this.logicalItems += 1;
        this.methods.set(method, (this.methods.get(method) ?? 0) + 1);
    }
    reserveRequest(method) {
        this.assertDeadline(method);
        if (this.httpRequests >= this.maxHttpRequests)
            this.budgetError(method, "maxHttpRequests");
        this.httpRequests += 1;
    }
    async retry(origin, method, oneAttempt) {
        for (let attempt = 0;; attempt += 1) {
            try {
                return await this.schedule(origin, () => {
                    this.assertBeforeAttempt(method);
                    this.httpAttempts += 1;
                    return oneAttempt();
                });
            }
            catch (error) {
                const http = error instanceof RpcHttpFailure ? error : undefined, transport = approvedTransportReason(error);
                const retryable = http !== undefined ? http.status === 408 || http.status >= 500 && http.status <= 599 : transport !== undefined;
                if (!retryable || attempt + 1 >= MAX_READ_ATTEMPTS) {
                    if (http !== undefined) {
                        if (http.status === 429)
                            throw this.rateLimit(method, http.retryAfterMs);
                        if (method === "batch" && [400, 404, 405, 415].includes(http.status)) {
                            throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "Bridge RPC endpoint does not support JSON-RPC batching.", { ...telemetryDetails(this.telemetry(), method, "batch_unsupported"), httpStatus: http.status.toString(), attempts: (attempt + 1).toString() });
                        }
                        throw this.httpError(http, attempt + 1);
                    }
                    if (transport !== undefined)
                        throw this.transportError(method, transport, attempt + 1);
                    if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS")
                        throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
                    throw error;
                }
                const delay = Math.max(RPC_RETRY_DELAY_MS, http?.retryAfterMs ?? 0);
                this.assertBeforeWait(method, delay);
                await this.wait(delay);
            }
        }
    }
    schedule(originInput, task) {
        const origin = rpcOriginIdentity(originInput);
        this.assertBeforeQueue("rpc");
        return new Promise((resolve, reject) => { this.queue.push({ origin, task, resolve, reject }); this.pump(); });
    }
    pump() {
        while (this.active < 2) {
            const index = this.queue.findIndex((entry) => !(this.origins.get(entry.origin)?.active ?? false));
            if (index < 0)
                return;
            const entry = this.queue.splice(index, 1)[0], state = this.origins.get(entry.origin) ?? { active: false, lastStart: Number.NEGATIVE_INFINITY };
            state.active = true;
            this.origins.set(entry.origin, state);
            this.active += 1;
            void this.runScheduled(entry, state);
        }
    }
    async runScheduled(entry, state) {
        try {
            const before = this.now(), delay = Math.max(0, state.lastStart + RPC_ORIGIN_GAP_MS - before);
            this.assertBeforeWait("rpc", delay);
            if (delay > 0)
                await this.wait(delay);
            const now = this.now();
            this.assertDeadline("rpc");
            state.lastStart = Math.max(now, state.lastStart + RPC_ORIGIN_GAP_MS);
            entry.resolve(await entry.task());
        }
        catch (error) {
            entry.reject(error);
        }
        finally {
            state.active = false;
            this.active -= 1;
            this.pump();
        }
    }
    assertBeforeAttempt(method) {
        this.assertDeadline(method);
        if (this.httpAttempts >= this.maxHttpAttempts)
            this.budgetError(method, "maxHttpAttempts");
    }
    assertBeforeQueue(method) { this.assertDeadline(method); }
    assertBeforeWait(method, milliseconds) {
        this.assertDeadline(method);
        if (milliseconds > Math.max(0, this.deadline - this.now()))
            this.budgetError(method, "deadline");
    }
    assertDeadline(method) { if (this.now() >= this.deadline)
        this.budgetError(method, "deadline"); }
    budgetError(method, reason) {
        throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "Bridge RPC command budget exhausted.", telemetryDetails(this.telemetry(), method, reason));
    }
    rateLimit(method, retryAfterMs) {
        this.retryAfterMs = retryAfterMs;
        return new ApnError("APN_RPC_RATE_LIMITED", "Bridge RPC provider requested a cooldown.", telemetryDetails(this.telemetry(), method, "http_429"));
    }
    httpError(error, attempts) {
        return new ApnError("APN_RPC_PROTOCOL", "Bridge validation failed: bridge_RPC_HTTP_status.", { ...telemetryDetails(this.telemetry(), error.method, "http_status"), httpStatus: error.status.toString(), attempts: attempts.toString() });
    }
    transportError(method, reason, attempts) {
        return new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { ...telemetryDetails(this.telemetry(), method, reason), rpcMethod: method, attempts: attempts.toString(), transportReason: reason });
    }
}
export function rpcOriginIdentity(origin) { try {
    return new URL(origin).origin;
}
catch {
    return "invalid-origin";
} }
export function rpcEndpointIdentity(endpoint) {
    try {
        const parsed = new URL(endpoint);
        return hashObject({ protocol: parsed.protocol, hostname: parsed.hostname.toLowerCase(), port: parsed.port, pathname: parsed.pathname });
    }
    catch {
        return "invalid-endpoint";
    }
}
export function approvedTransportReason(error) {
    if (!(error instanceof ApnError) || error.code !== "APN_RPC_AMBIGUOUS")
        return undefined;
    const reason = error.details?.transportReason;
    return typeof reason === "string" && TRANSIENT_TRANSPORT_REASONS.has(reason) ? reason : undefined;
}
export function parseRetryAfter(headers, now) {
    if (headers === undefined)
        return undefined;
    const raw = Object.entries(headers).find(([key]) => key.toLowerCase() === "retry-after")?.[1];
    const value = (typeof raw === "string" ? raw : raw?.[0])?.trim();
    if (value === undefined || value === "" || value.startsWith("-"))
        return undefined;
    if (/^[0-9]+$/u.test(value))
        return Math.min(30_000, Number(value) * 1_000);
    if (!value.includes(",") || !/GMT$/iu.test(value))
        return undefined;
    const at = Date.parse(value), delay = at - now;
    if (!Number.isFinite(at) || delay < 0)
        return undefined;
    return Math.min(30_000, delay);
}
export function telemetryDetails(telemetry, method, reason) {
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
function positiveBound(value, name) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new ApnError("APN_RPC_CONFIG", `RPC ${name} bound is invalid.`);
    return value;
}
function identity(value) { return value; }
function decodeRpcValue(decoder, raw) {
    try {
        return decoder(raw);
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        throw new ApnError("APN_RPC_PROTOCOL", "Bridge RPC item decoding failed.");
    }
}
function cloneRpcValue(value) { if (value === undefined)
    return undefined; try {
    return structuredClone(value);
}
catch {
    return value;
} }
function isNumericBlockTag(value) { return typeof value === "string" && /^0x[0-9a-f]+$/u.test(value); }
function isBlockHashTag(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.blockHash === "string" &&
        /^0x[0-9a-f]{64}$/iu.test(value.blockHash);
}
function isSessionCacheable(method, params, value) {
    if (method === "eth_chainId")
        return true;
    if (!IMMUTABLE_READ_METHODS.has(method))
        return false;
    if (method === "eth_getBlockByNumber")
        return isNumericBlockTag(params[0]) || isBlockHashTag(params[0]) || params[0] === "safe" || params[0] === "finalized";
    if (method === "eth_getLogs") {
        const query = params[0];
        if (typeof query !== "object" || query === null || Array.isArray(query))
            return false;
        const record = query;
        if (isBlockHashTag(record))
            return true;
        return (isNumericBlockTag(record.fromBlock) || isBlockHashTag(record.fromBlock)) && (isNumericBlockTag(record.toBlock) || isBlockHashTag(record.toBlock));
    }
    const tag = params.at(-1);
    if (isNumericBlockTag(tag) || isBlockHashTag(tag))
        return true;
    if ((method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") && value !== null && typeof value === "object" &&
        typeof value.blockHash === "string" && /^0x[0-9a-f]{64}$/iu.test(value.blockHash))
        return true;
    return false;
}
async function submitDirect(method, params, oneAttempt) {
    try {
        return await oneAttempt(method, params);
    }
    catch (error) {
        if (error instanceof RpcHttpFailure) {
            if (error.status === 429)
                throw new ApnError("APN_RPC_RATE_LIMITED", "Bridge RPC provider requested a cooldown.", {
                    rpcMethod: method, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs.toString() }), attempts: "1"
                });
            throw rpcHttpFailure("bridge_RPC_HTTP_status", method, error.status, 1);
        }
        const transport = approvedTransportReason(error);
        if (transport !== undefined)
            throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method, attempts: "1", transportReason: transport });
        if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS")
            throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
        throw error;
    }
}
function rpcHttpFailure(reason, method, status, attempts) {
    return new ApnError("APN_RPC_PROTOCOL", `Bridge validation failed: ${reason}.`, { reason, rpcMethod: method, httpStatus: status.toString(), attempts: attempts.toString() });
}
//# sourceMappingURL=rpc-session.js.map