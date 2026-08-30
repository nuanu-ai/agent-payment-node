import { spawn } from "node:child_process";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { accountBindingHash, coinbaseDirectCapabilitySnapshot } from "./provider-profile.js";
import { AwalDirectAdapter } from "./awal-direct-adapter.js";
import { AwalX402Adapter } from "./awal-x402-adapter.js";
export const AWAL_PROVIDER_ID = "coinbase-agentic-wallet";
export { AWAL_BIN, AWAL_INTEGRITY, AWAL_PROCESS_TIMEOUT_MS, AWAL_SHASUM, AWAL_VERSION, resolveAwalBin, } from "./awal-package.js";
import { AWAL_PROCESS_TIMEOUT_MS, resolveAwalBin } from "./awal-package.js";
const MAX_PROVIDER_OUTPUT_BYTES = 1024 * 1024;
const MAX_PROVIDER_CLASSIFICATION_BYTES = 4096;
export class NodeAwalProcessRunner {
    binResolver;
    launch;
    timeoutMs;
    constructor(binResolver = resolveAwalBin, launch = defaultLaunch, timeoutMs = AWAL_PROCESS_TIMEOUT_MS) {
        this.binResolver = binResolver;
        this.launch = launch;
        this.timeoutMs = timeoutMs;
    }
    async run(argv, sensitive) {
        const script = await this.binResolver();
        return await new Promise((resolveResult, reject) => {
            let child;
            try {
                child = this.launch(process.execPath, [script, ...argv], {
                    shell: false,
                    stdio: ["ignore", "pipe", "pipe"],
                });
            }
            catch {
                reject(providerFailure("The wallet provider process could not start."));
                return;
            }
            const chunks = [];
            const classificationChunks = [];
            let size = 0;
            let classificationSize = 0;
            let classificationTruncated = false;
            const classifyLogin = sensitive && isLoginArgv(argv);
            const loginStdoutMatcher = newAsciiMatcher();
            const loginStderrMatcher = newAsciiMatcher();
            let settled = false;
            const zeroChunks = () => {
                for (const chunk of chunks)
                    chunk.fill(0);
                for (const chunk of classificationChunks)
                    chunk.fill(0);
            };
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
                zeroChunks();
                reject(error);
            };
            const onStdout = (chunk) => {
                const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
                if (Buffer.isBuffer(chunk))
                    chunk.fill(0);
                if (classifyLogin)
                    consumeAsciiMatch(loginStdoutMatcher, bytes);
                if (sensitive) {
                    bytes.fill(0);
                    return;
                }
                size += bytes.length;
                if (size > MAX_PROVIDER_OUTPUT_BYTES) {
                    bytes.fill(0);
                    fail(providerProtocolError());
                    child.kill();
                    return;
                }
                chunks.push(bytes);
            };
            const onStderr = (chunk) => {
                const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
                if (Buffer.isBuffer(chunk))
                    chunk.fill(0);
                if (classifyLogin)
                    consumeAsciiMatch(loginStderrMatcher, bytes);
                if (sensitive || classificationTruncated) {
                    bytes.fill(0);
                    return;
                }
                classificationSize += bytes.length;
                if (classificationSize > MAX_PROVIDER_CLASSIFICATION_BYTES) {
                    classificationTruncated = true;
                    bytes.fill(0);
                    for (const retained of classificationChunks)
                        retained.fill(0);
                    classificationChunks.length = 0;
                    return;
                }
                classificationChunks.push(bytes);
            };
            const onError = () => fail(providerFailure("The wallet provider process could not start."));
            const onClose = (code) => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                const stdout = sensitive ? Buffer.alloc(0) : Buffer.concat(chunks);
                const exitCode = code ?? 1;
                const classification = classificationTruncated
                    ? undefined
                    : classifyOptionalAddressFailure(argv, exitCode, Buffer.concat(classificationChunks));
                const loginDisposition = exitCode === 0 && (loginStdoutMatcher.found || loginStderrMatcher.found)
                    ? "already_authenticated"
                    : undefined;
                zeroChunks();
                resolveResult({
                    exitCode,
                    stdout,
                    ...(classification === undefined ? {} : { optionalFailure: classification }),
                    ...(loginDisposition === undefined ? {} : { loginDisposition }),
                });
            };
            const timeout = setTimeout(() => {
                fail(providerFailure("The wallet provider process timed out safely."));
                child.kill();
            }, this.timeoutMs);
            child.stdout.on("data", onStdout);
            child.stderr.on("data", onStderr);
            child.once("error", onError);
            child.once("close", onClose);
        });
    }
}
const defaultLaunch = (executable, args, options) => spawn(executable, [...args], {
    shell: options.shell,
    stdio: [...options.stdio],
});
export class AwalProcessAdapter {
    runner;
    direct;
    x402;
    capabilities = coinbaseDirectCapabilitySnapshot();
    constructor(runner = new NodeAwalProcessRunner(), direct = new AwalDirectAdapter(), x402 = new AwalX402Adapter()) {
        this.runner = runner;
        this.direct = direct;
        this.x402 = x402;
    }
    bundle() {
        return {
            provider_id: AWAL_PROVIDER_ID,
            trust_class: "provider_managed_non_custodial_tee",
            capabilities: this.capabilities,
            lifecycle: this,
            reads: this,
            direct: this.direct,
            x402: this.x402,
            evidence: { owner: "apn" },
        };
    }
    async connect(foreground) {
        const identity = await foreground.readIdentity();
        const disposition = await this.runSensitive({ kind: "login", identity });
        if (disposition === "already_authenticated")
            return;
        const challenge = await foreground.readChallengeResponse();
        await this.runSensitive({ kind: "verify", challenge });
    }
    async logout() {
        await this.runSensitive({ kind: "logout" });
    }
    async observeBalance() {
        const result = await this.runner.run(argv({ kind: "balance" }), false);
        try {
            if (result.exitCode !== 0)
                throw sessionFailure();
            return parseBalance(result.stdout);
        }
        finally {
            result.stdout.fill(0);
        }
    }
    async probeStatus() {
        await this.runSensitive({ kind: "status" });
    }
    async crossCheckAddress(expected) {
        const result = await this.runner.run(argv({ kind: "address" }), false);
        try {
            if (result.exitCode !== 0) {
                if (result.optionalFailure === "unsupported" || result.optionalFailure === "unavailable")
                    return;
                throw sessionFailure();
            }
            const value = result.stdout.toString("utf8").trim();
            if (!/^0x[0-9a-fA-F]{40}$/u.test(value) || value.toLowerCase() !== expected.toLowerCase())
                providerProtocol();
        }
        finally {
            result.stdout.fill(0);
        }
    }
    async runSensitive(command) {
        const result = await this.runner.run(argv(command), true);
        result.stdout.fill(0);
        if (result.loginDisposition !== undefined && command.kind !== "login")
            providerProtocol();
        if (result.exitCode !== 0)
            throw command.kind === "status" ? sessionFailure() : providerFailure("Wallet provider authentication failed safely.");
        return result.loginDisposition;
    }
}
const ALREADY_SIGNED_IN = Buffer.from("already signed in", "ascii");
const ALREADY_SIGNED_IN_PREFIX = buildPrefixTable(ALREADY_SIGNED_IN);
function newAsciiMatcher() {
    return { matched: 0, found: false };
}
function consumeAsciiMatch(state, bytes) {
    if (state.found)
        return;
    for (const byte of bytes) {
        const folded = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
        while (state.matched > 0 && folded !== ALREADY_SIGNED_IN[state.matched]) {
            state.matched = ALREADY_SIGNED_IN_PREFIX[state.matched - 1] ?? 0;
        }
        if (folded === ALREADY_SIGNED_IN[state.matched])
            state.matched += 1;
        if (state.matched === ALREADY_SIGNED_IN.length) {
            state.found = true;
            state.matched = 0;
            return;
        }
    }
}
function buildPrefixTable(pattern) {
    const prefix = new Array(pattern.length).fill(0);
    for (let index = 1, matched = 0; index < pattern.length; index += 1) {
        while (matched > 0 && pattern[index] !== pattern[matched])
            matched = prefix[matched - 1] ?? 0;
        if (pattern[index] === pattern[matched])
            matched += 1;
        prefix[index] = matched;
    }
    return prefix;
}
function isLoginArgv(commandArgv) {
    return commandArgv.length === 4 && commandArgv[0] === "auth" && commandArgv[1] === "login" &&
        commandArgv[2] !== undefined && commandArgv[3] === "--json";
}
function argv(command) {
    switch (command.kind) {
        case "status": return ["status", "--json"];
        case "login": return ["auth", "login", command.identity, "--json"];
        case "verify": return ["auth", "verify", command.challenge, "--json"];
        case "logout": return ["auth", "logout", "--json"];
        case "balance": return ["balance", "--chain", "base", "--asset", "usdc", "--json"];
        case "address": return ["address", "--chain", "base"];
    }
}
function parseBalance(bytes) {
    let value;
    try {
        value = JSON.parse(bytes.toString("utf8"));
    }
    catch {
        throw providerProtocol();
    }
    if (!isPlainRecord(value) || !exactKeys(value, ["address", "chain", "balances", "timestamp"]) ||
        !isPlainRecord(value.balances) || !exactKeys(value.balances, ["USDC"]) ||
        !isPlainRecord(value.balances.USDC) || !exactKeys(value.balances.USDC, ["raw", "formatted", "decimals"]))
        providerProtocol();
    const usdc = value.balances.USDC;
    if (typeof value.address !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value.address) ||
        (value.chain !== "Base" && value.chain !== "base") ||
        typeof usdc.raw !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(usdc.raw) ||
        typeof usdc.formatted !== "string" || usdc.formatted.length === 0 || usdc.decimals !== 6 ||
        typeof value.timestamp !== "string" || !isTimestamp(value.timestamp))
        providerProtocol();
    const address = value.address;
    return {
        address,
        account_binding_hash: accountBindingHash(AWAL_PROVIDER_ID, address),
        chain: "base",
        asset: "USDC",
        raw: usdc.raw,
        formatted: usdc.formatted,
        decimals: 6,
        observed_at: value.timestamp,
    };
}
function isTimestamp(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function classifyOptionalAddressFailure(commandArgv, exitCode, stderr) {
    try {
        if (exitCode === 0 || commandArgv.length !== 3 || commandArgv[0] !== "address" ||
            commandArgv[1] !== "--chain" || commandArgv[2] !== "base")
            return undefined;
        const message = stderr.toString("utf8").trim();
        if (message === "error: unknown command 'address'")
            return "unsupported";
        if (message === "error: address command unavailable")
            return "unavailable";
        return undefined;
    }
    finally {
        stderr.fill(0);
    }
}
function providerProtocol() {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "The wallet provider returned an unsupported safe response.", { retryable: false });
}
function providerProtocolError() {
    return new ApnError("APN_PROVIDER_PROTOCOL", "The wallet provider returned an unsupported safe response.", { retryable: false });
}
function sessionFailure() {
    return new ApnError("APN_PROVIDER_SESSION_REQUIRED", "The wallet provider session is unavailable.", { retryable: true });
}
function providerFailure(message) {
    return new ApnError("APN_PROVIDER_UNAVAILABLE", message, { retryable: true });
}
//# sourceMappingURL=awal-process-adapter.js.map