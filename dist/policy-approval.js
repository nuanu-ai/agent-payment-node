import { isatty } from "node:tty";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
const POLICY_APPROVAL_DEADLINE_MS = 60_000;
const MAX_APPROVAL_INPUT_BYTES = 128;
export class TtyProfilePolicyApproval {
    deadlineMs;
    signal;
    openTerminal;
    isTerminal;
    constructor(options = {}) {
        const deadlineMs = options.deadlineMs ?? POLICY_APPROVAL_DEADLINE_MS;
        if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
            throw new ApnError("APN_INTERNAL", "The profile-policy approval deadline is invalid.");
        }
        this.deadlineMs = deadlineMs;
        this.signal = options.signal;
        this.openTerminal = options.openTerminal ?? openApprovalTerminal;
        this.isTerminal = options.isTerminal ?? isatty;
    }
    async approve(intent) {
        let tty;
        try {
            tty = await this.openTerminal();
        }
        catch {
            throw approvalFailure("APN_TTY_UNAVAILABLE", "A foreground terminal is required to create or increase profile policy.");
        }
        try {
            if (!this.isTerminal(tty.fd)) {
                throw approvalFailure("APN_TTY_UNAVAILABLE", "Profile-policy approval is not attached to a terminal.");
            }
            const phrase = profilePolicyApprovalPhrase(intent.fingerprint);
            await tty.write([
                "\nAgent Payment Node policy approval",
                `Change: ${intent.change}`,
                `Profile: ${intent.profile}`,
                `Chain: Base (${CHAIN_ID})`,
                `Token: ${BASE_USDC}`,
                `Wallet: ${intent.walletAddress}`,
                `Maximum wallet USDC: ${intent.maxBalanceUsdcAtomic} atomic`,
                `Maximum unattended x402: ${intent.maxX402AmountAtomic} atomic`,
                `Maximum wallet ETH: ${intent.maxBalanceEthWei ?? "not configured"} wei`,
                "These values are owner policy, not product defaults.",
                `Fingerprint: ${intent.fingerprint}`,
                `Type exactly: ${phrase}`,
                "> ",
            ].join("\n"));
            const supplied = await readApprovalInput(tty, this.deadlineMs, this.signal);
            if (supplied !== phrase) {
                throw approvalFailure("APN_APPROVAL_REFUSED", "Profile-policy approval was refused.");
            }
        }
        finally {
            await tty.close();
        }
    }
}
export function profilePolicyApprovalPhrase(fingerprint) {
    return `APPROVE APN POLICY ${fingerprint.slice(-16)}`;
}
async function openApprovalTerminal() {
    const input = process.stdin;
    const output = process.stderr;
    if (input.isTTY !== true || output.isTTY !== true)
        throw new Error("foreground terminal unavailable");
    return {
        fd: input.fd,
        write: async (contents) => await new Promise((resolve, reject) => {
            output.write(contents, (error) => error === null || error === undefined ? resolve() : reject(error));
        }),
        read: (signal) => readTerminal(input, signal),
        close: async () => { input.pause(); },
    };
}
async function* readTerminal(input, signal) {
    const queued = [];
    let ended = false;
    let failure;
    let wake;
    const notify = () => { wake?.(); };
    const onData = (chunk) => {
        queued.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8"));
        notify();
    };
    const onEnd = () => { ended = true; notify(); };
    const onError = () => { failure = new Error("approval terminal read failed"); notify(); };
    const abort = () => { failure = new Error("approval terminal read aborted"); notify(); };
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted)
        abort();
    input.resume();
    try {
        while (true) {
            if (failure !== undefined)
                throw failure;
            const next = queued.shift();
            if (next !== undefined) {
                yield next;
                continue;
            }
            if (ended)
                return;
            await new Promise((resolve) => { wake = resolve; });
            wake = undefined;
        }
    }
    finally {
        input.pause();
        input.removeListener("data", onData);
        input.removeListener("end", onEnd);
        input.removeListener("error", onError);
        signal.removeEventListener("abort", abort);
        for (const chunk of queued)
            chunk.fill(0);
    }
}
async function readApprovalInput(tty, deadlineMs, externalSignal) {
    const controller = new AbortController();
    let abortKind;
    const abort = (kind) => {
        if (abortKind !== undefined)
            return;
        abortKind = kind;
        controller.abort();
    };
    const onExternalAbort = () => abort("external");
    const onSigint = () => abort("sigint");
    const timeout = setTimeout(() => abort("deadline"), deadlineMs);
    timeout.unref();
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    process.once("SIGINT", onSigint);
    if (externalSignal?.aborted === true)
        abort("external");
    const input = Buffer.alloc(MAX_APPROVAL_INPUT_BYTES);
    let length = 0;
    try {
        for await (const chunk of tty.read(controller.signal)) {
            for (const byte of chunk) {
                if (byte === 10)
                    return input.subarray(0, length).toString("ascii");
                if (byte === 13 || byte < 32 || byte > 126 || length >= input.length) {
                    throw approvalFailure("APN_APPROVAL_REFUSED", "Profile-policy approval was refused.");
                }
                input[length] = byte;
                length += 1;
            }
        }
        return input.subarray(0, length).toString("ascii");
    }
    catch (error) {
        if (abortKind === "deadline")
            throw approvalFailure("APN_APPROVAL_TIMEOUT", "Profile-policy approval timed out.");
        if (abortKind === "external" || abortKind === "sigint") {
            throw approvalFailure("APN_APPROVAL_ABORTED", "Profile-policy approval was interrupted.");
        }
        if (error instanceof ApnError)
            throw error;
        throw approvalFailure("APN_APPROVAL_ABORTED", "Profile-policy approval was interrupted.");
    }
    finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", onExternalAbort);
        process.off("SIGINT", onSigint);
        input.fill(0);
        controller.abort();
    }
}
function approvalFailure(nativeCode, message) {
    return new ApnError("APN_NATIVE_REJECTED", message, { nativeCode });
}
//# sourceMappingURL=policy-approval.js.map