import { randomUUID } from "node:crypto";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { address, getAddressDecoder, getAddressEncoder, getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { atomic, SOLANA_GENESIS } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { solanaHttpsFetch } from "./https.js";
export class SolanaRpcBudget {
    maxPhysicalRequests;
    minimumIntervalMs;
    now;
    wait;
    nextStart = 0;
    turn = Promise.resolve();
    logical = 0;
    physical = 0;
    constructor(options) {
        if (!Number.isSafeInteger(options.maxPhysicalRequests) || options.maxPhysicalRequests < 1 ||
            !Number.isSafeInteger(options.minimumIntervalMs ?? 500) || (options.minimumIntervalMs ?? 500) < 500)
            configFailure();
        this.maxPhysicalRequests = options.maxPhysicalRequests;
        this.minimumIntervalMs = options.minimumIntervalMs ?? 500;
        this.now = options.now ?? Date.now;
        this.wait = options.wait;
    }
    get logicalCalls() { return this.logical; }
    get physicalRequests() { return this.physical; }
    get remainingPhysicalRequests() { return this.maxPhysicalRequests - this.physical; }
    /** Reserve and pace before transport. The queue owns no operation or storage lock. */
    async acquire(logicalCalls) {
        this.logical += logicalCalls;
        const previous = this.turn;
        let release;
        this.turn = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            if (this.physical >= this.maxPhysicalRequests)
                throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "The Solana operation exhausted its physical RPC request budget.", { logicalCalls: this.logical, physicalRequests: this.physical, maxPhysicalRequests: this.maxPhysicalRequests });
            const delay = Math.max(0, this.nextStart - this.now());
            if (delay > 0) {
                if (this.wait === undefined)
                    throw new ApnError("APN_RPC_RATE_LIMITED", "The Solana RPC pacing window is not yet open.", { retryAfterMs: delay, logicalCalls: this.logical, physicalRequests: this.physical });
                await this.wait(delay);
                const remaining = this.nextStart - this.now();
                if (remaining > 0)
                    throw new ApnError("APN_RPC_RATE_LIMITED", "The Solana RPC pacing window is not yet open.", { retryAfterMs: remaining, logicalCalls: this.logical, physicalRequests: this.physical });
            }
            this.physical += 1;
            this.nextStart = this.now() + this.minimumIntervalMs;
        }
        finally {
            release();
        }
    }
}
const READ_METHODS = new Set([
    "getGenesisHash", "getMultipleAccounts", "getAccountInfo", "getLatestBlockhash", "getBlockHeight", "getFeeForMessage",
    "getMinimumBalanceForRentExemption", "getSignatureStatuses", "getTransaction", "getBlock",
]);
export class SolanaRpc {
    endpoint;
    fetcher;
    originHash;
    budget;
    constructor(endpoint, fetcher = solanaHttpsFetch, budget) {
        this.endpoint = endpoint;
        this.fetcher = fetcher;
        this.originHash = endpoint === undefined ? sha256("solana_rpc_unconfigured") : sha256(endpoint);
        // Stage integration passes one bounded budget through an operation, outside state locks.
        this.budget = budget;
    }
    async call(method, params) {
        const id = randomUUID();
        const value = await this.request({ jsonrpc: "2.0", id, method, params }, 1, method === "sendTransaction");
        const record = rpcRecord(value);
        if (!exactKeys(record, ["jsonrpc", "id", "result"]) || record.jsonrpc !== "2.0" || record.id !== id)
            protocolFailure();
        return record.result;
    }
    /** Independent read methods share one POST; results retain input order despite unordered replies. */
    async batch(reads) {
        if (reads.length < 1 || reads.length > 8 || reads.some(read => !READ_METHODS.has(read.method)))
            protocolFailure();
        const requests = reads.map(read => ({ jsonrpc: "2.0", id: randomUUID(), method: read.method, params: read.params }));
        const value = await this.request(requests, requests.length, false);
        if (!Array.isArray(value) || value.length !== requests.length)
            protocolFailure();
        const byId = new Map(requests.map((request, index) => [request.id, index]));
        const results = new Array(requests.length);
        const seen = new Set();
        for (const response of value) {
            const record = rpcRecord(response);
            if (!exactKeys(record, ["jsonrpc", "id", "result"]) || record.jsonrpc !== "2.0" || typeof record.id !== "string" ||
                !byId.has(record.id) || seen.has(record.id))
                protocolFailure();
            seen.add(record.id);
            results[byId.get(record.id)] = record.result;
        }
        if (seen.size !== requests.length)
            protocolFailure();
        return results;
    }
    async request(body, logicalCalls, effect) {
        if (this.endpoint === undefined)
            configFailure();
        let url;
        try {
            url = parsePublicHttpsUrl(this.endpoint, "APN_RPC_CONFIG", "Solana RPC endpoint", 2048);
        }
        catch {
            return configFailure();
        }
        if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "" || url.port !== "" && url.port !== "443")
            configFailure();
        let payload;
        try {
            payload = JSON.stringify(body);
        }
        catch {
            return protocolFailure();
        }
        await this.budget?.acquire(logicalCalls);
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 10_000);
        deadline.unref();
        let reader;
        try {
            const response = await this.fetcher(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
                body: payload, redirect: "error", credentials: "omit", signal: controller.signal });
            if (response.status === 429)
                throw new ApnError("APN_RPC_RATE_LIMITED", "The Solana RPC provider requested a cooldown.", retryAfterDetails(response.headers.get("retry-after")));
            if (!response.ok || response.body === null || !(response.headers.get("content-type") ?? "").includes("application/json"))
                protocolFailure();
            reader = response.body.getReader();
            const chunks = [];
            let length = 0;
            while (true) {
                const result = await reader.read();
                if (result.done)
                    break;
                length += result.value.byteLength;
                if (length > 2_097_152)
                    protocolFailure();
                chunks.push(result.value);
            }
            return parseJsonWithBigInts(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        }
        catch (error) {
            if (error instanceof ApnError)
                throw error;
            throw new ApnError(effect ? "APN_RPC_AMBIGUOUS" : "APN_RPC_PROTOCOL", "The bounded Solana RPC request did not return valid evidence.");
        }
        finally {
            clearTimeout(deadline);
            await reader?.cancel().catch(() => { });
        }
    }
}
function retryAfterDetails(value) {
    if (value === null)
        return undefined;
    const milliseconds = /^\d+$/u.test(value.trim()) ? Number(value.trim()) * 1_000 : Date.parse(value) - Date.now();
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? { retryAfterMs: Math.min(milliseconds, 86_400_000) } : undefined;
}
export async function assertSolanaNetwork(rpc) {
    if (await rpc.call("getGenesisHash", []) !== SOLANA_GENESIS)
        throw new ApnError("APN_CHAIN_MISMATCH", "The RPC does not attest the expected Solana mainnet genesis.");
    return SOLANA_GENESIS;
}
export function solanaAddress(input) {
    try {
        const encoded = getAddressEncoder().encode(address(input));
        if (encoded.length !== 32 || getAddressDecoder().decode(encoded) !== input)
            throw new Error("address mismatch");
        return input;
    }
    catch {
        throw new ApnError("APN_INVALID_INPUT", "Use a canonical 32-byte Solana base58 address.");
    }
}
export function solanaSignature(input) {
    if (typeof input !== "string" || input.length < 64 || input.length > 88)
        protocolFailure();
    try {
        const bytes = getBase58Encoder().encode(input);
        if (bytes.length !== 64 || getBase58Decoder().decode(bytes) !== input)
            protocolFailure();
    }
    catch {
        protocolFailure();
    }
    return input;
}
export function rpcRecord(value) {
    if (!isPlainRecord(value))
        protocolFailure();
    return value;
}
export function rpcArray(value, maximum = 64) {
    if (!Array.isArray(value) || value.length > maximum)
        protocolFailure();
    return value;
}
export function rpcAtomic(value) {
    if (typeof value === "bigint")
        return atomic(value.toString());
    if (typeof value === "number" && Number.isSafeInteger(value))
        return atomic(value.toString());
    protocolFailure();
}
export function protocolFailure() { throw new ApnError("APN_RPC_PROTOCOL", "Solana RPC evidence has an invalid shape or semantic binding."); }
function configFailure() { throw new ApnError("APN_RPC_CONFIG", "The Solana RPC requires explicit HTTPS without URL credentials, query parameters or fragments.", { nextActions: ["Set APN_SOLANA_RPC_URL to the intended Solana mainnet HTTPS endpoint."] }); }
//# sourceMappingURL=rpc.js.map