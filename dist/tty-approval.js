import { approvalCode } from "./approval-code.js";
import { isatty } from "node:tty";
import { BASE_USDC, CHAIN_ID } from "./constants.js";
import { ApnError } from "./errors.js";
import { directEvmNetwork } from "./evm-direct-networks.js";
import { chainDisplay } from "./chain-policy.js";
export const TTY_APPROVAL_DEADLINE_MS = 60_000;
const MAX_APPROVAL_INPUT_BYTES = 128;
/** A fresh foreground consent for each Relay source execution attempt. */
export class TtyRelayExecuteConfirmation {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async confirm(summary) {
        const expiresAt = new Date(Math.min(Date.parse(summary.deadline), Date.now() + TTY_APPROVAL_DEADLINE_MS)).toISOString();
        try {
            await exactChainConsent([
                "Agent Payment Node Relay Ethereum source execution",
                `Operation: ${summary.operationId}`,
                `Source chain: Ethereum (eip155:${summary.sourceChainId})`,
                `Destination chain: BNB Chain (eip155:${summary.destinationChainId})`,
                `Source account: ${summary.sourceAccount}`,
                `Source token: ${summary.sourceToken}`,
                `Amount: ${summary.amountAtomic} token atomic`,
                `Recipient: ${summary.recipient}`,
                `Minimum output: ${summary.minOutputAtomic} native atomic`,
                `Quote deadline: ${summary.deadline}`,
                `Approval network fee ceiling: ${summary.approvalNetworkFeeCeilingWei} wei`,
                `Deposit network fee ceiling: ${summary.depositNetworkFeeCeilingWei} wei`,
                `Quote digest: ${summary.quoteDigest}`,
                "This confirms Ethereum approval and deposit source effects only; destination delivery is separate.",
            ], approvalCode("bridge", summary.operationId, summary.quoteDigest), expiresAt, this.options);
            return true;
        }
        catch (error) {
            if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED")
                return false;
            throw error;
        }
    }
}
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
                `Chain: ${intent.evm === undefined ? `Base (${CHAIN_ID})` : `${directEvmNetwork(intent.evm.asset.chainId).name} (eip155:${intent.evm.asset.chainId})`}`,
                `Token: ${intent.evm === undefined ? BASE_USDC : intent.evm.asset.kind === "native" ? `native ${directEvmNetwork(intent.evm.asset.chainId).nativeSymbol}` : intent.evm.asset.address}`,
                `Sender: ${intent.walletAddress}`,
                `Recipient: ${intent.recipient}`,
                `Amount: ${intent.amountDecimal} ${intent.evm === undefined ? "USDC" : intent.evm.asset.kind === "native" ? directEvmNetwork(intent.evm.asset.chainId).nativeSymbol : "token"} (${intent.amountAtomic} atomic)`,
                ...(intent.evm === undefined ? [] : [
                    `Decimals: ${intent.evm.asset.decimals} (${intent.evm.asset.decimalsSource})`,
                    ...(intent.evm.feeQuote.feeModel === "arbitrum-inclusive" ? [
                        "Fee model: Arbitrum inclusive gas (L2 execution plus L1 posting; no separate surcharge)",
                        `Maximum inclusive transaction fee: ${intent.evm.feeQuote.maximumExecutionFeeWei} wei`,
                    ] : intent.evm.feeQuote.feeModel === "monad-gas-limit" ? [
                        "Fee model: Monad bills the full gas limit, not gas used",
                        `Maximum execution fee: ${intent.evm.feeQuote.maximumExecutionFeeWei} wei`,
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
                `Type ${phrase} and press Enter to confirm.`,
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
    return approvalCode("transfer", fingerprint);
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
async function readApprovalInput(tty, expiresAt, deadlineMs, externalSignal, maximumInputBytes = MAX_APPROVAL_INPUT_BYTES) {
    if (!Number.isSafeInteger(maximumInputBytes) || maximumInputBytes < 1 || maximumInputBytes > 256) {
        throw new ApnError("APN_INTERNAL", "The approval input bound is invalid.");
    }
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
    const input = Buffer.alloc(maximumInputBytes);
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
export class TtyRailApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async approve(input) {
        const { account, prepared } = input;
        await exactChainConsent([
            "Agent Payment Node direct-rail approval", `Profile: ${account.profile}`, `Provider: ${account.provider}`,
            `Custody: ${account.custody}`, `Operation: ${input.operationId}`, `Mainnet: ${account.rail}`,
            `Genesis: ${prepared.networkIdentity}`, `Asset: ${prepared.asset.identifier}`, `Decimals: ${prepared.asset.decimals}`,
            `Sender: ${prepared.sender}`, `Recipient: ${prepared.recipient}`,
            `Amount: ${chainDisplay(prepared.amountAtomic, prepared.asset.decimals)} ${prepared.asset.symbol} (${prepared.amountAtomic} atomic)`,
            `Network fee payer: ${prepared.economics.networkFeePayer}`, `Maximum network fee: ${prepared.economics.networkFeeMaximumAtomic} native atomic`,
            ...(prepared.rail === "solana" ? [`Recipient rent payer: ${prepared.economics.rentPayer ?? "none"}`, `Recipient rent: ${prepared.economics.recipientRentAtomic} native atomic`] : [
                `Bandwidth bound: ${prepared.resources?.bandwidthBytesAtomic} bytes / ${prepared.resources?.bandwidthMaximumAtomic} TRX atomic`,
                `Caller Energy fee_limit: ${prepared.resources?.energyFeeLimitAtomic} TRX atomic (Bandwidth is additional)`,
                `Maximum activation component: ${prepared.resources?.accountActivationMaximumAtomic} TRX atomic`,
                `Recipient active at solidified snapshot: ${prepared.resources?.recipientActivatedAtSolidHead === true ? "yes" : "no"}`,
                `Resource cost rule: ${prepared.resources?.costRule}`, `Fee control: ${prepared.economics.feeControl}`,
                `Next maintenance: ${prepared.resources?.nextMaintenanceMsAtomic} UTC epoch milliseconds`,
            ]),
            `Maximum sender fee${prepared.rail === "solana" ? " and rent" : " and resource"} debit: ${prepared.economics.maximumNativeDebitAtomic} native atomic`,
            `Selected fee/${prepared.rail === "solana" ? "rent" : "resource"} cap: ${prepared.maximumFeeAtomic} native atomic`,
            ...(input.allowlist === undefined ? [] : [`Frozen owner allowlist: policyDigest ${input.allowlist.policyDigest}; policyRevision ${input.allowlist.policyRevision}`]),
            `Policy: ${input.policyHash}`,
            // The expiry bounds this screen, not the send: on Solana the sending window opens after it.
            ...(prepared.rail === "solana" && account.provider === "local"
                ? ["Send guard: the block reference is re-acquired after you approve and these exact bytes are simulated before anything is signed"]
                : []),
            `Fingerprint: ${input.fingerprint}`, `Expires: ${prepared.expiresAt}`,
        ], transferApprovalPhrase(input.fingerprint), prepared.expiresAt, this.options);
    }
}
export class TtyChainPolicyApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async approve(policy) {
        await exactChainConsent([
            "Agent Payment Node mainnet asset admission", `Profile: ${policy.account.profile}`, `Provider: ${policy.account.provider}`,
            `Custody: ${policy.account.custody}`, `Account: ${policy.account.address}`, `Mainnet: ${policy.account.rail}`,
            `Genesis: ${policy.networkIdentity}`, `Asset: ${policy.asset.identifier}`, `Decimals: ${policy.asset.decimals}`,
            `Maximum per transfer: ${policy.maximumPerTransferAtomic} asset atomic`, `Daily principal limit (UTC): ${policy.dailyLimitAtomic} asset atomic`,
            `Maximum fee and ${policy.account.rail === "solana" ? "rent" : "resources"} per operation: ${policy.maximumNativeFeeAtomic} native atomic`, `Policy: ${policy.policyHash}`,
            "Unresolved transfers continue to reserve limits across UTC days.",
        ], approvalCode("asset-admission", policy.policyHash), new Date(Date.now() + TTY_APPROVAL_DEADLINE_MS).toISOString(), this.options);
    }
}
export async function exactChainConsent(lines, phrase, expiresAt, options, maximumInputBytes = MAX_APPROVAL_INPUT_BYTES) {
    if (Date.now() >= Date.parse(expiresAt))
        throw approvalFailure("APN_APPROVAL_EXPIRED", "The chain approval expired.");
    let terminal;
    try {
        terminal = await (options.openTerminal ?? openApprovalTerminal)();
    }
    catch {
        throw approvalFailure("APN_TTY_UNAVAILABLE", "A foreground terminal is required for chain approval.");
    }
    try {
        if (!(options.isTerminal ?? isatty)(terminal.fd))
            throw approvalFailure("APN_TTY_UNAVAILABLE", "The chain approval is not attached to a terminal.");
        await terminal.write(`\n${lines.join("\n")}\nType ${phrase} and press Enter to confirm.\n> `);
        const supplied = await readApprovalInput(terminal, expiresAt, options.deadlineMs ?? TTY_APPROVAL_DEADLINE_MS, options.signal, maximumInputBytes);
        if (supplied !== phrase)
            throw approvalFailure("APN_APPROVAL_REFUSED", "The chain approval was refused.");
        if (Date.now() >= Date.parse(expiresAt))
            throw approvalFailure("APN_APPROVAL_EXPIRED", "The chain approval expired.");
    }
    finally {
        await terminal.close();
    }
}
//# sourceMappingURL=tty-approval.js.map