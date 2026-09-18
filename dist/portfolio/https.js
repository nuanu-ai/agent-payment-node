import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { rootCertificates } from "node:tls";
import { isPublicIp, sameIpAddress, unbracket } from "../network-policy.js";
export const PORTFOLIO_REQUEST_TIMEOUT_MS = 10_000;
export const PORTFOLIO_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** `refused` is a local safety refusal (non-public target, pin change, encoding, size) and is never retried. */
export class PortfolioTransportFailure extends Error {
    kind;
    constructor(kind) {
        super(`The portfolio RPC transport failed: ${kind}.`);
        this.kind = kind;
        this.name = "PortfolioTransportFailure";
    }
}
/** Read-only transport: public DNS pin, built-in TLS roots, no redirect following, no compression, bounded size and time. */
export class PortfolioHttps {
    async post(url, body) {
        if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "")
            throw refused();
        const deadline = Date.now() + PORTFOLIO_REQUEST_TIMEOUT_MS;
        return await send(url, body, await resolvePinned(url, deadline), deadline);
    }
}
async function resolvePinned(url, deadline) {
    const host = unbracket(url.hostname), literal = isIP(host);
    if (literal !== 0) {
        if (!isPublicIp(host))
            throw refused();
        return { address: host, family: literal === 6 ? 6 : 4 };
    }
    let timer;
    let rows;
    try {
        rows = await Promise.race([lookup(host, { all: true, verbatim: true }), new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new PortfolioTransportFailure("timeout")), Math.max(1, deadline - Date.now()));
            })]);
    }
    catch (error) {
        throw error instanceof PortfolioTransportFailure ? error : new PortfolioTransportFailure("unreachable");
    }
    finally {
        clearTimeout(timer);
    }
    const selected = rows[0];
    if (selected === undefined)
        throw new PortfolioTransportFailure("unreachable");
    if (rows.some((row) => (row.family !== 4 && row.family !== 6) || !isPublicIp(row.address)))
        throw refused();
    return { address: selected.address, family: selected.family === 6 ? 6 : 4 };
}
function send(url, body, pinned, deadline) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (failure, value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (failure !== null || value === undefined)
                reject(failure ?? refused());
            else
                resolve(value);
        };
        const outgoing = request(url, {
            method: "POST", agent: false, family: pinned.family, ca: [...rootCertificates],
            headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity",
                "content-length": Buffer.byteLength(body).toString() },
            lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
        }, (incoming) => {
            const encoding = incoming.headers["content-encoding"], declared = incoming.headers["content-length"];
            if ((encoding !== undefined && encoding !== "identity") || (declared !== undefined &&
                (!/^(?:0|[1-9][0-9]{0,15})$/u.test(declared) || Number(declared) > PORTFOLIO_MAX_RESPONSE_BYTES))) {
                incoming.destroy();
                finish(refused());
                return;
            }
            const chunks = [];
            let size = 0;
            incoming.on("data", (chunk) => {
                size += chunk.length;
                if (size > PORTFOLIO_MAX_RESPONSE_BYTES) {
                    incoming.destroy();
                    finish(refused());
                    return;
                }
                chunks.push(chunk);
            });
            incoming.on("end", () => {
                let text;
                try {
                    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
                }
                catch {
                    finish(refused());
                    return;
                }
                finish(null, { status: incoming.statusCode ?? 0, contentType: String(incoming.headers["content-type"] ?? ""), body: text });
            });
            incoming.on("aborted", () => finish(new PortfolioTransportFailure("unreachable")));
            incoming.on("error", () => finish(new PortfolioTransportFailure("unreachable")));
        });
        const timer = setTimeout(() => { outgoing.destroy(); finish(new PortfolioTransportFailure("timeout")); }, Math.max(1, deadline - Date.now()));
        outgoing.on("socket", (socket) => socket.on("connect", () => {
            if (socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, pinned.address)) {
                outgoing.destroy();
                finish(refused());
            }
        }));
        outgoing.on("error", () => finish(new PortfolioTransportFailure("unreachable")));
        outgoing.end(body);
    });
}
function refused() { return new PortfolioTransportFailure("refused"); }
//# sourceMappingURL=https.js.map