import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { ApnError } from "../errors.js";
import { GaslessHttps } from "../gasless/https.js";
import { StateStore } from "../state.js";
import { UsdtBoundOperationRepository } from "./bound-operation.js";
import { UsdtCommandReadBudget } from "./command-prepare.js";
import { UsdtExecutionJournal } from "./execution-journal.js";
import { LocalUsdtSigningService } from "./local-signing.js";
import { USDT_GASLESS } from "./model.js";
import { UsdtRecoveryService } from "./recovery.js";
import { usdtPacedRecoveryPort } from "./recovery-port.js";
import { usdtSafeSnapshot, usdtSendPort } from "./rpc.js";
import { GuardedUsdtSendService } from "./send.js";
import { createInterface } from "node:readline/promises";
import { approvalCode } from "../approval-code.js";
import { decodeUsdtPaymasterData } from "./paymaster-data.js";
export class TtyUsdtApproval {
    async approve(bound) {
        if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
            throw new ApnError("APN_NATIVE_REJECTED", "A foreground terminal is required for gasless USDT approval.", { nativeCode: "APN_TTY_UNAVAILABLE" });
        }
        const b = bound.binding, validity = decodeUsdtPaymasterData(b.paymasterData);
        const now = Date.now(), validUntil = Number(validity.validUntil) * 1000;
        if (!Number.isSafeInteger(validUntil) || now + 60_000 >= validUntil) {
            throw new ApnError("APN_NATIVE_REJECTED", "Gasless USDT quote is too close to expiry.", { nativeCode: "APN_APPROVAL_EXPIRED" });
        }
        const phrase = approvalCode("gasless", "usdt", b.bindingHash);
        const lines = ["\nAgent Payment Node gasless USDT approval", `Operation: ${bound.operationId}`,
            `Profile: ${b.profile}`, `Chain: Ethereum (${b.chain})`, `Owner: ${b.plan.request.sender}`,
            `Recipient: ${b.plan.request.recipient}`, `Gross: ${b.plan.request.grossAtomic} atomic USDT`,
            `Recipient amount: ${b.plan.netAtomic} atomic USDT`, `Maximum fee: ${b.plan.request.maxFeeAtomic} atomic USDT`,
            `Quoted fee bound: ${b.plan.quotedFeeAtomic} atomic USDT`,
            `Policy revision: ${b.policyRevision}`, `Policy digest: ${b.policyDigest}`,
            `Quote valid from: ${new Date(Number(validity.validAfter) * 1000).toISOString()}`,
            `Quote valid until: ${new Date(validUntil).toISOString()}`, `Binding: ${b.bindingHash}`,
            `Type ${phrase} and press Enter to send exactly once.`, "> "];
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), Math.min(60_000, validUntil - now - 60_000));
        const terminal = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
        try {
            const answer = await terminal.question(lines.join("\n"), { signal: abort.signal });
            if (answer !== phrase)
                throw new ApnError("APN_NATIVE_REJECTED", "Gasless USDT approval was refused.", { nativeCode: "APN_APPROVAL_REFUSED" });
            if (Date.now() + 60_000 >= validUntil)
                throw new ApnError("APN_NATIVE_REJECTED", "Gasless USDT quote expired.", { nativeCode: "APN_APPROVAL_EXPIRED" });
        }
        catch (error) {
            if (error instanceof ApnError)
                throw error;
            throw new ApnError("APN_NATIVE_REJECTED", "Gasless USDT approval was interrupted.", { nativeCode: "APN_APPROVAL_REFUSED" });
        }
        finally {
            clearTimeout(timer);
            terminal.close();
        }
    }
}
/** CLI effect boundary. Recovery only observes the hash already recorded in the execution journal. */
export class GaslessUsdtCommandExecute {
    state;
    clock;
    wrapping;
    options;
    bound;
    journal;
    constructor(state, clock, wrapping, options = {}) {
        this.state = state;
        this.clock = clock;
        this.wrapping = wrapping;
        this.options = options;
        this.bound = new UsdtBoundOperationRepository(state.root);
        this.journal = new UsdtExecutionJournal(state.root);
    }
    async load(profileHash, operationId) {
        const bound = await this.bound.load(profileHash, operationId);
        if (bound === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Gasless USDT bound operation was not found.");
        return bound;
    }
    preparePort() {
        if (this.options.preparePort !== undefined)
            return this.options.preparePort;
        const rpcUrl = this.options.rpcUrl ?? process.env.APN_ETHEREUM_RPC_URL;
        if (!rpcUrl)
            throw new ApnError("APN_RPC_CONFIG", "APN_ETHEREUM_RPC_URL is required for gasless USDT execution.");
        const budget = new UsdtCommandReadBudget(this.state, this.options.transport ?? new GaslessHttps());
        return {
            now: () => this.clock.now(),
            activePolicy: async (profile) => await loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, profile),
            dailyUsage: async (sender, at) => (await new AssetUsageLedger(this.state.root).usage({ account: sender,
                chain: USDT_GASLESS.chain, asset: { kind: "token", identifier: USDT_GASLESS.token } }, at)).amountAtomic,
            safeSnapshot: async (sender) => await usdtSafeSnapshot(budget, rpcUrl, sender),
        };
    }
    async execute(profileHash, operationId) {
        const bound = await this.load(profileHash, operationId);
        // A previous process may have died after reserving usage but before the may-have-sent marker.
        // The effect lock serializes this cleanup against an active signer in another process.
        const prior = await this.journal.load(operationId);
        if (prior !== null) {
            if (["planned", "reserved", "failed_before_effect"].includes(prior.state)) {
                await this.journal.abortUnsent(bound, this.clock.now());
            }
            throw new ApnError("APN_OPERATION_BLOCKED", "Gasless USDT execution already has a journal record; inspect status.");
        }
        await (this.options.approval ?? new TtyUsdtApproval()).approve(bound);
        const signer = this.options.signer ?? new LocalUsdtSigningService(this.state, this.wrapping, () => this.clock.now());
        const send = this.options.sendTransport ?? { send: usdtSendPort(this.options.transport ?? new GaslessHttps()) };
        return await new GuardedUsdtSendService(this.journal, signer, send, this.preparePort()).send(bound, {
            profile: bound.binding.profile, profileHash, operationId, bindingHash: bound.binding.bindingHash,
        });
    }
    async status(profileHash, operationId) {
        await this.load(profileHash, operationId);
        return { operationId, execution: await this.journal.load(operationId) };
    }
    async observe(profileHash, operationId) {
        const bound = await this.load(profileHash, operationId);
        const rpcUrl = this.options.rpcUrl ?? process.env.APN_ETHEREUM_RPC_URL;
        if (this.options.recoveryPort === undefined && !rpcUrl) {
            throw new ApnError("APN_RPC_CONFIG", "APN_ETHEREUM_RPC_URL is required for gasless USDT observation.");
        }
        const port = this.options.recoveryPort ?? usdtPacedRecoveryPort(this.state, this.options.transport ?? new GaslessHttps(), rpcUrl);
        return await new UsdtRecoveryService(this.journal, port, () => this.clock.now()).observe(bound);
    }
}
//# sourceMappingURL=command-execute.js.map