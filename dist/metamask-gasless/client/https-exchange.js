import { request as httpsRequest } from "node:https";
import { parsePublicHttpsUrl, resolvePublicAddresses, sameIpAddress } from "../../network-policy.js";
export class HttpsFetchExchange {
    async request(request) {
        const url = parsePublicHttpsUrl(request.url, "APN_HTTP_CONFIG", "MetaMask service", 2048);
        const deadline = Date.now() + request.timeoutMs;
        let timer;
        try {
            const addresses = await Promise.race([resolvePublicAddresses(url, "APN_HTTP_CONFIG", "MetaMask service"),
                new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("dns timeout")), request.timeoutMs); })]);
            clearTimeout(timer);
            timer = undefined;
            const remaining = deadline - Date.now();
            if (remaining < 1)
                throw new Error("request timeout");
            return sendHttps(url, { ...request, timeoutMs: remaining }, addresses);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
/**
 * Hands the request's bytes to `req`. A read (no `beforeSend`) is written at once. A send is written only once its TLS
 * session is up, right after its gate: Node writes nothing of a request before `end`, so none of a send's bytes can wait
 * in a buffer while DNS, TCP or the handshake take their time, and the deadline check runs right before they go. A gate
 * that refuses destroys the request with nothing written and reports its error through `fail`.
 */
export function endRequestWhenSecure(req, input, fail) {
    const gate = input.beforeSend;
    if (gate === undefined) {
        req.end(input.body ?? undefined);
        return;
    }
    req.once("socket", (socket) => socket.once("secureConnect", () => {
        if (req.destroyed)
            return;
        try {
            gate();
        }
        catch (error) {
            req.destroy();
            fail(error);
            return;
        }
        // From here the gate has counted the request as sent: a throw while writing it may follow bytes that already left,
        // so it ends the exchange as a failure and the send stays unknown, never "not reached".
        try {
            req.end(input.body ?? undefined);
        }
        catch (error) {
            req.destroy();
            fail(error);
        }
    }));
}
function sendHttps(url, input, addresses) {
    return new Promise((resolve, reject) => {
        const selected = addresses[0];
        if (!selected) {
            reject(new Error("network"));
            return;
        }
        let done = false;
        const finish = (error, result) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            input.signal?.removeEventListener("abort", abort);
            error ? reject(error) : resolve(result);
        };
        const headers = { ...input.headers, "accept-encoding": "identity",
            ...(input.body === null ? {} : { "content-length": String(Buffer.byteLength(input.body)) }) };
        const req = httpsRequest(url, { method: input.method, headers, agent: false, family: selected.family,
            lookup: (_host, _options, callback) => callback(null, selected.address, selected.family) }, (response) => {
            const status = response.statusCode ?? 0, encoding = response.headers["content-encoding"];
            if ((status >= 300 && status < 400) || (encoding && encoding !== "identity")) {
                response.destroy();
                finish(new Error("response"));
                return;
            }
            let size = 0;
            const chunks = [];
            response.on("data", (chunk) => { size += chunk.length; if (size > input.maxBytes) {
                response.destroy();
                finish(new Error("response"));
            }
            else
                chunks.push(chunk); });
            response.on("end", () => { try {
                const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
                finish(null, { status, body });
            }
            catch {
                finish(new Error("response"));
            } });
            response.on("aborted", () => finish(new Error("response")));
            response.on("error", () => finish(new Error("response")));
        });
        req.on("socket", (socket) => socket.on("connect", () => { if (!socket.remoteAddress || !sameIpAddress(socket.remoteAddress, selected.address)) {
            req.destroy();
            finish(new Error("network"));
        } }));
        req.on("error", () => finish(new Error("network")));
        const abort = () => { req.destroy(); finish(new DOMException("Aborted", "AbortError")); };
        input.signal?.addEventListener("abort", abort, { once: true });
        // A send's timeout is already capped at its deadline (network.ts): the request is destroyed there, written or not.
        const timer = setTimeout(() => { req.destroy(); finish(new Error("timeout")); }, input.timeoutMs);
        endRequestWhenSecure(req, input, (error) => finish(error));
    });
}
//# sourceMappingURL=https-exchange.js.map