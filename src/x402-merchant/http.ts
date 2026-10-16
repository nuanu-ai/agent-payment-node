import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";
import { resolvePublicAddresses, sameIpAddress } from "../network-policy.js";
import type { HttpGetRequest, HttpObservation, HttpPort } from "../x402-model.js";
import { canonicalJson } from "../canonical.js";
import { decodeCanonicalBase64Json } from "../x402-codec.js";
import { canonicalMerchantUrl, refuse } from "./protocol.js";
/** Merchant HTTP transport: the operation's one canonical public HTTPS URL, no redirects/retries, DNS pin, bounded bytes, canonical v2 proof. */
export class MerchantHttp implements HttpPort {
    async get(input: HttpGetRequest): Promise<HttpObservation> {
        let url: string;
        try { url = canonicalMerchantUrl(input.url); } catch { return refuse("merchant_http_exact_url"); }
        if (input.httpRequest !== undefined)
            refuse("merchant_http_exact_url");
        if (input.paymentSignature !== undefined) {
            // The service built this proof from the frozen challenge; the transport only refuses anything but its canonical shape.
            const v = decodeCanonicalBase64Json(input.paymentSignature) as Record<string, unknown>, p = v.payload as Record<string, unknown>;
            if (!p || Object.keys(p).length !== 1 || typeof p.txHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(p.txHash) || Object.keys(v).sort().join(",") !== "accepted,payload,resource,x402Version" || v.x402Version !== 2)
                refuse("merchant_http_proof_shape");
            if (Buffer.from(canonicalJson(v), "utf8").toString("base64") !== input.paymentSignature)
                refuse("merchant_http_proof_canonical");
        }
        const endpoint = new URL(url), startedAt = new Date().toISOString(), deadline = Date.now() + 30000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const addresses = await Promise.race([resolvePublicAddresses(endpoint, "APN_HTTP_CONFIG", "Merchant"), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS deadline")), 15000); })]).finally(() => clearTimeout(timer));
        const selected = addresses[0];
        if (selected === undefined)
            refuse("merchant_dns_empty");
        return await new Promise<HttpObservation>((resolve, reject) => {
            let settled = false, timeout: ReturnType<typeof setTimeout>;
            const fail = () => { if (settled)
                return; settled = true; clearTimeout(timeout); reject(new Error("Merchant transport failed")); };
            const request = httpsRequest(endpoint, { method: "GET", agent: false, family: selected.family, headers: { accept: "application/json", "accept-encoding": "identity", ...(input.paymentSignature === undefined ? {} : { "PAYMENT-SIGNATURE": input.paymentSignature }) }, lookup: (_host, _opts, callback) => callback(null, selected.address, selected.family) }, response => {
                const socket = response.socket as TLSSocket;
                if (socket.authorized !== true || socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address) || response.statusCode === undefined || response.statusCode >= 300 && response.statusCode < 400 || response.headers["content-encoding"] !== undefined && response.headers["content-encoding"] !== "identity" || response.rawHeaders.length > 128 || response.rawHeaders.reduce((n, v) => n + Buffer.byteLength(v), 0) > 32768) {
                    response.destroy();
                    fail();
                    return;
                }
                let size = 0;
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 256 * 1024) {
                    response.destroy();
                    fail();
                    return;
                } chunks.push(chunk); });
                response.on("end", () => {
                    if (settled)
                        return;
                    settled = true;
                    clearTimeout(timeout);
                    const rawHeaderPairs: Array<readonly [
                        string,
                        string
                    ]> = [];
                    for (let i = 0; i < response.rawHeaders.length; i += 2)
                        rawHeaderPairs.push([response.rawHeaders[i]!, response.rawHeaders[i + 1]!]);
                    resolve({ status: response.statusCode!, rawHeaderPairs, bodyBytes: Buffer.concat(chunks), finalUrl: url, observedOrigin: endpoint.origin, dnsAddresses: addresses.map(a => a.address), selectedAddress: selected.address, startedAt, observedAt: new Date().toISOString(), safeTransportProvenance: { protocol: "https", tlsAuthorized: true, redirectCount: 0 } });
                });
                response.on("aborted", fail);
                response.on("error", fail);
            });
            timeout = setTimeout(() => { request.destroy(); fail(); }, Math.max(1, deadline - Date.now()));
            request.on("error", fail);
            request.end();
        });
    }
}
