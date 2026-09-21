import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
export const MAX_READ_ATTEMPTS = 2;
export const RPC_RETRY_DELAY_MS = 2_000;
const RPC_DEFAULT_UNIQUE_CALLS = 64;
const RPC_DEFAULT_HTTP_ATTEMPTS = 72;
const RPC_DEFAULT_DEADLINE_MS = 180_000;
const RPC_ORIGIN_GAP_MS = 750;
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
    maxUniqueCalls;
    maxHttpAttempts;
    now;
    wait;
    deadline;
    cache = new Map();
    inflight = new Map();
    origins = new Map();
    queue = [];
    active = 0;
    uniqueCalls = 0;
    totalAttempts = 0;
    dedupHits = 0;
    singleflightHits = 0;
    retryAfterMs;
    methods = new Map();
    constructor(options = {}) {
        this.maxUniqueCalls = positiveBound(options.maxUniqueCalls ?? RPC_DEFAULT_UNIQUE_CALLS, "maxUniqueCalls");
        this.maxHttpAttempts = positiveBound(options.maxHttpAttempts ?? RPC_DEFAULT_HTTP_ATTEMPTS, "maxHttpAttempts");
        const deadlineMs = positiveBound(options.deadlineMs ?? RPC_DEFAULT_DEADLINE_MS, "deadlineMs");
        this.now = options.now ?? (() => Date.now());
        this.wait = options.wait ?? (async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds)));
        const started = this.now();
        if (!Number.isFinite(started))
            throw new ApnError("APN_RPC_CONFIG", "RPC command clock is invalid.");
        this.deadline = started + deadlineMs;
    }
    telemetry() {
        return { uniqueCalls: this.uniqueCalls, totalAttempts: this.totalAttempts, dedupHits: this.dedupHits,
            singleflightHits: this.singleflightHits, perMethod: Object.fromEntries(this.methods),
            remainingUniqueCalls: Math.max(0, this.maxUniqueCalls - this.uniqueCalls),
            remainingHttpAttempts: Math.max(0, this.maxHttpAttempts - this.totalAttempts), deadline: this.deadline,
            ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }) };
    }
    /** Current command clock, used by transports for deterministic Retry-After date parsing. */
    currentTime() { return this.now(); }
    wrap(origin, chainId, call, oneAttempt = call) {
        return async (method, params) => {
            if (method === "eth_sendRawTransaction")
                return await submitDirect(method, params, oneAttempt);
            return await this.read(origin, chainId, method, params, oneAttempt);
        };
    }
    async read(origin, chainId, method, params, oneAttempt) {
        const key = hashObject({ origin: rpcEndpointIdentity(origin), chainId, method, params });
        const cached = this.cache.get(key);
        if (cached !== undefined || this.cache.has(key)) {
            this.dedupHits += 1;
            return cloneRpcValue(cached);
        }
        const current = this.inflight.get(key);
        if (current !== undefined) {
            this.assertBeforeQueue(method);
            this.singleflightHits += 1;
            return cloneRpcValue(await current);
        }
        this.assertBeforeUnique(method);
        this.uniqueCalls += 1;
        this.methods.set(method, (this.methods.get(method) ?? 0) + 1);
        const operation = this.retry(origin, chainId, method, params, oneAttempt)
            .then((value) => {
            if (isSessionCacheable(method, params, value))
                this.cache.set(key, cloneRpcValue(value));
            return value;
        }).finally(() => this.inflight.delete(key));
        this.inflight.set(key, operation);
        return cloneRpcValue(await operation);
    }
    async retry(origin, chainId, method, params, oneAttempt) {
        for (let attempt = 0;; attempt += 1) {
            try {
                return await this.schedule(origin, () => {
                    this.assertBeforeAttempt(method);
                    this.totalAttempts += 1;
                    return oneAttempt(method, params);
                });
            }
            catch (error) {
                const http = error instanceof RpcHttpFailure ? error : undefined;
                const transport = approvedTransportReason(error);
                const retryable = http !== undefined ? http.status === 408 || http.status >= 500 && http.status <= 599 : transport !== undefined;
                if (!retryable || attempt + 1 >= MAX_READ_ATTEMPTS) {
                    if (http !== undefined) {
                        if (http.status === 429)
                            throw this.rateLimit(method, http.retryAfterMs);
                        throw this.httpError(http, attempt + 1);
                    }
                    if (transport !== undefined)
                        throw this.transportError(method, transport, attempt + 1);
                    if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") {
                        throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
                    }
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
            const entry = this.queue.splice(index, 1)[0];
            const state = this.origins.get(entry.origin) ?? { active: false, lastStart: Number.NEGATIVE_INFINITY };
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
    assertBeforeUnique(method) {
        this.assertDeadline(method);
        if (this.uniqueCalls >= this.maxUniqueCalls)
            this.budgetError(method, "maxUniqueCalls");
    }
    assertBeforeAttempt(method) {
        this.assertDeadline(method);
        if (this.totalAttempts >= this.maxHttpAttempts)
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
        return new ApnError("APN_RPC_PROTOCOL", `Bridge validation failed: bridge_RPC_HTTP_status.`, { ...telemetryDetails(this.telemetry(), error.method, "http_status"), httpStatus: error.status.toString(), attempts: attempts.toString() });
    }
    transportError(method, reason, attempts) {
        return new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { ...telemetryDetails(this.telemetry(), method, reason), rpcMethod: method, attempts: attempts.toString(), transportReason: reason });
    }
}
export function rpcOriginIdentity(origin) {
    try {
        return new URL(origin).origin;
    }
    catch {
        return "invalid-origin";
    }
}
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
    return { reason, rpcMethod: method, uniqueCalls: telemetry.uniqueCalls.toString(), totalAttempts: telemetry.totalAttempts.toString(),
        dedupHits: telemetry.dedupHits.toString(), singleflightHits: telemetry.singleflightHits.toString(), perMethod: canonicalJson(telemetry.perMethod),
        remainingUniqueCalls: telemetry.remainingUniqueCalls.toString(), remainingHttpAttempts: telemetry.remainingHttpAttempts.toString(), deadline: telemetry.deadline.toString(),
        ...(telemetry.retryAfterMs === undefined ? {} : { retryAfterMs: telemetry.retryAfterMs.toString() }) };
}
function positiveBound(value, name) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new ApnError("APN_RPC_CONFIG", `RPC ${name} bound is invalid.`);
    return value;
}
function cloneRpcValue(value) {
    if (value === undefined)
        return undefined;
    try {
        return structuredClone(value);
    }
    catch {
        return value;
    }
}
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
                    rpcMethod: method, ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs.toString() }), attempts: "1",
                });
            throw rpcHttpFailure("bridge_RPC_HTTP_status", method, error.status, 1);
        }
        const transport = approvedTransportReason(error);
        if (transport !== undefined)
            throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", {
                rpcMethod: method, attempts: "1", transportReason: transport,
            });
        if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS") {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Bridge RPC transport is unavailable.", { rpcMethod: method });
        }
        throw error;
    }
}
function rpcHttpFailure(reason, method, status, attempts) {
    return new ApnError("APN_RPC_PROTOCOL", `Bridge validation failed: ${reason}.`, {
        rpcMethod: method, httpStatus: status.toString(), attempts: attempts.toString(),
    });
}
//# sourceMappingURL=rpc-session.js.map