import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
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
export class TronRpc {
    endpoint;
    fetcher;
    originHash;
    constructor(endpoint, fetcher = tronHttpsFetch) {
        this.endpoint = endpoint;
        this.fetcher = fetcher;
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
            if (error instanceof ApnError)
                throw error;
            throw new ApnError(method === "wallet/broadcasttransaction" ? "APN_RPC_AMBIGUOUS" : "APN_RPC_PROTOCOL", "The bounded TRON request did not return valid evidence.");
        }
        finally {
            clearTimeout(deadline);
            await reader?.cancel().catch(() => { });
        }
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