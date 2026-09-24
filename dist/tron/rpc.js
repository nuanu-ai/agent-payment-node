import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { setTimeout as pause } from "node:timers/promises";
import { sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { TRON_GENESIS, tronAtomic, tronHash, tronProtocolFailure, tronRecord } from "./codec.js";
import { tronHttpsFetch } from "./https.js";
export const TRON_RPC_METHODS = Object.freeze(["wallet/getblockbynum", "wallet/getnowblock", "wallet/getnodeinfo",
    "wallet/getchainparameters", "wallet/getnextmaintenancetime", "wallet/getaccount", "wallet/getaccountresource",
    "wallet/triggerconstantcontract", "wallet/estimateenergy", "wallet/broadcasttransaction", "wallet/getcontractinfo",
    "wallet/gettransactionbyid", "wallet/gettransactioninfobyid", "walletsolidity/gettransactionbyid",
    "walletsolidity/gettransactioninfobyid", "walletsolidity/getblockbynum", "walletsolidity/getnowblock", "walletsolidity/getaccount",
    "walletsolidity/triggerconstantcontract"]);
/** Ten prepare reads each have a ten-second transport bound; nine one-second gaps plus the ten-second expiry reserve fit the 120-second TRON window. */
export const TRON_RPC_MAX_MINIMUM_POST_INTERVAL_MS = 1_000;
export class TronRpc {
    endpoint;
    fetcher;
    pacing;
    originHash;
    lastPostStartAt;
    startQueue = Promise.resolve();
    constructor(endpoint, fetcher = tronHttpsFetch, pacing = {}) {
        this.endpoint = endpoint;
        this.fetcher = fetcher;
        this.pacing = pacing;
        this.originHash = sha256(endpoint ?? "tron_rpc_unconfigured");
    }
    async call(method, body) {
        if (this.endpoint === undefined || !TRON_RPC_METHODS.includes(method))
            configFailure();
        let base;
        try {
            base = parsePublicHttpsUrl(this.endpoint, "APN_RPC_CONFIG", "TRON RPC endpoint", 2048);
        }
        catch {
            return configFailure();
        }
        if (base.protocol !== "https:" || base.username !== "" || base.password !== "" || base.hash !== "" || base.search !== "" || base.port !== "" && base.port !== "443")
            configFailure();
        const url = new URL(`${base.pathname.replace(/\/$/u, "")}/${method}`, base.origin);
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 10_000);
        deadline.unref();
        let reader;
        try {
            const payload = JSON.stringify(body);
            if (Buffer.byteLength(payload) > 32_768)
                tronProtocolFailure();
            await this.awaitPostStart(controller.signal);
            const response = await this.fetcher(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
                body: payload, redirect: "error", credentials: "omit", signal: controller.signal });
            if (!response.ok || response.body === null || !(response.headers.get("content-type") ?? "").includes("application/json"))
                tronProtocolFailure();
            reader = response.body.getReader();
            const chunks = [];
            let length = 0;
            while (true) {
                const next = await reader.read();
                if (next.done)
                    break;
                length += next.value.byteLength;
                if (length > 2_097_152)
                    tronProtocolFailure();
                chunks.push(next.value);
            }
            // POST ignores int64_as_string; lossless parsing prevents numeric rounding.
            const value = tronRecord(parseJsonWithBigInts(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
            if ("Error" in value || "error" in value)
                tronProtocolFailure();
            return value;
        }
        catch (error) {
            if (error instanceof ApnError) {
                if (error.code !== "APN_RPC_PROTOCOL")
                    throw error;
                throw new ApnError(error.code, error.message, { ...error.details, rpcMethod: method });
            }
            throw new ApnError(method === "wallet/broadcasttransaction" ? "APN_RPC_AMBIGUOUS" : "APN_RPC_PROTOCOL", "The bounded TRON request did not return valid evidence.", { rpcMethod: method, reason: error instanceof SyntaxError ? "invalid_json" : "invalid_response" });
        }
        finally {
            clearTimeout(deadline);
            await reader?.cancel().catch(() => { });
        }
    }
    async awaitPostStart(signal) {
        const raw = this.pacing.minimumPostStartIntervalMs;
        if (raw === undefined || raw === "0")
            return;
        if (!/^[1-9][0-9]{0,3}$/u.test(raw) || Number(raw) > TRON_RPC_MAX_MINIMUM_POST_INTERVAL_MS) {
            throw new ApnError("APN_RPC_CONFIG", "TRON RPC minimum POST interval must be a canonical integer from 0 to 1000 milliseconds.");
        }
        const interval = Number(raw), now = this.pacing.now ?? performance.now.bind(performance);
        const wait = this.pacing.wait ?? ((milliseconds, abort) => pause(milliseconds, undefined, { signal: abort }));
        const start = this.startQueue.then(async () => {
            const remaining = this.lastPostStartAt === undefined ? 0 : Math.max(0, this.lastPostStartAt + interval - now());
            try {
                if (remaining > 0)
                    await wait(remaining, signal);
            }
            catch {
                throw new ApnError("APN_RPC_PROTOCOL", "The bounded TRON request did not start before its deadline.", { reason: "pacing_deadline" });
            }
            if (signal.aborted)
                throw new ApnError("APN_RPC_PROTOCOL", "The bounded TRON request did not start before its deadline.", { reason: "pacing_deadline" });
            this.lastPostStartAt = now();
        });
        this.startQueue = start.catch(() => { });
        await start;
    }
}
export function tronBlock(value) {
    const body = tronRecord(value);
    const id = tronHash(body.blockID);
    const raw = tronRecord(tronRecord(body.block_header).raw_data);
    const number = tronAtomic(raw.number, true);
    const timestamp = tronAtomic(raw.timestamp, true);
    if (number > 0xffffffffffffffffn || id.slice(0, 16) !== number.toString(16).padStart(16, "0"))
        tronProtocolFailure();
    return { id, number, timestamp, body };
}
export async function assertTronNetwork(rpc) {
    const block = tronBlock(await rpc.call("wallet/getblockbynum", { num: 0 }));
    if (block.number !== 0n || block.id !== TRON_GENESIS)
        throw new ApnError("APN_CHAIN_MISMATCH", "The RPC does not attest the full TRON mainnet genesis.");
    return TRON_GENESIS;
}
function configFailure() {
    throw new ApnError("APN_RPC_CONFIG", "TRON requires an explicit public HTTPS RPC without URL credentials, query parameters or fragments.", {
        nextActions: ["Set APN_TRON_RPC_URL to the intended TRON mainnet HTTPS API base."],
    });
}
//# sourceMappingURL=rpc.js.map