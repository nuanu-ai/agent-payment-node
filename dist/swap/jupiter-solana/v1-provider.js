import { request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import { resolvePublicAddresses } from "../../network-policy.js";
import { ApnError } from "../../errors.js";
import { canonicalAddress, atomic, invalid, WRAPPED_SOL_MINT, SOLANA_USDC_MINT } from "./catalog.js";
import { decodeJupiterV1Quote, decodeJupiterV1Build } from "./v1-codec.js";
/** Only official V1 price/build reads. No generic endpoint, credentials, signer or sender. */
export class JupiterV1ReadOnlyProvider {
    fetcher;
    maximumReads;
    reads = 0;
    constructor(fetcher = jupiterV1HttpsFetch, maximumReads = 6) {
        this.fetcher = fetcher;
        this.maximumReads = maximumReads;
        if (!Number.isSafeInteger(maximumReads) || maximumReads < 1 || maximumReads > 6)
            invalid("Jupiter V1 read budget is invalid.");
    }
    async quoteExactIn(request) {
        validateRequest(request);
        const url = new URL("https://api.jup.ag/swap/v1/quote");
        for (const [k, v] of Object.entries({ inputMint: request.inputMint, outputMint: request.outputMint, amount: request.amount, slippageBps: String(request.slippageBps), swapMode: "ExactIn", dexes: "Whirlpool", onlyDirectRoutes: "true", instructionVersion: "V1", platformFeeBps: "0" }))
            url.searchParams.set(k, v);
        if (request.maximumInnerAccounts !== undefined)
            url.searchParams.set("maxAccounts", String(request.maximumInnerAccounts));
        return decodeJupiterV1Quote(await this.read(url, "GET"));
    }
    async buildExactIn(request, quote) {
        validateRequest(request);
        const checked = decodeJupiterV1Quote(quote);
        if (checked.inAmount !== request.amount || checked.slippageBps !== request.slippageBps)
            invalid("Jupiter V1 build quote differs from request.");
        return decodeJupiterV1Build(await this.read(new URL("https://api.jup.ag/swap/v1/swap-instructions"), "POST", { userPublicKey: request.taker, quoteResponse: checked, useSharedAccounts: false, wrapAndUnwrapSol: true, dynamicSlippage: false, dynamicComputeUnitLimit: false, computeUnitPriceMicroLamports: request.computeUnitPriceMicroLamports }));
    }
    async read(url, method, body) {
        if (++this.reads > this.maximumReads)
            throw new ApnError("APN_PROVIDER_PROTOCOL", "Jupiter V1 read budget exhausted.");
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
        timer.unref();
        let reader;
        try {
            const response = await this.fetcher(url, { method, headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", credentials: "omit", signal: controller.signal });
            if (!response.ok || response.body === null || !(response.headers.get("content-type") ?? "").includes("application/json") || (response.url !== "" && new URL(response.url).origin !== url.origin))
                invalid("Jupiter V1 official read failed.");
            reader = response.body.getReader();
            let total = 0;
            const chunks = [];
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                total += part.value.length;
                if (total > 262144)
                    invalid("Jupiter V1 response exceeds limit.");
                chunks.push(part.value);
            }
            return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        }
        catch {
            invalid("Jupiter V1 bounded read did not return valid public evidence.");
        }
        finally {
            clearTimeout(timer);
            await reader?.cancel().catch(() => { });
        }
    }
}
export function validateJupiterV1Request(request) { validateRequest(request); }
function validateRequest(request) {
    if (request.maximumInnerAccounts !== undefined && request.maximumInnerAccounts !== 12)
        invalid("Jupiter V1 inner account filter is outside the finite legacy lane.");
    canonicalAddress(request.taker);
    canonicalAddress(request.recipient);
    if (request.taker !== request.recipient || request.inputMint !== WRAPPED_SOL_MINT || request.outputMint !== SOLANA_USDC_MINT || atomic(request.amount) > (1n << 64n) - 1n || !Number.isSafeInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps >= 10000 || !Number.isSafeInteger(request.computeUnitPriceMicroLamports) || request.computeUnitPriceMicroLamports < 0 || request.computeUnitPriceMicroLamports > 1000)
        invalid("Jupiter V1 owned exact-in request is invalid.");
}
/** Production transport pins the validated public DNS result and uses built-in TLS roots. */
export const jupiterV1HttpsFetch = async (input, init) => {
    if (!(input instanceof URL) || input.origin !== "https://api.jup.ag" || init?.signal == null || !["GET", "POST"].includes(init.method ?? ""))
        invalid("Jupiter V1 transport target is invalid.");
    const signal = init.signal;
    let dnsAbort;
    const peers = await Promise.race([resolvePublicAddresses(input, "APN_RPC_CONFIG", "Jupiter official endpoint"), new Promise((_resolve, reject) => {
            dnsAbort = () => reject(new ApnError("APN_PROVIDER_PROTOCOL", "Jupiter V1 DNS deadline expired."));
            signal.addEventListener("abort", dnsAbort, { once: true });
            if (signal.aborted)
                dnsAbort();
        })]).finally(() => {
        if (dnsAbort !== undefined)
            signal.removeEventListener("abort", dnsAbort);
    });
    const peer = peers[0];
    if (peer === undefined || signal.aborted)
        invalid("Jupiter V1 transport DNS validation failed.");
    return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (response) => {
            if (settled)
                return;
            settled = true;
            signal.removeEventListener("abort", abort);
            if (response === undefined)
                reject(new ApnError("APN_PROVIDER_PROTOCOL", "Jupiter V1 official HTTPS response is invalid."));
            else
                resolve(response);
        };
        const body = typeof init.body === "string" ? init.body : undefined;
        const outgoing = httpsRequest(input, { method: init.method, family: peer.family, ca: [...rootCertificates], headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }) }, lookup: (_hostname, _options, callback) => callback(null, peer.address, peer.family) }, incoming => {
            const type = incoming.headers["content-type"] ?? "";
            if (incoming.statusCode !== 200 || !type.includes("application/json")) {
                incoming.destroy();
                finish();
                return;
            }
            const chunks = [];
            let size = 0;
            incoming.on("data", (chunk) => {
                size += chunk.length;
                if (size > 262144) {
                    incoming.destroy();
                    finish();
                    return;
                }
                chunks.push(chunk);
            });
            incoming.on("end", () => finish(new Response(new Uint8Array(Buffer.concat(chunks)), { status: 200, headers: { "content-type": type } })));
            incoming.on("error", () => finish());
            incoming.on("aborted", () => finish());
        });
        const abort = () => { outgoing.destroy(); finish(); };
        signal.addEventListener("abort", abort, { once: true });
        outgoing.on("error", () => finish());
        if (signal.aborted)
            abort();
        else
            outgoing.end(body);
    });
};
//# sourceMappingURL=v1-provider.js.map