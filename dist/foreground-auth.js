import { isatty } from "node:tty";
import { ApnError } from "./errors.js";
const MAX_AUTH_INPUT_BYTES = 512;
export class TtyForegroundAuthentication {
    openTerminal;
    isTerminal;
    constructor(options = {}) {
        this.openTerminal = options.openTerminal ?? openAuthTerminal;
        this.isTerminal = options.isTerminal ?? isatty;
    }
    async readIdentity() {
        return await this.prompt("Provider account email: ", validateIdentity);
    }
    async readChallengeResponse() {
        return await this.prompt("Provider one-time verification code: ", validateChallenge, true);
    }
    async confirmRebind(input) {
        const phrase = `REBIND APN PROFILE ${input.revision}`;
        const prompt = [
            "\nAgent Payment Node profile rebind",
            `Profile: ${input.profile}`,
            `Current address: ${input.current_address}`,
            `Observed address: ${input.observed_address}`,
            `Current capability hash: ${input.current_capability_hash}`,
            `Observed capability hash: ${input.observed_capability_hash}`,
            `Current trust class: ${input.current_trust_class}`,
            `Observed trust class: ${input.observed_trust_class}`,
            `Type exactly: ${phrase}`,
            "> ",
        ].join("\n");
        return await this.prompt(prompt, (value) => value === phrase ? value : invalidAuth()) === phrase;
    }
    async prompt(label, validate, secret = false) {
        let terminal;
        try {
            terminal = await this.openTerminal();
        }
        catch {
            throw foregroundFailure();
        }
        let bytes;
        try {
            if (!this.isTerminal(terminal.fd))
                throw foregroundFailure();
            await terminal.write(label);
            bytes = secret ? await terminal.readSecretLine() : await terminal.readLine();
            if (secret)
                await terminal.write("\n");
            if (bytes.length === 0 || bytes.length > MAX_AUTH_INPUT_BYTES)
                invalidAuth();
            return validate(bytes.toString("utf8"));
        }
        finally {
            bytes?.fill(0);
            await terminal.close();
        }
    }
}
async function openAuthTerminal() {
    const input = process.stdin;
    const output = process.stderr;
    if (input.isTTY !== true || output.isTTY !== true)
        throw new Error("foreground terminal unavailable");
    return {
        fd: input.fd,
        write: async (contents) => await new Promise((resolve, reject) => {
            output.write(contents, (error) => error === null || error === undefined ? resolve() : reject(error));
        }),
        readLine: async () => await readLine(input),
        readSecretLine: async () => await readSecretLine(input),
        close: async () => { input.pause(); },
    };
}
export async function readSecretLine(input, signals = process) {
    const wasRaw = input.isRaw === true;
    try {
        input.setRawMode(true);
        return await new Promise((resolve, reject) => {
            const bytes = [];
            const cleanup = () => {
                input.pause();
                input.removeListener("data", onData);
                input.removeListener("end", onEnd);
                input.removeListener("error", onError);
                signals.off("SIGINT", onSigint);
            };
            const finish = () => {
                const result = Buffer.from(bytes);
                bytes.fill(0);
                cleanup();
                resolve(result);
            };
            const fail = (message) => {
                bytes.fill(0);
                cleanup();
                reject(new Error(message));
            };
            const onData = (chunk) => {
                const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
                try {
                    for (const byte of incoming) {
                        if (byte === 3)
                            return fail("foreground terminal interrupted");
                        if (byte === 10 || byte === 13)
                            return finish();
                        if (byte === 8 || byte === 127) {
                            if (bytes.length > 0)
                                bytes.pop();
                            continue;
                        }
                        if (bytes.length >= MAX_AUTH_INPUT_BYTES)
                            return fail("foreground terminal read failed");
                        bytes.push(byte);
                    }
                }
                finally {
                    incoming.fill(0);
                }
            };
            const onEnd = () => finish();
            const onError = () => fail("foreground terminal read failed");
            const onSigint = () => fail("foreground terminal interrupted");
            input.on("data", onData);
            input.once("end", onEnd);
            input.once("error", onError);
            signals.once("SIGINT", onSigint);
            input.resume();
        });
    }
    finally {
        input.setRawMode(wasRaw);
    }
}
async function readLine(input) {
    return await new Promise((resolve, reject) => {
        const bytes = [];
        const cleanup = () => {
            input.pause();
            input.removeListener("data", onData);
            input.removeListener("end", onEnd);
            input.removeListener("error", onError);
            process.off("SIGINT", onSigint);
        };
        const finish = () => {
            const result = Buffer.from(bytes);
            bytes.fill(0);
            cleanup();
            resolve(result);
        };
        const onData = (chunk) => {
            const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
            try {
                for (const byte of incoming) {
                    if (byte === 10)
                        return finish();
                    if (byte === 13)
                        continue;
                    if (bytes.length >= MAX_AUTH_INPUT_BYTES)
                        return onError();
                    bytes.push(byte);
                }
            }
            finally {
                incoming.fill(0);
            }
        };
        const onEnd = () => finish();
        const onError = () => { bytes.fill(0); cleanup(); reject(new Error("foreground terminal read failed")); };
        const onSigint = () => { bytes.fill(0); cleanup(); reject(new Error("foreground terminal interrupted")); };
        input.on("data", onData);
        input.once("end", onEnd);
        input.once("error", onError);
        process.once("SIGINT", onSigint);
        input.resume();
    });
}
function validateIdentity(value) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) || Buffer.byteLength(value, "utf8") > 320)
        invalidAuth();
    return value;
}
function validateChallenge(value) {
    if (!/^[0-9]{4,12}$/u.test(value))
        invalidAuth();
    return value;
}
function foregroundFailure() {
    return new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "A foreground terminal is required for wallet provider authentication.");
}
function invalidAuth() {
    throw new ApnError("APN_INVALID_INPUT", "Foreground provider authentication input is invalid.");
}
//# sourceMappingURL=foreground-auth.js.map