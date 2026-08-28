import { open } from "node:fs/promises";
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
                `Chain: Base (${CHAIN_ID})`,
                `Token: ${BASE_USDC}`,
                `Sender: ${intent.walletAddress}`,
                `Recipient: ${intent.recipient}`,
                `Amount: ${intent.amountDecimal} USDC (${intent.amountAtomic} atomic)`,
                `Nonce: ${intent.nonceAtomic}`,
                `Gas limit: ${intent.gasLimitAtomic}`,
                `Max fee per gas: ${intent.maxFeePerGasAtomic} wei`,
                `Max priority fee per gas: ${intent.maxPriorityFeePerGasAtomic} wei`,
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
    const handle = await open("/dev/tty", "r+");
    return {
        fd: handle.fd,
        write: async (contents) => await handle.writeFile(contents),
        read: (signal) => handle.createReadStream({ autoClose: false, highWaterMark: 1, signal }),
        close: async () => await handle.close(),
    };
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