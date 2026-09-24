import { request } from "node:https";
import { rootCertificates } from "node:tls";
import { setTimeout as pause } from "node:timers/promises";
import { ApnError } from "../errors.js";
import { resolvePublicAddresses } from "../network-policy.js";
/** Production transport pins one validated public address and built-in TLS roots. */
export const tronHttpsFetch = createTronHttpsFetch(request, resolvePublicAddresses);
/** Ten ten-second TRX prepare requests, nine gaps and the ten-second expiry reserve fit the 120-second TRON window. */
export const TRON_RPC_MAX_MINIMUM_POST_INTERVAL_MS = 1_000;
/** One pacing queue belongs to one APN TRON client, never a process-wide provider limit. */
export function configuredTronHttpsFetch(options) {
    return createTronHttpsFetch(request, resolvePublicAddresses, options);
}
/** Dependency injection keeps transport failure tests offline and deterministic. */
export function createTronHttpsFetch(requestHttps, resolveAddresses, pacing = {}) {
    let lastPostStartAt;
    let startQueue = Promise.resolve();
    return async (input, init) => {
        if (!(input instanceof URL) || typeof init?.body !== "string" || init.signal === undefined || init.signal === null)
            invalid();
        const endpoint = input;
        const signal = init.signal;
        const body = init.body;
        const raw = pacing.minimumPostStartIntervalMs;
        if (raw !== undefined && raw !== "0" && (!/^[1-9][0-9]{0,3}$/u.test(raw) || Number(raw) > TRON_RPC_MAX_MINIMUM_POST_INTERVAL_MS)) {
            throw new ApnError("APN_RPC_CONFIG", "TRON RPC minimum POST interval must be a canonical integer from 0 to 1000 milliseconds.");
        }
        const interval = raw === undefined ? 0 : Number(raw);
        const addresses = await resolveBounded(endpoint, signal, resolveAddresses);
        const selected = addresses[0];
        if (selected === undefined)
            invalid();
        if (signal.aborted)
            throw new ApnError("APN_RPC_PROTOCOL", "The bounded TRON HTTPS transport did not return valid evidence.", { reason: "deadline" });
        const openRequest = () => new Promise((resolve, reject) => {
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
        if (interval === 0)
            return await openRequest();
        const now = pacing.now ?? performance.now.bind(performance);
        const wait = pacing.wait ?? ((milliseconds, abort) => pause(milliseconds, undefined, { signal: abort }));
        const start = startQueue.then(async () => {
            const remaining = lastPostStartAt === undefined ? 0 : Math.max(0, lastPostStartAt + interval - now());
            try {
                if (remaining > 0)
                    await wait(remaining, signal);
            }
            catch {
                throw new ApnError("APN_RPC_PROTOCOL", "The bounded TRON request did not start before its deadline.", { reason: "pacing_deadline" });
            }
            if (signal.aborted)
                throw new ApnError("APN_RPC_PROTOCOL", "The bounded TRON request did not start before its deadline.", { reason: "pacing_deadline" });
            // Keep this timestamp and the physical HTTPS POST start in the same queued turn.
            lastPostStartAt = now();
            return { response: openRequest() };
        });
        startQueue = start.then(() => { }, () => { });
        const { response } = await start;
        return await response;
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