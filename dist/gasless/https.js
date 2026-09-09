import { request as httpsRequest } from "node:https";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl, resolvePublicAddresses, sameIpAddress } from "../network-policy.js";
/** Finite public HTTPS transport: DNS pinning, default TLS, no redirects and no retries. */
export class GaslessHttps {
    active = 0;
    waiting = [];
    async request(endpointInput, method, body, maximumBytes, code) {
        const endpoint = parsePublicHttpsUrl(endpointInput, code, "Gasless endpoint", 2048);
        if (body !== null && Buffer.byteLength(body, "utf8") > 256 * 1024)
            throw failure(code, "request_size");
        if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024) {
            throw failure(code, "response_bound");
        }
        if (this.active >= 2) {
            if (this.waiting.length >= 32)
                throw failure(code, "concurrency_bound");
            await new Promise((resolve) => this.waiting.push(resolve));
        }
        else {
            this.active += 1;
        }
        const deadline = Date.now() + 15_000;
        let timer;
        try {
            const addresses = await Promise.race([
                resolvePublicAddresses(endpoint, code, "Gasless endpoint"),
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => reject(failure(code, "DNS_deadline")), 15_000);
                }),
            ]);
            clearTimeout(timer);
            timer = undefined;
            const remaining = deadline - Date.now();
            if (remaining < 1)
                throw failure(code, "request_deadline");
            return await send(endpoint, method, body, addresses, maximumBytes, remaining, code);
        }
        finally {
            clearTimeout(timer);
            const release = this.waiting.shift();
            if (release === undefined)
                this.active -= 1;
            else
                release();
        }
    }
}
function failure(code, reason) {
    const publicCode = code === "APN_RPC_CONFIG" ? "APN_RPC_AMBIGUOUS" : "APN_PROVIDER_UNAVAILABLE";
    return new ApnError(publicCode, `Gasless transport failed: ${reason}.`);
}
function send(endpoint, method, body, addresses, maximumBytes, timeoutMs, code) {
    return new Promise((resolve, reject) => {
        const selected = addresses[0];
        if (selected === undefined) {
            reject(failure(code, "DNS_empty"));
            return;
        }
        let settled = false;
        const finish = (error, value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (error !== null)
                reject(error instanceof ApnError ? error : failure(code, "request_interrupted"));
            else
                resolve(value);
        };
        const request = httpsRequest(endpoint, {
            method, agent: false, family: selected.family,
            headers: {
                accept: "application/json", "accept-encoding": "identity",
                ...(body === null ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString() }),
            },
            lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
        }, (response) => {
            const status = response.statusCode ?? 0;
            const encoding = response.headers["content-encoding"];
            if ((status >= 300 && status < 400) || (encoding !== undefined && encoding !== "identity")) {
                response.destroy();
                finish(failure(code, "redirect_or_encoding"));
                return;
            }
            const declared = response.headers["content-length"];
            if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || BigInt(declared) > BigInt(maximumBytes))) {
                response.destroy();
                finish(failure(code, "response_size"));
                return;
            }
            let size = 0;
            const chunks = [];
            response.on("data", (chunk) => {
                size += chunk.length;
                if (size > maximumBytes) {
                    response.destroy();
                    finish(failure(code, "response_size"));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", () => {
                try {
                    finish(null, { status, body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)) });
                }
                catch {
                    finish(failure(code, "response_utf8"));
                }
            });
            response.on("aborted", () => finish(failure(code, "response_aborted")));
            response.on("error", () => finish(failure(code, "response_interrupted")));
        });
        const timer = setTimeout(() => { request.destroy(); finish(failure(code, "request_deadline")); }, timeoutMs);
        request.on("socket", (socket) => socket.on("connect", () => {
            if (socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address)) {
                request.destroy();
                finish(failure(code, "pinned_address_changed"));
            }
        }));
        request.on("error", () => finish(failure(code, "request_interrupted")));
        request.end(body ?? undefined);
    });
}
//# sourceMappingURL=https.js.map