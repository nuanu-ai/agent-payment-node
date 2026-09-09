import { request as httpsRequest } from "node:https";
import { canonicalJson, exactKeys, isPlainRecord } from "../../canonical.js";
import { parsePublicHttpsUrl, resolvePublicAddresses, sameIpAddress } from "../../network-policy.js";
import { MM_SENTINEL_SLUG, mmRegistry } from "../registry.js";
import { mmFail } from "../reasons.js";
import { encodeFunctionData, parseAbi } from "viem";
const MIMIR = "https://agentic-mimir-service.api.cx.metamask.io";
const PROXY = "https://agentic-proxy.workers.cx.metamask.io";
const MIMIR_NETWORKS = `${MIMIR}/v1/supportedNetworks`;
const ACCOUNTS_NETWORKS = `${PROXY}/proxy/prd/accounts/v2/supportedNetworks`;
const SENTINEL_NETWORKS = `${PROXY}/proxy/prd/tx-sentinel-ethereum-mainnet/networks`;
const MAX_RESPONSE = 4 * 1024 * 1024;
const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
export class HelperNetworkPolicy {
    context;
    exchange;
    fetch;
    counts = new Map();
    successes = new Set();
    notFound = false;
    expectedSubmitBody;
    lastClockMs;
    deadlineFailure;
    sessionFailure = false;
    constructor(context, exchange = new HttpsFetchExchange()) {
        this.context = context;
        this.exchange = exchange;
        this.fetch = this.handle.bind(this);
    }
    didObserveNotFound() { return this.notFound; }
    fixedFailure() {
        return this.deadlineFailure ?? (this.sessionFailure ? "mm_gasless_session_unavailable" : undefined);
    }
    setExpectedSubmitBody(value) {
        if (this.context.mode !== "submit" || this.expectedSubmitBody !== undefined)
            mmFail("mm_gasless_submit_unknown");
        this.expectedSubmitBody = structuredClone(value);
    }
    primeSubmitClock(value) {
        if (this.context.mode !== "submit" || this.lastClockMs !== undefined || !Number.isSafeInteger(value.getTime()))
            mmFail("mm_gasless_clock");
        this.lastClockMs = value.getTime();
    }
    assertQuoteInventories() {
        if (this.context.mode !== "quote" || ["mimir-networks", "accounts-networks", "sentinel-networks"].some((key) => this.counts.get(key) !== 1 || !this.successes.has(key)))
            mmFail("mm_gasless_provider_unavailable");
    }
    assertComplete() {
        const expected = this.context.mode === "quote" ? ["mimir-networks", "accounts-networks", "sentinel-networks", "rpc-decimals", "rpc-balance", "sentinel-quote"] :
            this.context.mode === "submit" ? ["submit"] : this.context.mode === "observe" ? ["observe"] : [];
        if (this.counts.size !== expected.length || expected.some((key) => this.counts.get(key) !== 1)) {
            mmFail(this.context.mode === "submit" ? "mm_gasless_submit_unknown" : "mm_gasless_provider_unavailable");
        }
        if (this.context.mode === "quote" && expected.some((key) => !this.successes.has(key)))
            mmFail("mm_gasless_provider_unavailable");
    }
    async handle(input, init) {
        const url = input instanceof Request ? input.url : String(input);
        const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method !== "GET" && method !== "POST")
            mmFail("mm_gasless_provider_unavailable");
        const body = await requestBody(input, init);
        const headers = requestHeaders(input, init);
        const key = this.classify(url, method, headers, body);
        if ((this.counts.get(key) ?? 0) !== 0)
            mmFail(this.context.mode === "submit" ? "mm_gasless_submit_unknown" : "mm_gasless_provider_unavailable");
        this.counts.set(key, 1);
        if (this.context.mode === "submit")
            this.assertSubmitDeadline();
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        const request = { url, method, headers, body, maxBytes: MAX_RESPONSE, timeoutMs: 15_000,
            ...(signal ? { signal } : {}), ...(this.context.mode === "submit" ? { beforeSend: () => this.assertSubmitDeadline() } : {}) };
        const response = await this.exchange.request(request);
        if (typeof response.body !== "string" || Buffer.byteLength(response.body) > MAX_RESPONSE)
            mmFail("mm_gasless_provider_unavailable");
        if (response.status === 401 || response.status === 403) {
            this.sessionFailure = true;
            mmFail("mm_gasless_session_unavailable");
        }
        if (this.context.mode === "observe" && response.status === 404)
            this.notFound = true;
        if (response.status >= 200 && response.status < 300) {
            validateResponse(key, response.body, body, this.context);
            this.successes.add(key);
        }
        const outputHeaders = new Headers(response.headers);
        if (!outputHeaders.has("content-type"))
            outputHeaders.set("content-type", "application/json");
        return new Response(response.body, { status: response.status, headers: outputHeaders });
    }
    assertSubmitDeadline() {
        if (this.context.mode !== "submit")
            return;
        const current = this.context.now().getTime(), deadline = Date.parse(this.context.intent.expiresAt);
        if (!Number.isSafeInteger(current) || !Number.isSafeInteger(deadline)) {
            this.deadlineFailure = "mm_gasless_clock";
            mmFail("mm_gasless_clock");
        }
        if (this.lastClockMs !== undefined && current < this.lastClockMs) {
            this.deadlineFailure = "mm_gasless_clock";
            mmFail("mm_gasless_clock");
        }
        this.lastClockMs = current;
        if (current >= deadline) {
            this.deadlineFailure = "mm_gasless_expired";
            mmFail("mm_gasless_expired");
        }
    }
    classify(url, method, headers, body) {
        if (this.context.mode === "inspect" || this.context.mode === "buildUnsigned")
            mmFail("mm_gasless_provider_unavailable");
        if (this.context.mode === "quote")
            return classifyQuote(this.context, url, method, headers, body);
        if (this.context.mode !== "submit" && this.context.mode !== "observe")
            return mmFail("mm_gasless_provider_unavailable");
        exactProviderUrl(url);
        const collection = `${MIMIR}/v1/projects/${encodeURIComponent(this.context.projectId)}/transaction-requests`;
        requireBearer(headers, this.context.token);
        if (this.context.mode === "submit" && url === collection && method === "POST" && body !== null) {
            validateSubmitBody(body, this.context.intent, this.expectedSubmitBody);
            return "submit";
        }
        if (this.context.mode === "observe" && url === `${collection}/${this.context.intent.requestId}` && method === "GET" && body === null)
            return "observe";
        return mmFail(this.context.mode === "submit" ? "mm_gasless_submit_unknown" : "mm_gasless_provider_unavailable");
    }
}
function classifyQuote(context, rawUrl, method, headers, body) {
    if (rawUrl === context.input.rpcUrl && method === "POST" && body !== null) {
        parsePublicHttpsUrl(rawUrl, "APN_RPC_CONFIG", "MetaMask quote RPC", 2048);
        requireNoBearer(headers);
        return validateRpcBody(body, context);
    }
    const url = exactProviderUrl(rawUrl);
    if (url.href === MIMIR_NETWORKS && method === "GET" && body === null) {
        requireNoBearer(headers);
        return "mimir-networks";
    }
    if (url.href === ACCOUNTS_NETWORKS && method === "GET" && body === null) {
        requireNoBearer(headers);
        return "accounts-networks";
    }
    if (url.href === SENTINEL_NETWORKS && method === "GET" && body === null) {
        requireBearer(headers, context.authToken);
        return "sentinel-networks";
    }
    const sentinel = `${PROXY}/proxy/prd/tx-sentinel-${MM_SENTINEL_SLUG[context.input.chainId]}`;
    if (url.href === sentinel && method === "POST" && body !== null) {
        requireBearer(headers, context.authToken);
        validateSentinelBody(body, context);
        return "sentinel-quote";
    }
    return mmFail("mm_gasless_provider_unavailable");
}
function exactProviderUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return mmFail("mm_gasless_provider_unavailable");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port)
        mmFail("mm_gasless_provider_unavailable");
    return url;
}
function requestHeaders(input, init) {
    const result = {};
    if (input instanceof Request)
        input.headers.forEach((value, key) => { result[key.toLowerCase()] = value; });
    if (init?.headers)
        new Headers(init.headers).forEach((value, key) => { result[key.toLowerCase()] = value; });
    const allowed = new Set(["accept", "content-type", "authorization"]);
    if (Object.keys(result).some((key) => !allowed.has(key)))
        mmFail("mm_gasless_provider_unavailable");
    return result;
}
async function requestBody(input, init) {
    if (init?.body !== undefined && init.body !== null) {
        if (typeof init.body !== "string" || Buffer.byteLength(init.body) > 256 * 1024)
            mmFail("mm_gasless_provider_unavailable");
        return init.body;
    }
    if (input instanceof Request && input.body !== null) {
        const value = await input.clone().text();
        if (Buffer.byteLength(value) > 256 * 1024)
            mmFail("mm_gasless_provider_unavailable");
        return value;
    }
    return null;
}
function requireBearer(headers, token) {
    if (headers.authorization !== `Bearer ${token}`)
        mmFail("mm_gasless_session_unavailable");
}
function requireNoBearer(headers) {
    if (headers.authorization !== undefined)
        mmFail("mm_gasless_provider_unavailable");
}
function parseBody(body) {
    try {
        const value = JSON.parse(body);
        if (isPlainRecord(value))
            return value;
    }
    catch { /* fixed below */ }
    return mmFail("mm_gasless_provider_unavailable");
}
function validateRpcBody(body, context) {
    const value = parseBody(body);
    if (!exactKeys(value, ["jsonrpc", "id", "method", "params"]) || value.jsonrpc !== "2.0" || value.method !== "eth_call" ||
        !Array.isArray(value.params) || value.params.length !== 2 || !isPlainRecord(value.params[0]) ||
        !exactKeys(value.params[0], ["to", "data"]) || String(value.params[0].to).toLowerCase() !== context.input.token ||
        !["latest", "pending"].includes(String(value.params[1])))
        mmFail("mm_gasless_provider_unavailable");
    const data = value.params[0].data;
    if (data === "0x313ce567")
        return "rpc-decimals";
    if (typeof data === "string" && /^0x70a08231[0-9a-f]{64}$/u.test(data) && data.endsWith(context.owner.slice(2)))
        return "rpc-balance";
    return mmFail("mm_gasless_provider_unavailable");
}
function validateSentinelBody(body, context) {
    const value = parseBody(body);
    if (!exactKeys(value, ["jsonrpc", "method", "id", "params"]) || value.jsonrpc !== "2.0" || value.method !== "infura_simulateTransactions" ||
        value.id !== 10 || !Array.isArray(value.params) || value.params.length !== 1 || !isPlainRecord(value.params[0]) ||
        !exactKeys(value.params[0], ["transactions", "suggestFees"]) || !Array.isArray(value.params[0].transactions) ||
        value.params[0].transactions.length !== 1 || !isPlainRecord(value.params[0].suggestFees) ||
        !exactKeys(value.params[0].suggestFees, ["withTransfer", "withFeeTransfer", "with7702"]) || value.params[0].suggestFees.withTransfer !== true ||
        value.params[0].suggestFees.withFeeTransfer !== true || value.params[0].suggestFees.with7702 !== true)
        mmFail("mm_gasless_provider_unavailable");
    const tx = value.params[0].transactions[0];
    const expectedData = encodeFunctionData({ abi: transferAbi, functionName: "transfer",
        args: [context.input.recipient, BigInt(context.input.netAtomic)] });
    if (!isPlainRecord(tx) || !exactKeys(tx, ["from", "to", "data", "value", "authorizationList"]) ||
        String(tx.from).toLowerCase() !== context.owner || String(tx.to).toLowerCase() !== context.input.token || tx.data !== expectedData ||
        tx.value !== "0x0" || !Array.isArray(tx.authorizationList) || tx.authorizationList.length !== 1 ||
        !isPlainRecord(tx.authorizationList[0]) || !exactKeys(tx.authorizationList[0], ["address", "from"]) ||
        String(tx.authorizationList[0].address).toLowerCase() !== mmRegistry(context.input.chainId).row.protocol.delegate.address ||
        String(tx.authorizationList[0].from).toLowerCase() !== context.owner) {
        mmFail("mm_gasless_provider_unavailable");
    }
}
function validateSubmitBody(body, intent, expected) {
    const value = parseBody(body);
    if (!isPlainRecord(expected) || canonicalJson(value) !== canonicalJson(expected))
        mmFail("mm_gasless_submit_unknown");
    if (!exactKeys(value, ["requestId", "method", "encoding", "tx", "executions", "delegation"]) || value.requestId !== intent.requestId ||
        value.method !== "eth_sendRelayTransaction" || value.encoding !== "redeemDelegations" || !isPlainRecord(value.tx) ||
        !exactKeys(value.tx, ["from", "chainId"]) || String(value.tx.from).toLowerCase() !== intent.binding.address ||
        value.tx.chainId !== intent.request.chainId || !Array.isArray(value.executions) || value.executions.length !== 2 ||
        !isPlainRecord(value.delegation) || Object.hasOwn(value.delegation, "signature") ||
        !exactKeys(value.delegation, ["delegator", "delegate", "authority", "salt", "caveats"]) || !Array.isArray(value.delegation.caveats) ||
        value.delegation.caveats.length !== 2)
        mmFail("mm_gasless_submit_unknown");
    for (let i = 0; i < 2; i++) {
        const wire = value.executions[i], original = intent.quote.executions[i];
        if (!isPlainRecord(wire) || !exactKeys(wire, ["target", "callData"]) || String(wire.target).toLowerCase() !== original.target ||
            (wire.callData ?? "0x") !== original.callData || BigInt(String(wire.value ?? "0")) !== BigInt(original.value))
            mmFail("mm_gasless_submit_unknown");
    }
    const d = value.delegation;
    if (String(d.delegator).toLowerCase() !== intent.unsignedDelegation.delegator || String(d.delegate).toLowerCase() !== intent.unsignedDelegation.delegate ||
        d.authority !== intent.unsignedDelegation.authority || BigInt(String(d.salt)) !== BigInt(intent.unsignedDelegation.salt))
        mmFail("mm_gasless_submit_unknown");
    const caveats = d.caveats;
    for (let i = 0; i < 2; i++) {
        const caveat = caveats[i], original = intent.unsignedDelegation.caveats[i];
        if (!isPlainRecord(caveat) || !(exactKeys(caveat, ["enforcer", "terms"]) || exactKeys(caveat, ["enforcer", "terms", "args"])) ||
            String(caveat.enforcer).toLowerCase() !== original.enforcer || caveat.terms !== original.terms || (caveat.args ?? "0x") !== original.args) {
            mmFail("mm_gasless_submit_unknown");
        }
    }
}
function validateResponse(key, body, requestBody, context) {
    const value = parseBody(body);
    if (key === "mimir-networks") {
        if (!exactKeys(value, ["networks"]) || !Array.isArray(value.networks) || value.networks.length > 256 || value.networks.some((row) => !isPlainRecord(row) || typeof row.chainId !== "number" || typeof row.name !== "string" ||
            !["mainnet", "testnet"].includes(String(row.networkType)) || typeof row.shieldSupported !== "boolean"))
            mmFail("mm_gasless_provider_unavailable");
    }
    else if (key === "accounts-networks") {
        if (!exactKeys(value, ["fullSupport", "partialSupport"]) || !Array.isArray(value.fullSupport) || !Array.isArray(value.partialSupport) ||
            value.fullSupport.length > 512 || value.partialSupport.length > 512 || [...value.fullSupport, ...value.partialSupport].some((v) => typeof v !== "string")) {
            mmFail("mm_gasless_provider_unavailable");
        }
    }
    else if (key === "sentinel-networks") {
        if (Object.keys(value).length > 512 || Object.entries(value).some(([chain, row]) => !/^[1-9][0-9]*$/u.test(chain) ||
            !isPlainRecord(row) || !exactKeys(row, ["relayTransactions"]) || typeof row.relayTransactions !== "boolean"))
            mmFail("mm_gasless_provider_unavailable");
    }
    else if (key.startsWith("rpc-")) {
        const sent = requestBody === null ? null : parseBody(requestBody);
        if (!exactKeys(value, ["jsonrpc", "id", "result"]) || value.jsonrpc !== "2.0" || sent === null || value.id !== sent.id ||
            typeof value.result !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value.result) ||
            (key === "rpc-decimals" && BigInt(value.result) !== 6n))
            mmFail("mm_gasless_provider_unavailable");
    }
    else if (key === "sentinel-quote")
        validateSentinelResponse(value, context);
}
function validateSentinelResponse(value, context) {
    if (context.mode !== "quote" || !exactKeys(value, ["jsonrpc", "id", "result"]) || value.jsonrpc !== "2.0" || value.id !== 10 ||
        !isPlainRecord(value.result) || !Array.isArray(value.result.transactions) ||
        value.result.transactions.length < 1 || value.result.transactions.length > 8)
        mmFail("mm_gasless_provider_unavailable");
    let matching = 0;
    for (const transaction of value.result.transactions) {
        if (!isPlainRecord(transaction) || !Array.isArray(transaction.fees) || transaction.fees.length < 1 || transaction.fees.length > 8)
            mmFail("mm_gasless_provider_unavailable");
        for (const fee of transaction.fees) {
            if (!isPlainRecord(fee) || !Array.isArray(fee.tokenFees) || fee.tokenFees.length > 32)
                mmFail("mm_gasless_provider_unavailable");
            for (const entry of fee.tokenFees) {
                if (!isPlainRecord(entry) || !isPlainRecord(entry.token) || typeof entry.token.address !== "string" || typeof entry.token.symbol !== "string" ||
                    !Number.isSafeInteger(entry.token.decimals) || typeof entry.balanceNeededToken !== "string" || typeof entry.feeRecipient !== "string") {
                    mmFail("mm_gasless_provider_unavailable");
                }
                if (entry.token.address.toLowerCase() === context.input.token && entry.token.decimals === 6 && /^(?:0|[1-9][0-9]{0,77})$/u.test(entry.balanceNeededToken) &&
                    /^0x[0-9a-fA-F]{40}$/u.test(entry.feeRecipient))
                    matching += 1;
            }
        }
    }
    if (matching < 1)
        mmFail("mm_gasless_provider_unavailable");
}
export class HttpsFetchExchange {
    async request(request) {
        const url = parsePublicHttpsUrl(request.url, "APN_HTTP_CONFIG", "MetaMask service", 2048);
        const deadline = Date.now() + request.timeoutMs;
        let timer;
        try {
            const addresses = await Promise.race([resolvePublicAddresses(url, "APN_HTTP_CONFIG", "MetaMask service"),
                new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("dns timeout")), request.timeoutMs); })]);
            clearTimeout(timer);
            timer = undefined;
            const remaining = deadline - Date.now();
            if (remaining < 1)
                throw new Error("request timeout");
            return sendHttps(url, { ...request, timeoutMs: remaining }, addresses);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
function sendHttps(url, input, addresses) {
    return new Promise((resolve, reject) => {
        const selected = addresses[0];
        if (!selected) {
            reject(new Error("network"));
            return;
        }
        let done = false;
        const finish = (error, result) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            input.signal?.removeEventListener("abort", abort);
            error ? reject(error) : resolve(result);
        };
        const headers = { ...input.headers, "accept-encoding": "identity",
            ...(input.body === null ? {} : { "content-length": String(Buffer.byteLength(input.body)) }) };
        const req = httpsRequest(url, { method: input.method, headers, agent: false, family: selected.family,
            lookup: (_host, _options, callback) => callback(null, selected.address, selected.family) }, (response) => {
            const status = response.statusCode ?? 0, encoding = response.headers["content-encoding"];
            if ((status >= 300 && status < 400) || (encoding && encoding !== "identity")) {
                response.destroy();
                finish(new Error("response"));
                return;
            }
            let size = 0;
            const chunks = [];
            response.on("data", (chunk) => { size += chunk.length; if (size > input.maxBytes) {
                response.destroy();
                finish(new Error("response"));
            }
            else
                chunks.push(chunk); });
            response.on("end", () => { try {
                const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
                finish(null, { status, body });
            }
            catch {
                finish(new Error("response"));
            } });
            response.on("aborted", () => finish(new Error("response")));
            response.on("error", () => finish(new Error("response")));
        });
        req.on("socket", (socket) => socket.on("connect", () => { if (!socket.remoteAddress || !sameIpAddress(socket.remoteAddress, selected.address)) {
            req.destroy();
            finish(new Error("network"));
        } }));
        req.on("error", () => finish(new Error("network")));
        const abort = () => { req.destroy(); finish(new DOMException("Aborted", "AbortError")); };
        input.signal?.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => { req.destroy(); finish(new Error("timeout")); }, input.timeoutMs);
        try {
            input.beforeSend?.();
        }
        catch (error) {
            req.destroy();
            finish(error);
            return;
        }
        req.end(input.body ?? undefined);
    });
}
export function networkContextQuote(input, owner, authToken) {
    return { mode: "quote", input, owner, authToken };
}
export function networkContextRequest(mode, intent, projectId, token, now) { return { mode, intent, projectId, token, now }; }
export function networkContextEmpty(mode) { return { mode }; }
//# sourceMappingURL=network.js.map