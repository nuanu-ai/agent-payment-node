import { request } from "node:https";
import { rootCertificates } from "node:tls";
import { ApnError } from "../errors.js";
import { resolvePublicAddresses } from "../network-policy.js";
/** Production transport pins one validated public address and built-in TLS roots. */
export const tronHttpsFetch = createTronHttpsFetch(request, resolvePublicAddresses);
/** Dependency injection keeps transport failure tests offline and deterministic. */
export function createTronHttpsFetch(requestHttps, resolveAddresses) {
    return async (input, init) => {
        if (!(input instanceof URL) || typeof init?.body !== "string" || init.signal === undefined || init.signal === null)
            invalid();
        const endpoint = input;
        const signal = init.signal;
        const body = init.body;
        const addresses = await resolveBounded(endpoint, signal, resolveAddresses);
        const selected = addresses[0];
        if (selected === undefined)
            invalid();
        if (signal.aborted)
            throw new ApnError("APN_RPC_PROTOCOL", "The bounded TRON HTTPS transport did not return valid evidence.", { reason: "deadline" });
        return await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (response) => {
                if (settled)
                    return;
                settled = true;
                signal.removeEventListener("abort", abort);
                if (response instanceof ApnError)
                    reject(response);
                else
                    resolve(response);
            };
            const fail = (reason, status) => finish(new ApnError("APN_RPC_PROTOCOL", "The bounded TRON HTTPS transport did not return valid evidence.", { reason, ...(status === undefined ? {} : { httpStatus: String(status) }) }));
            const outgoing = requestHttps(endpoint, { method: "POST", family: selected.family, ca: [...rootCertificates],
                headers: { "content-type": "application/json", accept: "application/json", "content-length": Buffer.byteLength(body).toString() },
                lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
            }, (incoming) => {
                const contentType = incoming.headers["content-type"] ?? "";
                const declared = Number(incoming.headers["content-length"] ?? "0");
                if (incoming.statusCode !== 200) {
                    fail("http_status", incoming.statusCode);
                    incoming.destroy();
                    return;
                }
                if (!contentType.includes("application/json")) {
                    fail("content_type");
                    incoming.destroy();
                    return;
                }
                if (!Number.isSafeInteger(declared) || declared < 0 || declared > 2_097_152) {
                    fail("content_length");
                    incoming.destroy();
                    return;
                }
                const chunks = [];
                let total = 0;
                incoming.on("data", (chunk) => {
                    total += chunk.length;
                    if (total > 2_097_152) {
                        fail("body_too_large");
                        incoming.destroy();
                        return;
                    }
                    chunks.push(chunk);
                });
                incoming.on("end", () => finish(new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "content-type": contentType }, status: 200 })));
                incoming.on("error", () => fail("response_error"));
                incoming.on("aborted", () => fail("response_aborted"));
            });
            const abort = () => { fail("deadline"); outgoing.destroy(); };
            signal.addEventListener("abort", abort, { once: true });
            outgoing.on("error", () => fail("socket_error"));
            if (signal.aborted)
                abort();
            else
                outgoing.end(body);
        });
    };
}
async function resolveBounded(endpoint, signal, resolveAddresses) {
    let abort;
    try {
        return await Promise.race([resolveAddresses(endpoint, "APN_RPC_CONFIG", "TRON RPC endpoint"), new Promise((_resolve, reject) => {
                abort = () => reject(new ApnError("APN_RPC_PROTOCOL", "TRON RPC address validation exceeded its deadline.", { reason: "dns_deadline" }));
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted)
                    abort();
            })]);
    }
    finally {
        if (abort !== undefined)
            signal.removeEventListener("abort", abort);
    }
}
function invalid() { throw new ApnError("APN_RPC_CONFIG", "The bounded TRON HTTPS request is invalid."); }
//# sourceMappingURL=https.js.map