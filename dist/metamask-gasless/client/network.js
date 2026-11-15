import { submitErrorCode } from "./submit-diagnostic.js";
import { captureSponsoredQuote, parseSentinelResponse, sentinelFailure, sentinelQuotedFee, validateSentinelResponse } from "./sentinel.js";
import { MM_SENTINEL_NETWORKS_ENDPOINT, MM_SERVER_WALLET_NETWORKS_ENDPOINT, mmProjectWalletsUrl } from "./provider-endpoints.js";
import { readProjectWallets } from "./project-wallets.js";
import { canonicalJson, exactKeys, isPlainRecord, sha256 } from "../../canonical.js";
import { parsePublicHttpsUrl } from "../../network-policy.js";
import { HttpsFetchExchange } from "./https-exchange.js";
import { serverTransactionBody } from "./server-transaction.js";
import { MM_SENTINEL_SLUG, mmRegistry } from "../registry.js";
import { mmFail } from "../reasons.js";
import { encodeFunctionData, parseAbi } from "viem";
const MIMIR = "https://agentic-mimir-service.api.cx.metamask.io";
const PROXY = "https://agentic-proxy.workers.cx.metamask.io";
const MIMIR_NETWORKS = MM_SERVER_WALLET_NETWORKS_ENDPOINT;
const ACCOUNTS_NETWORKS = `${PROXY}/proxy/prd/accounts/v2/supportedNetworks`;
const SENTINEL_NETWORKS = MM_SENTINEL_NETWORKS_ENDPOINT;
const MAX_RESPONSE = 4 * 1024 * 1024;
const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
export class HelperNetworkPolicy {
    context;
    exchange;
    parentAlive;
    fetch;
    counts = new Map();
    successes = new Set();
    notFound = false;
    #requestBodyHash;
    #sponsoredProof;
    #sponsoredAccepted = false;
    expectedSubmitBody;
    lastClockMs;
    deadlineFailure;
    sessionFailure = false;
    #relayListing;
    #relayFlag;
    #usdcBalance;
    #quotedFee;
    #projectWallets;
    #readFailures = new WeakMap();
    #submitPost = "not_reached";
    #submitStatus = null;
    #submitCheck = "none";
    #submitError = null;
    /** What the submit's one POST did, as closed facts (submit-diagnostic.ts); `check` is "none" until a policy check refused. */
    submitFacts() {
        return { post: this.#submitPost, httpStatus: this.#submitStatus, check: this.#submitCheck, providerError: this.#submitError };
    }
    submitRefused(check) { if (this.sends() && this.#submitCheck === "none")
        this.#submitCheck = check; }
    /** The two modes whose one POST may create a provider request: the gasless relay submit and a server transaction. */
    sends() { return this.context.mode === "submit" || this.context.mode === "submitTransaction"; }
    /** Closed facts of the two validated relay inventories for the quoted chain, once both were read. */
    relaySupportFacts() {
        return this.#relayListing === undefined || this.#relayFlag === undefined ? undefined
            : { relayServerWalletNetwork: this.#relayListing, relaySentinelFlag: this.#relayFlag };
    }
    /**
     * APN's own proof that the server wallet's USDC does not cover the quote: the validated `balanceOf` read is below the
     * net amount plus the validated Sentinel fee, raised as the pinned SDK raises it before funding (5% on Ethereum,
     * vendor chunk-6XX5MONG.mjs `quoteGaslessTransfer`). Without both reads there is no proof and no fact.
     */
    usdcShortfall() {
        if (this.context.mode !== "quote" || this.#usdcBalance === undefined || this.#quotedFee === undefined)
            return undefined;
        const fee = this.context.input.chainId === 1 ? this.#quotedFee * 105n / 100n : this.#quotedFee;
        const required = BigInt(this.context.input.netAtomic) + fee;
        return this.#usdcBalance < required ? { usdcCurrentAtomic: this.#usdcBalance.toString(), usdcRequiredAtomic: required.toString() } : undefined;
    }
    /** The EVM wallet count of a validated 200 project-wallet list that does not name the bound wallet; never an address. */
    projectWalletFacts() {
        return this.#projectWallets === undefined || this.#projectWallets.listed ? undefined : { projectWalletCount: this.#projectWallets.evmCount };
    }
    /** Transient fixed metadata, never response content or permission. */
    readFailureContext(error) {
        return error !== null && typeof error === "object" ? this.#readFailures.get(error) ?? { network: "none", httpStatus: null, validationFailed: false }
            : { network: "none", httpStatus: null, validationFailed: false };
    }
    /**
     * `parentAlive`: whether the APN command that spawned this helper still runs. The helper process always passes it
     * (helper-entry.ts); an in-process run has no parent process to watch and passes none.
     */
    constructor(context, exchange = new HttpsFetchExchange(), parentAlive) {
        this.context = context;
        this.exchange = exchange;
        this.parentAlive = parentAlive;
        this.fetch = this.handle.bind(this);
    }
    /** Only the exact failed original quote exchange may supply this private one-use capture. */
    takeSponsoredQuote(error) {
        const failure = error !== null && typeof error === "object" ? this.#readFailures.get(error) : undefined;
        if (failure?.validationPredicate !== "sentinel_token_fees" || failure.tokenFeesShape !== "missing" ||
            this.context.mode !== "quote" || this.#sponsoredAccepted || this.#sponsoredProof === undefined || this.counts.size !== 6 ||
            ["project-wallets", "mimir-networks", "accounts-networks", "sentinel-networks", "rpc-decimals"].some(key => this.counts.get(key) !== 1 || !this.successes.has(key)) ||
            this.counts.get("sentinel-quote") !== 1)
            return undefined;
        const quote = this.#sponsoredProof;
        this.#sponsoredProof = undefined;
        this.#sponsoredAccepted = true;
        return quote;
    }
    didObserveNotFound() { return this.notFound; }
    /** The SHA-256 of the 2xx answer bytes of the server request read or transaction POST, once it came; never the answer itself. */
    requestBodyHash() { return this.#requestBodyHash; }
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
        const expected = this.context.mode === "quote" ? ["project-wallets", "mimir-networks", "accounts-networks", "sentinel-networks",
            "rpc-decimals", ...(this.#sponsoredAccepted ? [] : ["rpc-balance"]), "sentinel-quote"] :
            this.context.mode === "submit" ? ["submit"] : this.context.mode === "observe" ? ["observe"] :
                this.context.mode === "readRequest" ? ["read-request"] : this.context.mode === "submitTransaction" ? ["submit-transaction"] : [];
        const walletListed = this.context.mode !== "quote" || this.#projectWallets?.listed === true;
        if (this.counts.size !== expected.length || expected.some((key) => this.counts.get(key) !== 1) || !walletListed) {
            this.submitRefused("incomplete");
            mmFail(this.sends() ? "mm_gasless_submit_unknown" : "mm_gasless_provider_unavailable");
        }
        if (this.context.mode === "quote" && expected.some((key) => !this.successes.has(key) && !(key === "sentinel-quote" && this.#sponsoredAccepted)))
            mmFail("mm_gasless_provider_unavailable");
    }
    async handle(input, init) {
        let readNetwork = "none", readStatus = null, validationFailed = false;
        try {
            const url = input instanceof Request ? input.url : String(input);
            const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
            if (method !== "GET" && method !== "POST")
                mmFail("mm_gasless_provider_unavailable");
            const body = await requestBody(input, init);
            const headers = requestHeaders(input, init);
            const key = this.classify(url, method, headers, body);
            if (this.context.mode === "quote") {
                readNetwork = ["project-wallets", "mimir-networks", "accounts-networks", "sentinel-networks", "rpc-decimals", "rpc-balance",
                    "sentinel-quote"].includes(key) ? key : "none";
                readStatus = null;
            }
            if ((this.counts.get(key) ?? 0) !== 0) {
                this.submitRefused("duplicate_request");
                mmFail(this.sends() ? "mm_gasless_submit_unknown" : "mm_gasless_provider_unavailable");
            }
            this.counts.set(key, 1);
            const left = this.sends() ? this.assertSubmitDeadline() : undefined;
            const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
            // From the last deadline check on, the POST may reach the provider: it counts as sent even without an answer. The
            // transport checks it once more when TLS is up, right before the bytes go, and a send's exchange ends at its deadline
            // at the latest (its timeout is the time left), so no request of it is written past the deadline.
            const request = { url, method, headers, body, maxBytes: MAX_RESPONSE,
                timeoutMs: left === undefined ? 15_000 : Math.min(15_000, left),
                ...(signal ? { signal } : {}), ...(this.sends() ? { beforeSend: () => {
                        // An orphan never writes a send: its command is gone, and with it the operation lock and the deadline's owner.
                        if (this.parentAlive !== undefined && !this.parentAlive()) {
                            this.submitRefused("parent_exited");
                            mmFail("mm_gasless_submit_unknown");
                        }
                        this.assertSubmitDeadline();
                        if (key === "submit" || key === "submit-transaction")
                            this.#submitPost = "sent";
                    } } : {}) };
            const response = await this.exchange.request(request);
            if (key === "submit" || key === "submit-transaction") {
                this.#submitStatus = Number.isSafeInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
                if (this.#submitStatus !== null && this.#submitStatus >= 300 && typeof response.body === "string" && Buffer.byteLength(response.body) <= MAX_RESPONSE) {
                    this.#submitError = submitErrorCode(response.body);
                }
            }
            if (this.context.mode === "quote")
                readStatus = Number.isSafeInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
            if (typeof response.body !== "string" || Buffer.byteLength(response.body) > MAX_RESPONSE)
                mmFail("mm_gasless_provider_unavailable");
            if (response.status === 401 || response.status === 403) {
                this.sessionFailure = true;
                this.submitRefused("session");
                mmFail("mm_gasless_session_unavailable");
            }
            // The project's wallet list answers 200, or 404 for a project with none; any other status is refused with it recorded.
            if (key === "project-wallets" && response.status !== 200 && response.status !== 404)
                mmFail("mm_gasless_provider_unavailable");
            if ((this.context.mode === "observe" || this.context.mode === "readRequest") && response.status === 404)
                this.notFound = true;
            if ((key === "read-request" || key === "submit-transaction") && response.status >= 200 && response.status < 300)
                this.#requestBodyHash = sha256(response.body);
            if (response.status >= 200 && response.status < 300) {
                try {
                    if (key === "sentinel-quote" && response.status === 200 && this.context.mode === "quote" && body !== null)
                        this.#sponsoredProof = captureSponsoredQuote(response.body, body, this.context);
                    if (key === "project-wallets" && this.context.mode === "quote")
                        this.#projectWallets = readProjectWallets(response.body, this.context.owner);
                    else
                        validateResponse(key, response.body, body, this.context);
                    if (this.context.mode === "quote") {
                        this.recordRelayFacts(key, response.body, this.context.input.chainId);
                        this.recordUsdcFacts(key, response.body);
                    }
                }
                catch (error) {
                    validationFailed = true;
                    this.submitRefused("response_body");
                    throw error;
                }
                this.successes.add(key);
            }
            const outputHeaders = new Headers(response.headers);
            if (!outputHeaders.has("content-type"))
                outputHeaders.set("content-type", "application/json");
            return new Response(response.body, { status: response.status, headers: outputHeaders });
        }
        catch (error) {
            if (this.context.mode === "quote" && error !== null && typeof error === "object")
                this.#readFailures.set(error, { network: readNetwork, httpStatus: readStatus, validationFailed,
                    ...(validationFailed && readNetwork === "sentinel-quote" ? sentinelFailure(error) : {}) });
            throw error;
        }
    }
    /** Both bodies already passed `validateResponse`; only the quoted chain's row is read, as the SDK reads it. */
    recordRelayFacts(key, body, chainId) {
        if (key === "mimir-networks")
            this.#relayListing = parseBody(body).networks
                .some(row => row.chainId === chainId) ? "listed" : "unlisted";
        if (key === "sentinel-networks") {
            const value = parseBody(body), row = Object.hasOwn(value, String(chainId)) ? value[String(chainId)] : undefined;
            this.#relayFlag = row === undefined ? "absent" : row.relayTransactions === true ? "enabled" : "disabled";
        }
    }
    /** Both bodies already passed `validateResponse`; only the owner's balance word and the matching fee entry are read. */
    recordUsdcFacts(key, body) {
        if (this.context.mode !== "quote")
            return;
        if (key === "rpc-balance")
            this.#usdcBalance = BigInt(parseBody(body).result);
        if (key === "sentinel-quote")
            this.#quotedFee = sentinelQuotedFee(parseBody(body), this.context.input.token);
    }
    /**
     * The send's own deadline (a gasless intent's, a server transaction's), checked at the request and right before its bytes
     * go. Returns the milliseconds left to it, or `undefined` in a mode that sends nothing.
     */
    assertSubmitDeadline() {
        // Separate branches: the `"submit" | "observe"` member is not removed by a ternary or a negated mode check.
        const c = this.context;
        let expiresAt;
        if (c.mode === "submitTransaction")
            expiresAt = c.input.expiresAt;
        else if (c.mode === "submit")
            expiresAt = c.intent.expiresAt;
        else
            return undefined;
        const current = c.now().getTime(), deadline = Date.parse(expiresAt);
        if (!Number.isSafeInteger(current) || !Number.isSafeInteger(deadline)) {
            this.deadlineFailure = "mm_gasless_clock";
            this.submitRefused("clock");
            mmFail("mm_gasless_clock");
        }
        if (this.lastClockMs !== undefined && current < this.lastClockMs) {
            this.deadlineFailure = "mm_gasless_clock";
            this.submitRefused("clock");
            mmFail("mm_gasless_clock");
        }
        this.lastClockMs = current;
        if (current >= deadline) {
            this.deadlineFailure = "mm_gasless_expired";
            this.submitRefused("deadline");
            mmFail("mm_gasless_expired");
        }
        return deadline - current;
    }
    classify(url, method, headers, body) {
        if (this.context.mode === "inspect" || this.context.mode === "buildUnsigned")
            mmFail("mm_gasless_provider_unavailable");
        if (this.context.mode === "quote")
            return classifyQuote(this.context, url, method, headers, body);
        if (this.context.mode === "readRequest") {
            // One GET of this request's own status in the session's project; the query's UUID keeps the path exact.
            exactProviderUrl(url);
            requireBearer(headers, this.context.token);
            const own = `${MIMIR}/v1/projects/${encodeURIComponent(this.context.projectId)}/transaction-requests/${this.context.query.requestId}`;
            if (url === own && method === "GET" && body === null)
                return "read-request";
            return mmFail("mm_gasless_provider_unavailable");
        }
        if (this.context.mode === "submitTransaction")
            return this.classifyServerTransaction(this.context, url, method, headers, body);
        if (this.context.mode !== "submit" && this.context.mode !== "observe")
            return mmFail("mm_gasless_provider_unavailable");
        exactProviderUrl(url);
        const collection = `${MIMIR}/v1/projects/${encodeURIComponent(this.context.projectId)}/transaction-requests`;
        requireBearer(headers, this.context.token);
        if (this.context.mode === "submit" && url === collection && method === "POST" && body !== null) {
            try {
                validateSubmitBody(body, this.context.intent, this.expectedSubmitBody);
            }
            // A POST that may already have left is never downgraded to refused.
            catch (error) {
                if (this.#submitPost !== "sent")
                    this.#submitPost = "refused";
                this.submitRefused("body_mismatch");
                throw error;
            }
            return "submit";
        }
        if (this.context.mode === "observe" && url === `${collection}/${this.context.intent.requestId}` && method === "GET" && body === null)
            return "observe";
        this.submitRefused("unexpected_request");
        return mmFail(this.context.mode === "submit" ? "mm_gasless_submit_unknown" : "mm_gasless_provider_unavailable");
    }
    /**
     * One POST to the session project's transaction-request collection, with the session's own bearer token and exactly
     * the bytes `serverTransactionBody` fixes for the input (request id, chain, tx and intent); any other request,
     * body or second request is refused before it can leave.
     */
    classifyServerTransaction(context, url, method, headers, body) {
        exactProviderUrl(url);
        requireBearer(headers, context.token);
        if (url === `${MIMIR}/v1/projects/${encodeURIComponent(context.projectId)}/transaction-requests` && method === "POST" && body !== null) {
            if (body === serverTransactionBody(context.input))
                return "submit-transaction";
            // A POST that may already have left is never downgraded to refused.
            if (this.#submitPost !== "sent")
                this.#submitPost = "refused";
            this.submitRefused("body_mismatch");
            return mmFail("mm_gasless_submit_unknown");
        }
        this.submitRefused("unexpected_request");
        return mmFail("mm_gasless_submit_unknown");
    }
}
function classifyQuote(context, rawUrl, method, headers, body) {
    // Preserve the existing validated exact match, including a purpose-bound configured RPC query.
    const rpcEndpoint = quoteRpcEndpoint(context.input.rpcUrl);
    if ((rawUrl === context.input.rpcUrl || (rpcEndpoint !== null && quoteRpcEndpoint(rawUrl) === rpcEndpoint)) &&
        method === "POST" && body !== null) {
        parsePublicHttpsUrl(rawUrl, "APN_RPC_CONFIG", "MetaMask quote RPC", 2048);
        requireNoBearer(headers);
        return validateRpcBody(body, context);
    }
    const url = exactProviderUrl(rawUrl);
    if (rawUrl === mmProjectWalletsUrl(context.projectId) && method === "GET" && body === null) {
        requireBearer(headers, context.authToken);
        return "project-wallets";
    }
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
/** The SDK serializes RPC targets through URL.href, adding a root slash and removing the default HTTPS port. */
function quoteRpcEndpoint(value) {
    // Do not let WHATWG parsing erase raw control/whitespace or reinterpret backslashes.
    if (/[\\\u0000-\u0020\u007f]/u.test(value))
        return null;
    let url;
    try {
        url = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "MetaMask quote RPC", 2048);
    }
    catch {
        return null;
    }
    // Preserve the bound path rather than admitting dot-segment or backslash path aliases.
    const spelling = /^https:\/\/([^/?#]+)(\/[^?#]*)?$/iu.exec(value);
    if (!spelling || spelling[1].includes("@") || url.search || url.hash || (spelling[2] ?? "/") !== url.pathname)
        return null;
    return url.href;
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
        value.tx.chainId !== intent.request.chainId || !Array.isArray(value.executions) || value.executions.length !== (intent.quote.feeMode === "sponsored" ? 1 : 2) ||
        !isPlainRecord(value.delegation) || Object.hasOwn(value.delegation, "signature") ||
        !exactKeys(value.delegation, ["delegator", "delegate", "authority", "salt", "caveats"]) || !Array.isArray(value.delegation.caveats) ||
        value.delegation.caveats.length !== 2)
        mmFail("mm_gasless_submit_unknown");
    for (let i = 0; i < intent.quote.executions.length; i++) {
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
    const value = key === "sentinel-quote" ? parseSentinelResponse(body) : parseBody(body);
    if (key === "mimir-networks") {
        if (!exactKeys(value, ["networks"]) || !Array.isArray(value.networks) || value.networks.length > 256 || value.networks.some((row) => !isPlainRecord(row) || typeof row.chainId !== "number" || typeof row.name !== "string" ||
            !["mainnet", "testnet"].includes(String(row.networkType)) || typeof row.shieldSupported !== "boolean"))
            mmFail("mm_gasless_provider_unavailable");
    }
    else if (key === "accounts-networks") {
        // NetworkRegistry accepts a list or an object-keyed map; map values are unused metadata.
        const partial = value.partialSupport;
        const validPartial = Array.isArray(partial) ? partial.length <= 512 && partial.every((v) => typeof v === "string") :
            isPlainRecord(partial) && Object.keys(partial).length <= 512;
        if (!exactKeys(value, ["fullSupport", "partialSupport"]) || !Array.isArray(value.fullSupport) ||
            value.fullSupport.length > 512 || value.fullSupport.some((v) => typeof v !== "string") || !validPartial) {
            mmFail("mm_gasless_provider_unavailable");
        }
    }
    else if (key === "sentinel-networks") {
        // Only the chain key and relay flag control SDK capability; other row fields are provider metadata.
        if (Object.keys(value).length > 512 || Object.entries(value).some(([chain, row]) => !/^[1-9][0-9]*$/u.test(chain) ||
            !Number.isSafeInteger(Number(chain)) || !isPlainRecord(row) || typeof row.relayTransactions !== "boolean"))
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
export function networkContextQuote(input, owner, authToken, projectId) {
    return { mode: "quote", input: structuredClone(input), owner, authToken, projectId };
}
export function networkContextRequest(mode, intent, projectId, token, now) { return { mode, intent, projectId, token, now }; }
export function networkContextEmpty(mode) { return { mode }; }
export function networkContextServerRequest(query, projectId, token) {
    return { mode: "readRequest", query: structuredClone(query), projectId, token };
}
export function networkContextServerTransaction(input, projectId, token, now) {
    return { mode: "submitTransaction", input: structuredClone(input), projectId, token, now };
}
//# sourceMappingURL=network.js.map