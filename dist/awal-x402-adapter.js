import { spawn } from "node:child_process";
import { canonicalJson, isPlainRecord, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { providerX402InvocationIntentHash } from "./provider-x402-model.js";
import { canonicalizeNormalizedProviderJson } from "./normalized-provider-json.js";
import { resolveAwalBin } from "./awal-package.js";
export const AWAL_X402_PROCESS_TIMEOUT_MS = 210_000;
export const AWAL_X402_INTERNAL_TIMEOUT_MS = 180_000;
export const AWAL_X402_SHUTDOWN_MARGIN_MS = 30_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_STATUS_TEXT_BYTES = 512;
const MAX_PROVIDER_ATOMIC = 9007199254740991n;
const REQUIRED_ENVELOPE_KEYS = ["status", "data", "paymentMade", "amountPaid"];
const KNOWN_ENVELOPE_KEYS = new Set([...REQUIRED_ENVELOPE_KEYS, "statusText"]);
const CONFLICTING_OUTER_KEYS = new Set([
    "status", "statustext", "data", "paymentmade", "amountpaid",
    "httpstatus", "statuscode", "amountpaidatomic",
    "result", "response", "payload", "body", "sellerresult",
]);
export class AwalX402Adapter {
    binResolver;
    launch;
    timeoutMs;
    mode = "provider_atomic_paid_fetch";
    script;
    constructor(binResolver = resolveAwalBin, launch = defaultLaunch, timeoutMs = AWAL_X402_PROCESS_TIMEOUT_MS) {
        this.binResolver = binResolver;
        this.launch = launch;
        this.timeoutMs = timeoutMs;
        if (timeoutMs !== AWAL_X402_PROCESS_TIMEOUT_MS) {
            throw new ApnError("APN_PROVIDER_PROTOCOL", "The pinned x402 provider deadline is invalid.");
        }
    }
    assertCompatibleIntent(input) {
        providerAtomic(input.amountAtomic);
    }
    async prime() {
        this.script ??= await this.binResolver();
    }
    async execute(input) {
        providerAtomic(input.amountAtomic);
        try {
            await this.prime();
        }
        catch {
            return { disposition: "not_started", reason: "provider_binary_unavailable" };
        }
        const script = this.script;
        if (script === undefined)
            return { disposition: "not_started", reason: "provider_binary_unavailable" };
        const args = [
            script, "x402", "pay", input.url, "-X", "GET", "--max-amount", input.amountAtomic,
            "--scheme", "exact", "--correlation-id", input.correlationId, "--json",
        ];
        return await this.runChild(args, input, script);
    }
    async runChild(args, input, script) {
        return await new Promise((resolveResult) => {
            let child;
            try {
                child = this.launch(process.execPath, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
            }
            catch {
                resolveResult({ disposition: "not_started", reason: "provider_child_not_created" });
                return;
            }
            let spawned = false;
            let settled = false;
            let size = 0;
            const chunks = [];
            const invocation = () => {
                const output = Buffer.concat(chunks);
                try {
                    return {
                        correlation_id: input.correlationId,
                        request_digest: input.requestDigest,
                        intent_binding_hash: providerX402InvocationIntentHash({
                            correlationId: input.correlationId,
                            canonicalUrl: input.url,
                            amountAtomic: input.amountAtomic,
                            requestDigest: input.requestDigest,
                        }),
                        child_identity_hash: sha256(canonicalJson({
                            executable: process.execPath,
                            script,
                            argv: args,
                            pid: child.pid ?? null,
                            requestDigest: input.requestDigest,
                        })),
                        output_sha256: sha256(output),
                        output_byte_length: output.byteLength.toString(),
                    };
                }
                finally {
                    output.fill(0);
                }
            };
            const zero = () => { for (const chunk of chunks)
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
                zero();
                resolveResult(result);
            };
            const onSpawn = () => { spawned = true; };
            const onStdout = (chunk) => {
                const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
                if (Buffer.isBuffer(chunk))
                    chunk.fill(0);
                size += bytes.byteLength;
                if (size > MAX_OUTPUT_BYTES) {
                    bytes.fill(0);
                    finish({ disposition: "ambiguous", reason: "provider_output_too_large", invocation: invocation() });
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
                invocation: invocation(),
            });
            const onClose = (code) => {
                const evidence = invocation();
                if (!spawned || code !== 0) {
                    finish({
                        disposition: "ambiguous",
                        reason: spawned ? "provider_exit_unclassified" : "provider_launch_outcome_unknown",
                        invocation: evidence,
                    });
                    return;
                }
                const output = Buffer.concat(chunks);
                try {
                    const result = parseSellerResult(output, input.amountAtomic);
                    finish({ disposition: "seller_result", invocation: evidence, result });
                }
                catch {
                    finish({ disposition: "ambiguous", reason: "provider_result_invalid", invocation: evidence });
                }
                finally {
                    output.fill(0);
                }
            };
            const timeout = setTimeout(() => {
                finish({
                    disposition: "ambiguous",
                    reason: spawned ? "provider_process_timeout" : "provider_launch_outcome_unknown",
                    invocation: invocation(),
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
function parseSellerResult(bytes, expectedAmount) {
    let value;
    try {
        value = JSON.parse(bytes.toString("utf8"));
    }
    catch {
        throw protocol();
    }
    if (!isPlainRecord(value))
        throw protocol();
    validateEnvelopeKeys(value);
    if (!Number.isSafeInteger(value.status) || Number(value.status) < 200 || Number(value.status) > 299 ||
        (Object.hasOwn(value, "statusText") && (typeof value.statusText !== "string" || Buffer.byteLength(value.statusText, "utf8") > MAX_STATUS_TEXT_BYTES)) ||
        value.paymentMade !== true || canonicalProviderAmount(value.amountPaid) !== expectedAmount)
        throw protocol();
    let canonical;
    try {
        canonical = canonicalizeNormalizedProviderJson(value.data);
    }
    catch {
        throw protocol();
    }
    const length = Buffer.byteLength(canonical, "utf8");
    if (length > MAX_OUTPUT_BYTES)
        throw protocol();
    return {
        classification: "normalized_provider_json",
        http_status: String(value.status),
        payment_made: true,
        amount_paid_atomic: expectedAmount,
        canonical_json: canonical,
        byte_length: length.toString(),
        sha256: sha256(canonical),
    };
}
function validateEnvelopeKeys(value) {
    for (const required of REQUIRED_ENVELOPE_KEYS)
        if (!Object.hasOwn(value, required))
            throw protocol();
    const keyShape = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string")
            throw protocol();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
            throw protocol();
        const compact = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
        if (!KNOWN_ENVELOPE_KEYS.has(key) && CONFLICTING_OUTER_KEYS.has(compact))
            throw protocol();
        Object.defineProperty(keyShape, key, { value: null, enumerable: true });
    }
    try {
        canonicalizeNormalizedProviderJson(keyShape);
    }
    catch {
        throw protocol();
    }
}
function providerAtomic(value) {
    if (!/^[1-9][0-9]*$/u.test(value))
        throw protocol();
    const atomic = BigInt(value);
    if (atomic < 1n || atomic > MAX_PROVIDER_ATOMIC)
        throw protocol();
    const numeric = Number(atomic);
    if (!Number.isSafeInteger(numeric) || BigInt(numeric) !== atomic)
        throw protocol();
    return numeric;
}
function canonicalProviderAmount(value) {
    if (typeof value === "string") {
        try {
            providerAtomic(value);
            return value;
        }
        catch {
            return null;
        }
    }
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value.toString()
        : null;
}
function protocol() {
    return new ApnError("APN_PROVIDER_PROTOCOL", "The wallet provider returned an unsupported safe x402 response.");
}
const defaultLaunch = (executable, args, options) => spawn(executable, [...args], {
    shell: options.shell,
    stdio: [...options.stdio],
});
//# sourceMappingURL=awal-x402-adapter.js.map