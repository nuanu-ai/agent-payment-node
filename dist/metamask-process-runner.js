import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { ApnError } from "./errors.js";
import { isPlainRecord, sha256 } from "./canonical.js";
import { classifyMetaMaskPendingNotices, parseMetaMaskProcessOutput } from "./metamask-process-output.js";
import { METAMASK_FOREGROUND_TIMEOUT_MS, METAMASK_PROCESS_TIMEOUT_MS, resolveMetaMaskBin, } from "./metamask-package.js";
const MAX_JSON_BYTES = 1024 * 1024;
const nativeFailureIdentifiers = new WeakMap();
/** Internal one-use observation of this runner's rejected invocation. Never exposes captured output or changes rejection. */
export function takeMetaMaskNativeProcessFailureIdentifiers(error) {
    if (!(error instanceof ApnError))
        return undefined;
    const value = nativeFailureIdentifiers.get(error);
    nativeFailureIdentifiers.delete(error);
    return value;
}
function observeNativeFailure(bytes) {
    let parsed = parseMetaMaskProcessOutput(bytes);
    if (parsed === null) {
        const text = bytes.toString("utf8"), boundary = text.lastIndexOf("\n");
        if (boundary < 0)
            return undefined;
        const tail = text.slice(boundary + 1).trim();
        if (!tail.startsWith("{"))
            return undefined;
        try {
            JSON.parse(tail);
            return undefined;
        }
        catch (error) {
            if (!(error instanceof SyntaxError))
                return undefined;
            const atEnd = error.message === "Unexpected end of JSON input" ||
                / at position ([0-9]+) /u.exec(error.message)?.[1] === String(tail.length);
            if (!atEnd)
                return undefined;
        }
        const prefix = Buffer.from(text.slice(0, boundary), "utf8");
        try {
            parsed = parseMetaMaskProcessOutput(prefix);
        }
        finally {
            prefix.fill(0);
        }
        // Only complete normal notice frames before a cut final frame can supply IDs.
        if (parsed === null || parsed.envelope !== null || parsed.notices.length === 0)
            return undefined;
    }
    if (parsed === null)
        return undefined;
    const notice = classifyMetaMaskPendingNotices(parsed.notices);
    if (notice.disposition === "invalid")
        return undefined;
    const data = parsed.envelope?.data;
    if (parsed.envelope !== null && !isPlainRecord(data))
        return undefined;
    if (isPlainRecord(data)) {
        if (data.mode !== "server" || typeof data.address !== "string" || !/^0x[a-fA-F0-9]{40}$/u.test(data.address))
            return undefined;
        if (data.hash !== undefined && (typeof data.hash !== "string" || !/^0x[a-fA-F0-9]{64}$/u.test(data.hash)))
            return undefined;
        if (data.pollingId !== undefined && (typeof data.pollingId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.pollingId)))
            return undefined;
        if (data.chainId !== undefined && (typeof data.chainId !== "number" || !Number.isSafeInteger(data.chainId) || data.chainId < 1))
            return undefined;
        if (data.projectId !== undefined && (typeof data.projectId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.projectId)))
            return undefined;
        if (notice.disposition === "pending" && data.pollingId !== undefined && data.pollingId !== notice.recoveryToken)
            return undefined;
    }
    const requestId = isPlainRecord(data) && typeof data.pollingId === "string" ? data.pollingId : notice.disposition === "pending" ? notice.recoveryToken : undefined;
    const transactionHash = isPlainRecord(data) && typeof data.hash === "string" ? data.hash.toLowerCase() : undefined;
    if (requestId === undefined && transactionHash === undefined)
        return undefined;
    return Object.freeze({ ...(requestId === undefined ? {} : { requestId }), ...(transactionHash === undefined ? {} : { transactionHash }),
        ...(isPlainRecord(data) ? { sender: data.address.toLowerCase(),
            ...(typeof data.chainId === "number" ? { chainId: data.chainId } : {}),
            ...(typeof data.projectId === "string" ? { vendorProjectHash: sha256(data.projectId) } : {}) } : {}) });
}
export class NodeMetaMaskProcessRunner {
    binResolver;
    capturedLaunch;
    foregroundLaunch;
    jsonTimeoutMs;
    foregroundTimeoutMs;
    openTerminal;
    closeTerminal;
    constructor(binResolver = resolveMetaMaskBin, capturedLaunch = defaultCapturedLaunch, foregroundLaunch = defaultForegroundLaunch, jsonTimeoutMs = METAMASK_PROCESS_TIMEOUT_MS, foregroundTimeoutMs = METAMASK_FOREGROUND_TIMEOUT_MS, openTerminal = defaultOpenTerminal, closeTerminal = closeSync) {
        this.binResolver = binResolver;
        this.capturedLaunch = capturedLaunch;
        this.foregroundLaunch = foregroundLaunch;
        this.jsonTimeoutMs = jsonTimeoutMs;
        this.foregroundTimeoutMs = foregroundTimeoutMs;
        this.openTerminal = openTerminal;
        this.closeTerminal = closeTerminal;
    }
    async runJson(argv, timeoutMs = this.jsonTimeoutMs) {
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 305_000)
            throw providerProtocol();
        const script = await this.binResolver();
        return await new Promise((resolveResult, reject) => {
            let child;
            try {
                child = this.capturedLaunch(process.execPath, [script, ...argv], {
                    shell: false,
                    stdio: ["ignore", "pipe", "pipe"],
                });
            }
            catch {
                reject(providerUnavailable("The MetaMask Agent Wallet process could not start."));
                return;
            }
            const chunks = [];
            let size = 0;
            let settled = false;
            const zero = () => { for (const chunk of chunks)
                chunk.fill(0); };
            const cleanup = () => {
                clearTimeout(timeout);
                child.stdout.removeListener("data", onStdout);
                child.stderr.removeListener("data", onStderr);
                child.removeListener("error", onError);
                child.removeListener("close", onClose);
            };
            const fail = (error, observeIdentifiers = false) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                if (observeIdentifiers) {
                    const bytes = Buffer.concat(chunks);
                    try {
                        const observation = observeNativeFailure(bytes);
                        if (observation !== undefined)
                            nativeFailureIdentifiers.set(error, observation);
                    }
                    finally {
                        bytes.fill(0);
                    }
                }
                zero();
                reject(error);
            };
            const onStdout = (chunk) => {
                const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
                if (Buffer.isBuffer(chunk))
                    chunk.fill(0);
                size += bytes.length;
                if (size > MAX_JSON_BYTES) {
                    bytes.fill(0);
                    fail(providerProtocol());
                    child.kill();
                    return;
                }
                chunks.push(bytes);
            };
            const onStderr = (chunk) => {
                if (Buffer.isBuffer(chunk))
                    chunk.fill(0);
                else
                    Buffer.from(chunk, "utf8").fill(0);
            };
            const onError = () => fail(providerUnavailable("The MetaMask Agent Wallet process could not start."), true);
            const onClose = (code) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                const stdout = Buffer.concat(chunks);
                zero();
                resolveResult({ exitCode: code ?? 1, stdout });
            };
            const timeout = setTimeout(() => {
                fail(providerUnavailable("The MetaMask Agent Wallet process timed out safely."), true);
                child.kill();
            }, timeoutMs);
            child.stdout.on("data", onStdout);
            child.stderr.on("data", onStderr);
            child.once("error", onError);
            child.once("close", onClose);
        });
    }
    async runForeground(argv) {
        const script = await this.binResolver();
        let ttyFd;
        try {
            ttyFd = this.openTerminal();
        }
        catch {
            throw new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "A foreground terminal is required for MetaMask login.");
        }
        try {
            return await new Promise((resolveResult, reject) => {
                let child;
                try {
                    child = this.foregroundLaunch(process.execPath, [script, ...argv], {
                        shell: false,
                        stdio: [ttyFd, ttyFd, ttyFd],
                    });
                }
                catch {
                    reject(providerUnavailable("The MetaMask Agent Wallet foreground process could not start."));
                    return;
                }
                let settled = false;
                const cleanup = () => {
                    clearTimeout(timeout);
                    child.removeListener("error", onError);
                    child.removeListener("close", onClose);
                };
                const onError = () => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    reject(providerUnavailable("The MetaMask Agent Wallet foreground process was lost."));
                };
                const onClose = (code) => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    resolveResult(code ?? 1);
                };
                const timeout = setTimeout(() => {
                    if (settled)
                        return;
                    settled = true;
                    cleanup();
                    child.kill();
                    reject(providerUnavailable("MetaMask foreground login timed out safely."));
                }, this.foregroundTimeoutMs);
                child.once("error", onError);
                child.once("close", onClose);
            });
        }
        finally {
            this.closeTerminal(ttyFd);
        }
    }
}
const defaultCapturedLaunch = (executable, args, options) => spawn(executable, [...args], {
    shell: options.shell,
    stdio: [...options.stdio],
});
const defaultForegroundLaunch = (executable, args, options) => spawn(executable, [...args], {
    shell: options.shell,
    stdio: [...options.stdio],
});
function defaultOpenTerminal() {
    return openSync("/dev/tty", "r+");
}
function providerProtocol() {
    return new ApnError("APN_PROVIDER_PROTOCOL", "The MetaMask Agent Wallet response exceeded its accepted contract.", { retryable: false });
}
function providerUnavailable(message) {
    return new ApnError("APN_PROVIDER_UNAVAILABLE", message, { retryable: true });
}
//# sourceMappingURL=metamask-process-runner.js.map