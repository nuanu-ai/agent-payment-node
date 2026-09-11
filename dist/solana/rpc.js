import { randomUUID } from "node:crypto";
import { parseJsonWithBigInts } from "@solana/rpc-spec-types";
import { address, getAddressDecoder, getAddressEncoder, getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { atomic, SOLANA_GENESIS } from "../chain-policy.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { solanaHttpsFetch } from "./https.js";
export class SolanaRpc {
    endpoint;
    fetcher;
    originHash;
    constructor(endpoint, fetcher = solanaHttpsFetch) {
        this.endpoint = endpoint;
        this.fetcher = fetcher;
        this.originHash = endpoint === undefined ? sha256("solana_rpc_unconfigured") : sha256(endpoint);
    }
    async call(method, params) {
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
        const id = randomUUID();
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), 10_000);
        deadline.unref();
        let reader;
        try {
            const response = await this.fetcher(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), redirect: "error", credentials: "omit", signal: controller.signal });
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
            const value = parseJsonWithBigInts(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
            const record = rpcRecord(value);
            if (!exactKeys(record, ["jsonrpc", "id", "result"]) || record.jsonrpc !== "2.0" || record.id !== id)
                protocolFailure();
            return record.result;
        }
        catch (error) {
            if (error instanceof ApnError)
                throw error;
            throw new ApnError(method === "sendTransaction" ? "APN_RPC_AMBIGUOUS" : "APN_RPC_PROTOCOL", "The bounded Solana RPC request did not return valid evidence.");
        }
        finally {
            clearTimeout(deadline);
            await reader?.cancel().catch(() => { });
        }
    }
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