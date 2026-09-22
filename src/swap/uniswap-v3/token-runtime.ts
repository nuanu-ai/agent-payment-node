import { canonicalJson, domainHash } from "../../canonical.js";
import type { CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import type { UniswapTokenQuoteBuilder } from "./token-builder.js";
import { UniswapTokenExecution, type UniswapTokenCommandRuntime, type UniswapTokenExecutionPorts } from "./token-execution.js";
import type { SavedUniswapTokenMaterialStore, UniswapTokenMaterial } from "./token-material.js";
import { newUniswapTokenOperation, UniswapTokenJournal } from "./token-operation.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "./token-route.js";
import { UniswapTokenRpcBudgetJournal } from "./token-rpc-budget.js";
import type { TokenRpcCall } from "./token-rpc.js";
type Prepare = Extract<CommandRequest, {
    readonly command: "swap.uniswap-token.prepare";
}>;
export interface UniswapTokenRuntimePorts extends UniswapTokenExecutionPorts {
    confirm(material: UniswapTokenMaterial): Promise<void>;
}
export class InstalledUniswapTokenRuntime implements UniswapTokenCommandRuntime {
    private readonly execution: UniswapTokenExecution;
    constructor(private readonly builder: UniswapTokenQuoteBuilder, private readonly materials: SavedUniswapTokenMaterialStore, private readonly journal: UniswapTokenJournal, private readonly ports: UniswapTokenRuntimePorts,
      private readonly rpcBudget?: UniswapTokenRpcBudgetJournal, private readonly rpc?: TokenRpcCall) { this.execution = new UniswapTokenExecution(journal, ports); }
    inventory() { return this.builder.inventory(); }
    async quote(request: Extract<CommandRequest, {
        readonly command: "swap.uniswap-token.quote";
    }>) { const result = await this.builder.quote(request) as { readonly quoteHash: string };
      if (this.rpcBudget !== undefined) { const reservation = await this.rpcBudget.reserve(result.quoteHash, request.command, 8);
        await this.rpcBudget.settle(result.quoteHash, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0); }
      return result; }
    async prepare(request: Prepare) {
        const material = await this.materials.load(request.quoteHash);
        if (material === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared Uniswap token quote was not found.");
        if (material.profile !== request.profile || material.mechanismDigest !== swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN))
            blocked("Token quote binding changed.", "uniswap_token_quote_binding");
        if (this.ports.now().getTime() >= material.route.deadline * 1000)
            blocked("Token quote expired.", "uniswap_token_quote_expired");
        const operationId = domainHash("apn.uniswap-token-operation-id.v1", canonicalJson({ profile: request.profile,
            quoteHash: request.quoteHash, idempotencyKey: request.idempotencyKey }));
        const reservation = await this.rpcBudget?.reserve(request.quoteHash, request.command, 9);
        try { await this.ports.confirm(material); }
        finally { if (reservation !== undefined) await this.rpcBudget!.settle(request.quoteHash, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0); }
        await this.rpcBudget?.linkQuote(request.quoteHash, operationId);
        const prior = await this.journal.load(operationId);
        if (prior !== null) { await this.rpcBudget?.reconcile(operationId); return prior; }
        const saved = await this.journal.save(newUniswapTokenOperation({ operationId, profile: material.profile, account: material.account,
            route: material.route, approvalCapAtomic: material.approvalCapAtomic, allowanceAtPrepare: material.allowanceAtPrepare,
            approvalGas: material.approvalGas, swapGas: material.swapGas, cleanupGas: material.cleanupGas,
            maximumNativeDebitWei: material.maximumNativeDebitWei, policyDigest: material.policyDigest,
            mechanismDigest: material.mechanismDigest, now: this.ports.now() }));
        await this.rpcBudget?.reconcile(operationId); return saved;
    }
    async approve(id: string) { return await this.budgeted(id, "swap.uniswap-token.approve", 14, async () => await this.execution.approve(id)); }
    async execute(id: string) { const phase = (await this.journal.load(id))?.phase, beforeEffect = phase === "approved" || phase === "approval_observed";
      return await this.budgeted(id, "swap.uniswap-token.execute", beforeEffect ? 24 : 0, async () => await this.execution.execute(id)); }
    async status(id: string) { return await this.budgeted(id, "swap.uniswap-token.status", 0, async () => await this.execution.status(id)); }
    async cleanup(id: string) { return await this.budgeted(id, "swap.uniswap-token.cleanup", 0, async () => await this.execution.cleanup(id)); }
    private async budgeted<T>(id: string, command: string, cap: number, work: () => Promise<T>) { if (this.rpcBudget === undefined) return await work();
      await this.rpcBudget.reconcile(id); const reservation = await this.rpcBudget.reserve(id, command, cap); try { return await work(); }
      finally { await this.rpcBudget.settle(id, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0); } }
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
