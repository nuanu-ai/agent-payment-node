import { request as httpsRequest } from "node:https";
import { resolvePublicAddresses, sameIpAddress } from "../network-policy.js";
import { decodeCanonicalBase64Json } from "../x402-codec.js";
import { MERCHANT_URL } from "./pins.js";
import { checkMerchantChallenge, merchantProof, refuse } from "./protocol.js";
/** Finite vendor HTTP transport: one URL, no redirects/retries, DNS pin, bounded bytes, canonical v2 proof. */
export class MerchantHttp {
    async get(input) {
        if (input.url !== MERCHANT_URL || input.httpRequest !== undefined)
            refuse("merchant_http_exact_url");
        if (input.paymentSignature !== undefined) {
            const v = decodeCanonicalBase64Json(input.paymentSignature), p = v.payload;
            if (!p || Object.keys(p).length !== 1 || typeof p.txHash !== "string" || Object.keys(v).sort().join(",") !== "accepted,payload,resource,x402Version")
                refuse("merchant_http_proof_shape");
            const f = checkMerchantChallenge({ x402Version: v.x402Version, resource: v.resource, accepts: [v.accepted] });
            if (merchantProof(f, p.txHash) !== input.paymentSignature)
                refuse("merchant_http_proof_canonical");
        }
        const endpoint = new URL(MERCHANT_URL), startedAt = new Date().toISOString(), deadline = Date.now() + 30000;
        let timer;
        const addresses = await Promise.race([resolvePublicAddresses(endpoint, "APN_HTTP_CONFIG", "Pinned merchant"), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("DNS deadline")), 15000); })]).finally(() => clearTimeout(timer));
        const selected = addresses[0];
        if (selected === undefined)
            refuse("merchant_dns_empty");
        return await new Promise((resolve, reject) => {
            let settled = false, timeout;
            const fail = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                reject(new Error("Pinned merchant transport failed"));
            };
            const request = httpsRequest(endpoint, { method: "GET", agent: false, family: selected.family, headers: { accept: "application/json", "accept-encoding": "identity", ...(input.paymentSignature === undefined ? {} : { "PAYMENT-SIGNATURE": input.paymentSignature }) }, lookup: (_host, _opts, callback) => callback(null, selected.address, selected.family) }, response => {
                const socket = response.socket;
                if (socket.authorized !== true || socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address) || response.statusCode === undefined || response.statusCode >= 300 && response.statusCode < 400 || response.headers["content-encoding"] !== undefined && response.headers["content-encoding"] !== "identity" || response.rawHeaders.length > 128 || response.rawHeaders.reduce((n, v) => n + Buffer.byteLength(v), 0) > 32768) {
                    response.destroy();
                    fail();
                    return;
                }
                let size = 0;
                const chunks = [];
                response.on("data", (chunk) => {
                    size += chunk.length;
                    if (size > 256 * 1024) {
                        response.destroy();
                        fail();
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("end", () => {
                    if (settled)
                        return;
                    settled = true;
                    clearTimeout(timeout);
                    const rawHeaderPairs = [];
                    for (let i = 0; i < response.rawHeaders.length; i += 2)
                        rawHeaderPairs.push([response.rawHeaders[i], response.rawHeaders[i + 1]]);
                    resolve({ status: response.statusCode, rawHeaderPairs, bodyBytes: Buffer.concat(chunks), finalUrl: MERCHANT_URL, observedOrigin: endpoint.origin, dnsAddresses: addresses.map(a => a.address), selectedAddress: selected.address, startedAt, observedAt: new Date().toISOString(), safeTransportProvenance: { protocol: "https", tlsAuthorized: true, redirectCount: 0 } });
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
//# sourceMappingURL=http.js.map