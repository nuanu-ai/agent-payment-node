import { request as httpsRequest } from "node:https";
import { performance } from "node:perf_hooks";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl, resolvePublicAddresses, sameIpAddress } from "../network-policy.js";
/** Finite public HTTPS transport: DNS pinning, default TLS, no redirects and no retries. */
export class GaslessHttps {
    active = 0;
    waiting = [];
    async request(endpointInput, method, body, maximumBytes, code) {
        const expires = performance.now() + 15_000;
        const endpoint = parsePublicHttpsUrl(endpointInput, code, "Gasless endpoint", 2048);
        if (body !== null && Buffer.byteLength(body, "utf8") > 256 * 1024)
            throw failure(code, "request_size");
        if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024) {
            throw failure(code, "response_bound");
        }
        const controller = new AbortController(), expired = failure(code, "request_deadline");
        const deadline = { signal: controller.signal, assert() {
                if (performance.now() >= expires)
                    controller.abort(expired);
                if (controller.signal.aborted)
                    throw expired;
            } };
        deadline.assert();
        const timer = setTimeout(() => controller.abort(expired), Math.max(1, expires - performance.now()));
        let release;
        try {
            release = await this.acquire(deadline, code);
            deadline.assert();
            const addresses = await abortable(resolvePublicAddresses(endpoint, code, "Gasless endpoint"), deadline.signal);
            deadline.assert();
            return await send(endpoint, method, body, addresses, maximumBytes, deadline, code);
        }
        finally {
            clearTimeout(timer);
            release?.();
        }
    }
    async acquire(deadline, code) {
        deadline.assert();
        if (this.active < 2) {
            this.active += 1;
            return this.releaser();
        }
        if (this.waiting.length >= 32)
            throw failure(code, "concurrency_bound");
        return await new Promise((resolve, reject) => {
            const cancel = () => {
                const index = this.waiting.indexOf(waiter);
                if (index !== -1)
                    this.waiting.splice(index, 1);
                deadline.signal.removeEventListener("abort", cancel);
                reject(deadline.signal.reason);
            };
            const waiter = { grant: () => {
                    deadline.signal.removeEventListener("abort", cancel);
                    try {
                        deadline.assert();
                    }
                    catch (error) {
                        reject(error);
                        return false;
                    }
                    this.active += 1;
                    resolve(this.releaser());
                    return true;
                } };
            this.waiting.push(waiter);
            deadline.signal.addEventListener("abort", cancel, { once: true });
            if (deadline.signal.aborted)
                cancel();
        });
    }
    releaser() {
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.active -= 1;
            while (this.active < 2 && this.waiting.length !== 0)
                this.waiting.shift().grant();
        };
    }
}
/** DNS lookup itself may finish later, but its abandoned result can never start an HTTP request. */
function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        promise.then(value => {
            signal.removeEventListener("abort", abort);
            if (signal.aborted)
                reject(signal.reason);
            else
                resolve(value);
        }, error => { signal.removeEventListener("abort", abort); reject(error); });
        if (signal.aborted)
            abort();
    });
}
function failure(code, reason) {
    const publicCode = code === "APN_RPC_CONFIG" ? "APN_RPC_AMBIGUOUS" : "APN_PROVIDER_UNAVAILABLE";
    return new ApnError(publicCode, `Gasless transport failed: ${reason}.`);
}
function send(endpoint, method, body, addresses, maximumBytes, deadline, code) {
    return new Promise((resolve, reject) => {
        deadline.assert();
        const selected = addresses[0];
        if (selected === undefined) {
            reject(failure(code, "DNS_empty"));
            return;
        }
        let settled = false, request;
        const abort = () => finish(deadline.signal.reason);
        const finish = (error, value) => {
            if (settled)
                return;
            settled = true;
            deadline.signal.removeEventListener("abort", abort);
            if (error !== null) {
                request?.destroy();
                reject(error instanceof ApnError ? error : failure(code, "request_interrupted"));
            }
            else
                resolve(value);
        };
        const live = () => {
            if (settled)
                return false;
            try {
                deadline.assert();
                return true;
            }
            catch (error) {
                finish(error);
                return false;
            }
        };
        deadline.signal.addEventListener("abort", abort, { once: true });
        try {
            request = httpsRequest(endpoint, {
                method, agent: false, family: selected.family,
                headers: {
                    accept: "application/json", "accept-encoding": "identity",
                    ...(body === null ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString() }),
                },
                lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
            }, (response) => {
                if (!live()) {
                    response.destroy();
                    return;
                }
                const status = response.statusCode ?? 0;
                const encoding = response.headers["content-encoding"];
                if ((status >= 300 && status < 400) || (encoding !== undefined && encoding !== "identity")) {
                    finish(failure(code, "redirect_or_encoding"));
                    return;
                }
                const declared = response.headers["content-length"];
                if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || BigInt(declared) > BigInt(maximumBytes))) {
                    finish(failure(code, "response_size"));
                    return;
                }
                let size = 0;
                const chunks = [];
                response.on("data", (chunk) => {
                    if (!live())
                        return;
                    size += chunk.length;
                    if (size > maximumBytes) {
                        finish(failure(code, "response_size"));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("end", () => {
                    if (!live())
                        return;
                    try {
                        if (declared !== undefined && BigInt(declared) !== BigInt(size)) {
                            finish(failure(code, "response_length"));
                            return;
                        }
                        finish(null, { status, body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)) });
                    }
                    catch {
                        finish(failure(code, "response_utf8"));
                    }
                });
                response.on("aborted", () => finish(failure(code, "response_aborted")));
                response.on("error", () => finish(failure(code, "response_interrupted")));
            });
            request.on("socket", (socket) => socket.on("connect", () => {
                if (!live())
                    return;
                if (socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address)) {
                    finish(failure(code, "pinned_address_changed"));
                }
            }));
            request.on("error", () => finish(failure(code, "request_interrupted")));
            if (live())
                request.end(body ?? undefined);
        }
        catch (error) {
            finish(error);
        }
    });
}
//# sourceMappingURL=https.js.map