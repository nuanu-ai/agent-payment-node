import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { parseJsonWithDuplicateRejection } from "../x402-strict-json.js";
import { PortfolioTransportFailure } from "./https.js";
/** A classified failure of one portfolio attempt. Only the reader decides whether it is retried. */
export class PortfolioReadFailure extends Error {
    reason;
    httpStatus;
    constructor(reason, httpStatus) {
        super(`The portfolio read is unavailable: ${reason}.`);
        this.reason = reason;
        this.httpStatus = httpStatus;
        this.name = "PortfolioReadFailure";
    }
}
/** Counts every HTTP request of one attempt; HTTP 429 and 5xx become classified failures instead of opaque protocol errors. */
export class CountingPortfolioHttp {
    http;
    calls = 0;
    methods = 0;
    constructor(http) {
        this.http = http;
    }
    async postJson(url, body, methods) {
        this.calls += 1;
        this.methods += methods;
        let response;
        try {
            response = await this.http.post(url, body);
        }
        catch (error) {
            if (error instanceof PortfolioTransportFailure)
                throw new PortfolioReadFailure(error.kind === "refused" ? "transport_refused" : error.kind);
            throw new PortfolioReadFailure("unreachable");
        }
        if (response.status === 429)
            throw new PortfolioReadFailure("rate_limited", 429);
        if (response.status >= 500 && response.status <= 599)
            throw new PortfolioReadFailure("server_error", response.status);
        if (response.status !== 200)
            throw new PortfolioReadFailure("http_status", response.status);
        if (!response.contentType.toLowerCase().includes("application/json"))
            throw new PortfolioReadFailure("protocol");
        return response.body;
    }
}
/** String ids keep lossless (bigint) parsing unambiguous. */
export function jsonRpcBatchBody(calls) {
    return JSON.stringify(calls.map((call, index) => ({ jsonrpc: "2.0", id: String(index + 1), method: call.method, params: call.params })));
}
/** Exact batch envelope: one item per request id, in any order, each carrying exactly a result or an error. */
export function jsonRpcBatchResults(raw, count, lossless) {
    let parsed;
    try {
        parsed = lossless ? parseJsonWithBigInts(raw) : parseJsonWithDuplicateRejection(raw);
    }
    catch {
        throw new PortfolioReadFailure("protocol");
    }
    if (!Array.isArray(parsed) || parsed.length !== count)
        throw new PortfolioReadFailure("protocol");
    const items = new Array(count).fill(undefined);
    for (const item of parsed) {
        if (!isPlainRecord(item) || item.jsonrpc !== "2.0" || typeof item.id !== "string" || !/^[1-9][0-9]{0,2}$/u.test(item.id)) {
            throw new PortfolioReadFailure("protocol");
        }
        const index = Number(item.id) - 1;
        if (index >= count || items[index] !== undefined)
            throw new PortfolioReadFailure("protocol");
        if (exactKeys(item, ["jsonrpc", "id", "result"]))
            items[index] = { ok: true, value: item.result };
        else if (exactKeys(item, ["jsonrpc", "id", "error"]) && isPlainRecord(item.error))
            items[index] = { ok: false };
        else
            throw new PortfolioReadFailure("protocol");
    }
    return items.map((item) => item ?? protocolFailure());
}
/** Converts any attempt failure into the classified unavailable result with the calls actually spent. */
export function unavailableAttempt(error, mode, counter) {
    const reason = error instanceof PortfolioReadFailure ? error.reason
        : error instanceof ApnError && error.code === "APN_CHAIN_MISMATCH" ? "chain_mismatch" : "protocol";
    const httpStatus = error instanceof PortfolioReadFailure ? error.httpStatus : undefined;
    return { status: "unavailable", reason, ...(httpStatus === undefined ? {} : { httpStatus }), mode,
        calls: counter.calls, methods: counter.methods };
}
function protocolFailure() { throw new PortfolioReadFailure("protocol"); }
//# sourceMappingURL=rpc-batch.js.map