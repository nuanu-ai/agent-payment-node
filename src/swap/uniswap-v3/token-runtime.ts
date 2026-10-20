import { canonicalJson, domainHash } from "../../canonical.js";
import type { CommandRequest } from "../../commands.js";
import { ApnError } from "../../errors.js";
import { swapMechanismDigest } from "../pin.js";
import type { UniswapTokenQuoteBuilder } from "./token-builder.js";
import { UniswapTokenExecution, type TokenCleanupFees, type UniswapTokenCommandRuntime, type UniswapTokenExecutionPorts } from "./token-execution.js";
import type { SavedUniswapTokenMaterialStore, UniswapTokenMaterial } from "./token-material.js";
import { newUniswapTokenOperation, UniswapTokenJournal } from "./token-operation.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "./token-route.js";
import { UniswapTokenRpcBudgetJournal } from "./token-rpc-budget.js";
import type { TokenRpcCall } from "./token-rpc.js";
import { admitOperation } from "../../operation-index/admission.js";
import { evmClaim, namedProfileHash } from "../../operation-index/adapters/family-claims.js";
import { UNISWAP_TOKEN_CHAIN_ID } from "../../operation-index/adapters/uniswap-token.js";
/**
 * Execute's request plan in HTTP POSTs, counted from its code path (up to three reads per batch, one POST each, no retries).
 * An effect reads the pending nonce (1), the signing block (1), the code pins at it (4: four batches with the archive chain id
 * in the first, or the pooled archive's anchor and three), the state at it (1: allowance and balance, plus a swap's fresh
 * quote), the simulation (1) and gas estimate (1; a swap's carries the block recheck), the fees and native balance with
 * the block recheck (1); then the send (1; its slot is held before the attempt marker, so no read can take it) and the
 * first observation (at most 3: transaction, receipt, then block and safe head). A swap is 14; an approval execute
 * resumes reads the allowance first, 15. Each further candidate of a pooled primary may cost one more probe.
 */
export const UNISWAP_TOKEN_EXECUTE_PLAN = 15;
/** The plan's cap for a command whose first primary batch may probe each candidate of a pooled primary once. */
export function uniswapTokenProbedCap(plan: number, poolCandidates: number): number { return plan + Math.max(0, poolCandidates - 1); }
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
    }>) { const binding = domainHash("apn.uniswap-token-quote-attempt.v1", canonicalJson(request));
      const cap = this.probedCap(8), reservation = await this.rpcBudget?.reserve(binding, request.command, cap, cap, "quote"); let result: { readonly quoteHash: string } | undefined;
      try { result = await this.builder.quote(request) as { readonly quoteHash: string }; return result; }
      finally { if (reservation !== undefined) { await this.rpcBudget!.settle(binding, reservation, this.rpc?.telemetry?.() ?? null,
          this.rpc?.effectAttempts?.() ?? 0, this.rpc?.primaryPoolTelemetry?.()); if (result !== undefined) await this.rpcBudget!.linkQuote(binding, result.quoteHash); } } }
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
        // A new swap's account claim is written before its confirmation reads; a replay keeps its existing path.
        if (await this.journal.read(operationId) !== null) return await this.prepareBody(request, material, operationId);
        return await admitOperation(this.journal, { family: "uniswap_token", profileHash: namedProfileHash(material.profile), operationId,
            idempotencyHash: null, requestHash: null }, [evmClaim(UNISWAP_TOKEN_CHAIN_ID, material.account)],
            async () => await this.prepareBody(request, material, operationId));
    }
    private async prepareBody(request: Prepare, material: UniswapTokenMaterial, operationId: string) {
        const cap = this.probedCap(9), reservation = await this.rpcBudget?.reserve(request.quoteHash, request.command, cap, cap, "prepare");
        try { await this.ports.confirm(material); }
        finally { if (reservation !== undefined) await this.rpcBudget!.settle(request.quoteHash, reservation, this.rpc?.telemetry?.() ?? null,
          this.rpc?.effectAttempts?.() ?? 0, this.rpc?.primaryPoolTelemetry?.()); }
        await this.rpcBudget?.linkQuote(request.quoteHash, operationId);
        const prior = await this.journal.load(operationId);
        if (prior !== null) { await this.rpcBudget?.reconcile(operationId); return prior; }
        const saved = await this.journal.save(newUniswapTokenOperation({ operationId, profile: material.profile, account: material.account,
            route: material.route, approvalCapAtomic: material.approvalCapAtomic, allowanceAtPrepare: material.allowanceAtPrepare,
            approvalGas: material.approvalGas, swapGas: material.swapGas, cleanupGas: material.cleanupGas,
            maximumNativeDebitWei: material.maximumNativeDebitWei, policyDigest: material.policyDigest,
            mechanismDigest: material.mechanismDigest, quoteBlock: { number: material.blockNumber, hash: material.blockHash }, now: this.ports.now() }));
        await this.rpcBudget?.reconcile(operationId); return saved;
    }
    async approve(id: string) { return await this.budgeted(id, "swap.uniswap-token.approve", async () => { const cap = this.poolCap(14);
      return [cap, cap, "approval_effect"] as const; }, async () => await this.execution.approve(id)); }
    async execute(id: string) { return await this.budgeted(id, "swap.uniswap-token.execute", async () => {
      const phase = (await this.journal.load(id))?.phase;
      const cap = this.probedCap(UNISWAP_TOKEN_EXECUTE_PLAN);
      return phase === "approved" || phase === "approval_observed" ? [cap, cap, "swap_effect"] as const : [0, cap, "recovery"] as const;
    }, async () => await this.execution.execute(id)); }
    async status(id: string) { return await this.budgeted(id, "swap.uniswap-token.status", async () => [0, this.poolCap(11), "recovery"] as const, async () => await this.execution.status(id)); }
    /** The live allowance where one may still stand on a terminal record: an expired approval cleaned without a swap, or an owner abandon. */
    async residualAllowance(op: import("./token-operation.js").UniswapTokenOperation) {
      const standing = op.phase === "cleaned" && op.cleanupEvidence?.kind === "expired_approval_no_swap" ||
        op.phase === "abandoned_unknown" && (op.approvalAttempt?.transactionHash != null || op.allowanceAtPrepare !== "0");
      if (!standing) return null;
      return await this.budgeted(op.operationId, "swap.uniswap-token.status", async () => [0, this.poolCap(11), "recovery"] as const,
        async () => await this.ports.currentAllowance(op));
    }
    async cleanup(id: string, fees?: TokenCleanupFees) { return await this.budgeted(id, "swap.uniswap-token.cleanup", async () => [0, this.poolCap(14), "recovery"] as const, async () => await this.execution.cleanup(id, fees)); }
    private async budgeted<T>(id: string, command: string,
      budget: () => Promise<readonly [number, number, NonNullable<import("./token-rpc-budget.js").TokenRpcBudgetRow["budgetClass"]>]>, work: () => Promise<T>) {
      return await this.journal.withLocks([`uniswap-token-runtime:${id}`], async () => { const [cap, requestSessionCap, budgetClass] = await budget();
        if (this.rpcBudget === undefined) return await work();
        await this.rpcBudget.reconcile(id); const reservation = await this.rpcBudget.reserve(id, command, cap, requestSessionCap, budgetClass); try { return await work(); }
        finally { await this.rpcBudget.settle(id, reservation, this.rpc?.telemetry?.() ?? null, this.rpc?.effectAttempts?.() ?? 0,
          this.rpc?.primaryPoolTelemetry?.()); } }); }
    private poolCap(base: number) { return base + (this.rpc?.primaryPoolEnabled?.() === true ? this.rpc.primaryPoolSize?.() ?? 3 : 0); }
    private probedCap(plan: number) { return uniswapTokenProbedCap(plan, this.rpc?.primaryPoolEnabled?.() === true ? this.rpc.primaryPoolSize?.() ?? 3 : 0); }
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
