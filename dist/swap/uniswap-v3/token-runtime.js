import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import { UniswapTokenExecution } from "./token-execution.js";
import { newUniswapTokenOperation, UniswapTokenJournal } from "./token-operation.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "./token-route.js";
import { UniswapTokenRpcBudgetJournal } from "./token-rpc-budget.js";
import { admitOperation } from "../../operation-index/admission.js";
import { evmClaim, namedProfileHash } from "../../operation-index/adapters/family-claims.js";
import { UNISWAP_TOKEN_CHAIN_ID } from "../../operation-index/adapters/uniswap-token.js";
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
        const binding = domainHash("apn.uniswap-token-quote-attempt.v1", canonicalJson(request));
        const cap = this.quotePrepareCap(8), reservation = await this.rpcBudget?.reserve(binding, request.command, cap, cap, "quote");
        let result;
        try {
            result = await this.builder.quote(request);
            return result;
        }
        finally {
            if (reservation !== undefined) {
                await this.rpcBudget.settle(binding, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0, this.rpc?.primaryPoolTelemetry?.());
                if (result !== undefined)
                    await this.rpcBudget.linkQuote(binding, result.quoteHash);
            }
        }
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
        // A new swap's account claim is written before its confirmation reads; a replay keeps its existing path.
        if (await this.journal.read(operationId) !== null)
            return await this.prepareBody(request, material, operationId);
        return await admitOperation(this.journal, { family: "uniswap_token", profileHash: namedProfileHash(material.profile), operationId,
            idempotencyHash: null, requestHash: null }, [evmClaim(UNISWAP_TOKEN_CHAIN_ID, material.account)], async () => await this.prepareBody(request, material, operationId));
    }
    async prepareBody(request, material, operationId) {
        const cap = this.quotePrepareCap(9), reservation = await this.rpcBudget?.reserve(request.quoteHash, request.command, cap, cap, "prepare");
        try {
            await this.ports.confirm(material);
        }
        finally {
            if (reservation !== undefined)
                await this.rpcBudget.settle(request.quoteHash, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0, this.rpc?.primaryPoolTelemetry?.());
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
            mechanismDigest: material.mechanismDigest, quoteBlock: { number: material.blockNumber, hash: material.blockHash }, now: this.ports.now() }));
        await this.rpcBudget?.reconcile(operationId);
        return saved;
    }
    async approve(id) {
        return await this.budgeted(id, "swap.uniswap-token.approve", async () => {
            const cap = this.poolCap(14);
            return [cap, cap, "approval_effect"];
        }, async () => await this.execution.approve(id));
    }
    async execute(id) {
        return await this.budgeted(id, "swap.uniswap-token.execute", async () => {
            const phase = (await this.journal.load(id))?.phase;
            const cap = 24;
            return phase === "approved" || phase === "approval_observed" ? [cap, cap, "swap_effect"] : [0, cap, "recovery"];
        }, async () => await this.execution.execute(id));
    }
    async status(id) { return await this.budgeted(id, "swap.uniswap-token.status", async () => [0, this.poolCap(11), "recovery"], async () => await this.execution.status(id)); }
    async cleanup(id, fees) { return await this.budgeted(id, "swap.uniswap-token.cleanup", async () => [0, this.poolCap(14), "recovery"], async () => await this.execution.cleanup(id, fees)); }
    async budgeted(id, command, budget, work) {
        return await this.journal.withLocks([`uniswap-token-runtime:${id}`], async () => {
            const [cap, requestSessionCap, budgetClass] = await budget();
            if (this.rpcBudget === undefined)
                return await work();
            await this.rpcBudget.reconcile(id);
            const reservation = await this.rpcBudget.reserve(id, command, cap, requestSessionCap, budgetClass);
            try {
                return await work();
            }
            finally {
                await this.rpcBudget.settle(id, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0, this.rpc?.primaryPoolTelemetry?.());
            }
        });
    }
    poolCap(base) { return base + (this.rpc?.primaryPoolEnabled?.() === true ? this.rpc.primaryPoolSize?.() ?? 3 : 0); }
    quotePrepareCap(base) { return this.rpc?.primaryPoolEnabled?.() === true ? this.poolCap(base) - 1 : base; }
}
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=token-runtime.js.map