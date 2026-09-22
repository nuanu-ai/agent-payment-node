import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { UniswapTokenOperation, UniswapTokenPhase, UniswapTokenReceipt } from "./token-operation.js";
import { tokenAttempt, transitionUniswapToken, UniswapTokenJournal, validateUniswapTokenOperation } from "./token-operation.js";

export type TokenEffectKind = "approval" | "swap" | "cleanup";
export interface TokenEffectObservation { readonly status: "pending" | "success" | "reverted"; readonly transactionHash: string;
  readonly gasDebitWei: string; readonly allowanceAtomic: string; readonly inputDebitAtomic?: string; readonly outputCreditAtomic?: string }
export interface UniswapTokenExecutionPorts {
  now(): Date; foregroundApprove(operation: UniswapTokenOperation): Promise<void>; currentNonce(account: string): Promise<string>;
  currentAllowance(operation: UniswapTokenOperation): Promise<string>; submit(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<string>;
  observe(operation: UniswapTokenOperation, kind: TokenEffectKind, transactionHash: string): Promise<TokenEffectObservation | null>;
}
export interface UniswapTokenCommandRuntime {
  inventory(): unknown; quote(request: Extract<import("../../commands.js").CommandRequest, { readonly command: "swap.uniswap-token.quote" }>): Promise<unknown>;
  prepare(request: Extract<import("../../commands.js").CommandRequest, { readonly command: "swap.uniswap-token.prepare" }>): Promise<UniswapTokenOperation>;
  approve(id: string): Promise<UniswapTokenOperation>; execute(id: string): Promise<UniswapTokenOperation>;
  status(id: string): Promise<UniswapTokenOperation>; cleanup(id: string): Promise<UniswapTokenOperation>;
}

export class UniswapTokenExecution {
  constructor(private readonly journal: UniswapTokenJournal, private readonly ports: UniswapTokenExecutionPorts) {}
  async approve(id: string): Promise<UniswapTokenOperation> {
    let op = await this.required(id); if (op.phase !== "prepared") blocked("Token swap is not prepared.", "uniswap_token_phase");
    await this.ports.foregroundApprove(op); op = await this.persist(transitionUniswapToken(op, "approved", {}, this.ports.now()));
    return await this.execute(id);
  }
  async execute(id: string): Promise<UniswapTokenOperation> {
    let op = await this.required(id); if (["observed", "cleaned"].includes(op.phase)) return op;
    if (op.phase === "cleanup_required") return await this.cleanup(id);
    if (this.ports.now().getTime() >= op.route.deadline * 1000 && !["approval_submission_started", "approval_submitted", "approval_unknown_finality", "submission_started", "submitted", "unknown_finality"].includes(op.phase)) {
      return await this.cleanupRequired(op, "deadline_expired");
    }
    if (op.phase === "approved") {
      const allowance = await this.ports.currentAllowance(op);
      if (allowance !== "0" && allowance !== op.route.amountIn) blocked("Allowance must be zero or the exact input amount.", "uniswap_allowance_mismatch");
      if (allowance === op.route.amountIn) op = await this.persist(transitionUniswapToken(op, "approval_observed", {}, this.ports.now()));
      else op = await this.start(op, "approval");
    }
    if (["approval_submission_started", "approval_submitted", "approval_unknown_finality"].includes(op.phase)) return await this.observeApproval(op);
    if (op.phase === "approval_observed") {
      if (await this.ports.currentAllowance(op) !== op.route.amountIn) return await this.cleanupRequired(op, "approval_drift");
      op = await this.start(op, "swap");
    }
    if (["submission_started", "submitted", "unknown_finality"].includes(op.phase)) return await this.observeSwap(op);
    return op;
  }
  async status(id: string): Promise<UniswapTokenOperation> {
    const op = await this.required(id);
    if (["approval_submission_started", "approval_submitted", "approval_unknown_finality"].includes(op.phase)) return await this.observeApproval(op);
    if (["submission_started", "submitted", "unknown_finality"].includes(op.phase)) return await this.observeSwap(op);
    if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase)) return await this.observeCleanup(op);
    return op;
  }
  async cleanup(id: string): Promise<UniswapTokenOperation> { let op = await this.required(id);
    if (op.phase !== "cleanup_required") blocked("Token swap cleanup is not required.", "uniswap_cleanup_phase");
    if (await this.ports.currentAllowance(op) === "0") return await this.persist(transitionUniswapToken(op, "cleaned", {}, this.ports.now()));
    op = await this.start(op, "cleanup"); return await this.observeCleanup(op); }
  private async start(op: UniswapTokenOperation, kind: TokenEffectKind) {
    const nonce = await this.ports.currentNonce(op.account), attempt = tokenAttempt(op, kind, nonce, this.ports.now());
    const phase: UniswapTokenPhase = kind === "approval" ? "approval_submission_started" : kind === "swap" ? "submission_started" : "cleanup_submission_started";
    op = await this.persist(transitionUniswapToken(op, phase, { [`${kind}Attempt`]: attempt }, this.ports.now()));
    let hash: string; try { hash = await this.ports.submit(op, kind, nonce); } catch { return op; }
    if (!/^0x[a-f0-9]{64}$/u.test(hash)) return op;
    const submitted: UniswapTokenPhase = kind === "approval" ? "approval_submitted" : kind === "swap" ? "submitted" : "cleanup_submitted";
    return await this.persist(transitionUniswapToken(op, submitted, { [`${kind}Attempt`]: { ...attempt, transactionHash: hash } }, this.ports.now()));
  }
  private async observeApproval(op: UniswapTokenOperation) {
    const hash = op.approvalAttempt?.transactionHash; if (hash === null || hash === undefined) return op;
    const result = await this.ports.observe(op, "approval", hash); if (result === null || result.status === "pending") return op;
    if (result.status === "reverted" || result.allowanceAtomic !== op.route.amountIn) return await this.cleanupRequired(op, "approval_failed_or_mismatch");
    return await this.persist(transitionUniswapToken(op, "approval_observed", { accumulatedNativeDebitWei: debit(op, result.gasDebitWei) }, this.ports.now()));
  }
  private async observeSwap(op: UniswapTokenOperation) {
    const hash = op.swapAttempt?.transactionHash; if (hash === null || hash === undefined) return op;
    const result = await this.ports.observe(op, "swap", hash); if (result === null || result.status === "pending") return op;
    if (result.status === "reverted") return await this.cleanupRequired(op, "swap_reverted");
    if (result.allowanceAtomic !== "0" || result.inputDebitAtomic !== op.route.amountIn || BigInt(result.outputCreditAtomic ?? "0") < BigInt(op.route.amountOutMinimum)) {
      return await this.cleanupRequired(op, "swap_effect_mismatch");
    }
    const approvalGasWei = op.accumulatedNativeDebitWei, cleanupGasWei = "0", swapGasWei = result.gasDebitWei,
      nativeDebitWei = debit(op, result.gasDebitWei);
    if (BigInt(nativeDebitWei) > BigInt(op.maximumNativeDebitWei)) return await this.cleanupRequired(op, "native_debit_exceeded");
    const receiptBody = { schemaVersion: "apn.uniswap-token-receipt.v1", operationId: op.operationId, approvalGasWei, swapGasWei, cleanupGasWei,
      nativeDebitWei, inputDebitAtomic: op.route.amountIn, outputCreditAtomic: result.outputCreditAtomic!, residualAllowanceAtomic: "0" as const,
      transactionHash: hash, observedAt: this.ports.now().toISOString() } as const;
    const receipt: UniswapTokenReceipt = { ...receiptBody, receiptHash: domainHash("apn.uniswap-token-receipt.v1", canonicalJson(receiptBody)) };
    return await this.persist(transitionUniswapToken(op, "observed", { accumulatedNativeDebitWei: nativeDebitWei, receipt }, this.ports.now()));
  }
  private async observeCleanup(op: UniswapTokenOperation) { const hash = op.cleanupAttempt?.transactionHash; if (hash === null || hash === undefined) return op;
    const result = await this.ports.observe(op, "cleanup", hash); if (result === null || result.status === "pending") return op;
    if (result.status !== "success" || result.allowanceAtomic !== "0") blocked("Cleanup did not prove zero allowance.", "uniswap_cleanup_failed");
    return await this.persist(transitionUniswapToken(op, "cleaned", { accumulatedNativeDebitWei: debit(op, result.gasDebitWei) }, this.ports.now())); }
  private async cleanupRequired(op: UniswapTokenOperation, reason: string) { return await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupReason: reason }, this.ports.now())); }
  private async required(id: string) { const op = await this.journal.load(id); if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Uniswap token operation was not found."); return op; }
  private async persist(op: UniswapTokenOperation) { return await this.journal.save(validateUniswapTokenOperation(op)); }
}
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
function debit(op: UniswapTokenOperation, added: string) { const total = BigInt(op.accumulatedNativeDebitWei) + BigInt(added); if (total > BigInt(op.maximumNativeDebitWei)) blocked("Native debit exceeded the approved budget.", "uniswap_native_debit_exceeded"); return total.toString(); }
