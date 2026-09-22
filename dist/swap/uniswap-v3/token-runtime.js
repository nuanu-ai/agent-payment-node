import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import { UniswapTokenExecution } from "./token-execution.js";
import { newUniswapTokenOperation, UniswapTokenJournal } from "./token-operation.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "./token-route.js";
import { UniswapTokenRpcBudgetJournal } from "./token-rpc-budget.js";
export class InstalledUniswapTokenRuntime {
    builder;
    materials;
    journal;
    ports;
    rpcBudget;
    rpc;
    execution;
    constructor(builder, materials, journal, ports, rpcBudget, rpc) {
        this.builder = builder;
        this.materials = materials;
        this.journal = journal;
        this.ports = ports;
        this.rpcBudget = rpcBudget;
        this.rpc = rpc;
        this.execution = new UniswapTokenExecution(journal, ports);
    }
    inventory() { return this.builder.inventory(); }
    async quote(request) {
        const result = await this.builder.quote(request);
        if (this.rpcBudget !== undefined) {
            const reservation = await this.rpcBudget.reserve(result.quoteHash, request.command, 8, 8, "quote");
            await this.rpcBudget.settle(result.quoteHash, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0);
        }
        return result;
    }
    async prepare(request) {
        const material = await this.materials.load(request.quoteHash);
        if (material === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared Uniswap token quote was not found.");
        if (material.profile !== request.profile || material.mechanismDigest !== swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN))
            blocked("Token quote binding changed.", "uniswap_token_quote_binding");
        if (this.ports.now().getTime() >= material.route.deadline * 1000)
            blocked("Token quote expired.", "uniswap_token_quote_expired");
        const operationId = domainHash("apn.uniswap-token-operation-id.v1", canonicalJson({ profile: request.profile,
            quoteHash: request.quoteHash, idempotencyKey: request.idempotencyKey }));
        const reservation = await this.rpcBudget?.reserve(request.quoteHash, request.command, 9, 9, "prepare");
        try {
            await this.ports.confirm(material);
        }
        finally {
            if (reservation !== undefined)
                await this.rpcBudget.settle(request.quoteHash, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0);
        }
        await this.rpcBudget?.linkQuote(request.quoteHash, operationId);
        const prior = await this.journal.load(operationId);
        if (prior !== null) {
            await this.rpcBudget?.reconcile(operationId);
            return prior;
        }
        const saved = await this.journal.save(newUniswapTokenOperation({ operationId, profile: material.profile, account: material.account,
            route: material.route, approvalCapAtomic: material.approvalCapAtomic, allowanceAtPrepare: material.allowanceAtPrepare,
            approvalGas: material.approvalGas, swapGas: material.swapGas, cleanupGas: material.cleanupGas,
            maximumNativeDebitWei: material.maximumNativeDebitWei, policyDigest: material.policyDigest,
            mechanismDigest: material.mechanismDigest, now: this.ports.now() }));
        await this.rpcBudget?.reconcile(operationId);
        return saved;
    }
    async approve(id) { return await this.budgeted(id, "swap.uniswap-token.approve", 14, 14, "approval_effect", async () => await this.execution.approve(id)); }
    async execute(id) {
        const phase = (await this.journal.load(id))?.phase;
        const budget = phase === "approved" ? [14, 14, "approval_effect"] : phase === "approval_observed" ? [24, 24, "swap_effect"] : [0, 24, "recovery"];
        return await this.budgeted(id, "swap.uniswap-token.execute", budget[0], budget[1], budget[2], async () => await this.execution.execute(id));
    }
    async status(id) { return await this.budgeted(id, "swap.uniswap-token.status", 0, 8, "recovery", async () => await this.execution.status(id)); }
    async cleanup(id) { return await this.budgeted(id, "swap.uniswap-token.cleanup", 0, 14, "recovery", async () => await this.execution.cleanup(id)); }
    async budgeted(id, command, cap, requestSessionCap, budgetClass, work) {
        if (this.rpcBudget === undefined)
            return await work();
        await this.rpcBudget.reconcile(id);
        const reservation = await this.rpcBudget.reserve(id, command, cap, requestSessionCap, budgetClass);
        try {
            return await work();
        }
        finally {
            await this.rpcBudget.settle(id, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0);
        }
    }
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-runtime.js.map