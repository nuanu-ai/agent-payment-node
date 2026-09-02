import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { ApnError } from "./errors.js";
import { METAMASK_FOREGROUND_TIMEOUT_MS, METAMASK_PROCESS_TIMEOUT_MS, resolveMetaMaskBin, } from "./metamask-package.js";
const MAX_JSON_BYTES = 1024 * 1024;
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
            const fail = (error) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
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
            const onError = () => fail(providerUnavailable("The MetaMask Agent Wallet process could not start."));
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
                fail(providerUnavailable("The MetaMask Agent Wallet process timed out safely."));
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