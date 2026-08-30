import { spawn } from "node:child_process";
import { isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { AWAL_PROCESS_TIMEOUT_MS, resolveAwalBin } from "./awal-package.js";
const MAX_SEND_OUTPUT_BYTES = 1024 * 1024;
export class AwalDirectAdapter {
    binResolver;
    launch;
    timeoutMs;
    mode = "provider_atomic_send";
    constructor(binResolver = resolveAwalBin, launch = defaultSendLaunch, timeoutMs = AWAL_PROCESS_TIMEOUT_MS) {
        this.binResolver = binResolver;
        this.launch = launch;
        this.timeoutMs = timeoutMs;
    }
    assertCompatibleIntent(input) {
        if (pinnedAwalUsdcAtomic(input.amountDecimal) !== input.amountAtomic) {
            throw new ApnError("APN_PROVIDER_PROTOCOL", "The pinned wallet provider cannot encode this exact decimal amount safely.", { retryable: false, provider_version: "2.12.1" });
        }
    }
    async execute(input) {
        let script;
        try {
            script = await this.binResolver();
        }
        catch {
            return { disposition: "not_started", reason: "provider_binary_unavailable" };
        }
        const args = [
            script, "send", input.amountDecimal, input.recipient,
            "--chain", "base", "--asset", "usdc", "--json",
        ];
        return await new Promise((resolveResult) => {
            let child;
            try {
                child = this.launch(process.execPath, args, {
                    shell: false,
                    stdio: ["ignore", "pipe", "pipe"],
                });
            }
            catch {
                resolveResult({ disposition: "not_started", reason: "provider_child_not_created" });
                return;
            }
            let spawned = false;
            let settled = false;
            let size = 0;
            const chunks = [];
            const zeroChunks = () => { for (const chunk of chunks)
                chunk.fill(0); };
            const cleanup = () => {
                clearTimeout(timeout);
                child.stdout.removeListener("data", onStdout);
                child.stderr.removeListener("data", onStderr);
                child.removeListener("spawn", onSpawn);
                child.removeListener("error", onError);
                child.removeListener("close", onClose);
            };
            const finish = (result) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                zeroChunks();
                resolveResult(result);
            };
            const onSpawn = () => { spawned = true; };
            const onStdout = (chunk) => {
                const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
                if (Buffer.isBuffer(chunk))
                    chunk.fill(0);
                size += bytes.length;
                if (size > MAX_SEND_OUTPUT_BYTES) {
                    bytes.fill(0);
                    finish({ disposition: "ambiguous", reason: "provider_output_too_large" });
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
            const onError = () => finish({
                disposition: "ambiguous",
                reason: spawned ? "provider_process_lost" : "provider_launch_outcome_unknown",
            });
            const onClose = (code) => {
                if (code !== 0) {
                    finish({ disposition: "ambiguous", reason: "provider_exit_unclassified" });
                    return;
                }
                const stdout = Buffer.concat(chunks);
                try {
                    finish(parseAcknowledgement(stdout));
                }
                finally {
                    stdout.fill(0);
                }
            };
            const timeout = setTimeout(() => {
                finish({
                    disposition: "ambiguous",
                    reason: spawned ? "provider_process_timeout" : "provider_launch_outcome_unknown",
                });
                child.kill();
            }, this.timeoutMs);
            child.stdout.on("data", onStdout);
            child.stderr.on("data", onStderr);
            child.once("spawn", onSpawn);
            child.once("error", onError);
            child.once("close", onClose);
        });
    }
}
function pinnedAwalUsdcAtomic(amountDecimal) {
    const numeric = Number.parseFloat(amountDecimal);
    if (!Number.isFinite(numeric) || numeric <= 0)
        return null;
    const atomic = Number.isInteger(numeric) && numeric > 100
        ? Math.floor(numeric)
        : Math.floor(numeric * 1_000_000);
    return Number.isSafeInteger(atomic) && atomic > 0 ? atomic.toString() : null;
}
const defaultSendLaunch = (executable, args, options) => spawn(executable, [...args], {
    shell: options.shell,
    stdio: [...options.stdio],
});
function parseAcknowledgement(bytes) {
    let value;
    try {
        value = JSON.parse(bytes.toString("utf8"));
    }
    catch {
        return { disposition: "ambiguous", reason: "provider_response_malformed" };
    }
    if (!isPlainRecord(value) || typeof value.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value.transactionHash)) {
        return { disposition: "ambiguous", reason: "provider_transaction_identity_missing" };
    }
    return { disposition: "acknowledged", transactionHash: value.transactionHash };
}
//# sourceMappingURL=awal-direct-adapter.js.map