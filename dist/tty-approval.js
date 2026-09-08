import { isatty } from "node:tty";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
export const TTY_APPROVAL_DEADLINE_MS = 60_000;
const MAX_APPROVAL_INPUT_BYTES = 128;
export class TtyTransferApproval {
    deadlineMs;
    signal;
    openTerminal;
    isTerminal;
    constructor(options = {}) {
        const deadlineMs = options.deadlineMs ?? TTY_APPROVAL_DEADLINE_MS;
        if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
            throw new ApnError("APN_INTERNAL", "The direct-transfer approval deadline is invalid.");
        }
        this.deadlineMs = deadlineMs;
        this.signal = options.signal;
        this.openTerminal = options.openTerminal ?? openApprovalTerminal;
        this.isTerminal = options.isTerminal ?? isatty;
    }
    async approve(intent) {
        if (Date.now() >= Date.parse(intent.expiresAt))
            throw approvalFailure("APN_APPROVAL_EXPIRED", "Transfer approval expired.");
        let tty;
        try {
            tty = await this.openTerminal();
        }
        catch {
            throw approvalFailure("APN_TTY_UNAVAILABLE", "A foreground terminal is required for direct-transfer approval.");
        }
        try {
            if (!this.isTerminal(tty.fd))
                throw approvalFailure("APN_TTY_UNAVAILABLE", "Direct-transfer approval is not attached to a terminal.");
            const phrase = transferApprovalPhrase(intent.fingerprint);
            await tty.write([
                "\nAgent Payment Node approval",
                `Profile: ${intent.profile}`,
                `Operation: ${intent.operationId}`,
                `Chain: ${intent.evm === undefined ? `Base (${CHAIN_ID})` : `eip155:${intent.evm.asset.chainId}`}`,
                `Token: ${intent.evm === undefined ? BASE_USDC : intent.evm.asset.kind === "native" ? "native ETH" : intent.evm.asset.address}`,
                `Sender: ${intent.walletAddress}`,
                `Recipient: ${intent.recipient}`,
                `Amount: ${intent.amountDecimal} ${intent.evm === undefined ? "USDC" : intent.evm.asset.kind === "native" ? "ETH" : "token"} (${intent.amountAtomic} atomic)`,
                ...(intent.evm === undefined ? [] : [
                    `Decimals: ${intent.evm.asset.decimals} (${intent.evm.asset.decimalsSource})`,
                    ...(intent.evm.feeQuote.feeModel === "arbitrum-inclusive" ? [
                        "Fee model: Arbitrum inclusive gas (L2 execution plus L1 posting; no separate surcharge)",
                        `Maximum inclusive transaction fee: ${intent.evm.feeQuote.maximumExecutionFeeWei} wei`,
                    ] : [`Maximum execution fee: ${intent.evm.feeQuote.maximumExecutionFeeWei} wei`]),
                    `L1 data fee upper estimate: ${intent.evm.feeQuote.l1DataFeeUpperWei} wei`,
                    `Operator fee estimate: ${intent.evm.feeQuote.operatorFeeUpperWei} wei`,
                    `Pre-submission total fee quote budget: ${intent.evm.maxFeeWei} wei`,
                    "Data/operator fees may vary at inclusion; the total quote budget is NOT an onchain-enforced total fee cap.",
                ]),
                ...(intent.providerId === undefined ? [] : [`Provider: ${intent.providerId}`]),
                ...(intent.policyIdentity === undefined ? [] : [`Policy: ${intent.policyIdentity}`]),
                ...(intent.nonceAtomic === undefined ? [] : [`Nonce: ${intent.nonceAtomic}`]),
                ...(intent.gasLimitAtomic === undefined ? [] : [`Gas limit: ${intent.gasLimitAtomic}`]),
                ...(intent.maxFeePerGasAtomic === undefined ? [] : [`Max fee per gas: ${intent.maxFeePerGasAtomic} wei`]),
                ...(intent.maxPriorityFeePerGasAtomic === undefined ? [] : [`Max priority fee per gas: ${intent.maxPriorityFeePerGasAtomic} wei`]),
                `Expires: ${intent.expiresAt}`,
                `Fingerprint: ${intent.fingerprint}`,
                `Type exactly: ${phrase}`,
                "> ",
            ].join("\n"));
            const supplied = await readApprovalInput(tty, intent.expiresAt, this.deadlineMs, this.signal);
            if (!isExactTransferApproval(phrase, supplied))
                throw approvalFailure("APN_APPROVAL_REFUSED", "Direct-transfer approval was refused.");
            if (Date.now() >= Date.parse(intent.expiresAt))
                throw approvalFailure("APN_APPROVAL_EXPIRED", "Transfer approval expired.");
        }
        finally {
            await tty.close();
        }
    }
}
export function transferApprovalPhrase(fingerprint) {
    return `APPROVE APN TRANSFER ${fingerprint.slice(-16)}`;
}
export function isExactTransferApproval(expected, supplied) {
    return supplied === expected;
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
async function readApprovalInput(tty, expiresAt, deadlineMs, externalSignal) {
    const controller = new AbortController();
    const expiryMs = Date.parse(expiresAt);
    const remainingMs = Math.max(1, Math.min(deadlineMs, expiryMs - Date.now()));
    let abortKind;
    const abort = (kind) => {
        if (abortKind !== undefined)
            return;
        abortKind = kind;
        controller.abort();
    };
    const onExternalAbort = () => abort("external");
    const onSigint = () => abort("sigint");
    const timeout = setTimeout(() => abort("deadline"), remainingMs);
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
                    throw approvalFailure("APN_APPROVAL_REFUSED", "Direct-transfer approval was refused.");
                }
                input[length] = byte;
                length += 1;
            }
        }
        return input.subarray(0, length).toString("ascii");
    }
    catch (error) {
        if (abortKind === "deadline") {
            if (Date.now() >= expiryMs)
                throw approvalFailure("APN_APPROVAL_EXPIRED", "Transfer approval expired.");
            throw approvalFailure("APN_APPROVAL_TIMEOUT", "Direct-transfer approval timed out.");
        }
        if (abortKind === "external" || abortKind === "sigint") {
            throw approvalFailure("APN_APPROVAL_ABORTED", "Direct-transfer approval was interrupted.");
        }
        if (error instanceof ApnError)
            throw error;
        throw approvalFailure("APN_APPROVAL_ABORTED", "Direct-transfer approval was interrupted.");
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
//# sourceMappingURL=tty-approval.js.map