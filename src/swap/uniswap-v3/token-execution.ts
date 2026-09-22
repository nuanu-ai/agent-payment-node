import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { UniswapTokenOperation, UniswapTokenPhase, UniswapTokenReceipt } from "./token-operation.js";
import type { TokenUsageBinding } from "./token-usage.js";
import { tokenAttempt, transitionUniswapToken, UniswapTokenJournal, validateUniswapTokenOperation } from "./token-operation.js";

export type TokenEffectKind = "approval" | "swap" | "cleanup";
export interface TokenSealedEffect { readonly transactionHash: string; readonly envelopeHash: string }
export interface TokenEffectObservation { readonly status: "pending" | "success" | "reverted"; readonly transactionHash: string;
  readonly gasDebitWei: string; readonly allowanceAtomic: string; readonly inputDebitAtomic?: string; readonly outputCreditAtomic?: string }
export interface UniswapTokenExecutionPorts {
  now(): Date; foregroundApprove(operation: UniswapTokenOperation): Promise<void>; foregroundCleanup(operation: UniswapTokenOperation): Promise<void>;
  withAccountLock<T>(operation: UniswapTokenOperation, work: () => Promise<T>): Promise<T>;
  allocateNonce(operation: UniswapTokenOperation, kind: TokenEffectKind): Promise<string>; currentAllowance(operation: UniswapTokenOperation): Promise<string>;
  releaseNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
  commitNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
  guard(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
  revalidate(operation: UniswapTokenOperation): Promise<void>;
  reserveUsage(operation: UniswapTokenOperation): Promise<TokenUsageBinding>;
  currentUsage(operation: UniswapTokenOperation): Promise<TokenUsageBinding>;
  followUsage(operation: UniswapTokenOperation, target: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert"): Promise<TokenUsageBinding>;
  seal(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect>;
  probeSealed(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect | null>;
  send(operation: UniswapTokenOperation, kind: TokenEffectKind): Promise<"accepted" | "ambiguous">;
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
    await this.ports.foregroundApprove(op); const usage = await this.ports.reserveUsage(op);
    op = await this.persist(transitionUniswapToken(op, "approved", usagePatch(usage), this.ports.now()));
    return await this.execute(id);
  }
  async execute(id: string): Promise<UniswapTokenOperation> {
    let op = await this.syncUsage(await this.required(id)); if (["observed", "cleaned", "cleanup_required"].includes(op.phase)) return op;
    if (this.ports.now().getTime() >= op.route.deadline * 1000 && !active(op.phase)) return await this.cleanupRequired(op, "deadline_expired");
    if (op.phase === "approved") {
      const allowance = await this.ports.currentAllowance(op);
      if (allowance !== "0" && allowance !== op.route.amountIn) return await this.cleanupRequired(op, "approval_allowance_drift");
      op = allowance === op.route.amountIn ? await this.persist(transitionUniswapToken(op, "approval_observed", {}, this.ports.now())) : await this.start(op, "approval");
    }
    if (approvalActive(op.phase)) return await this.observeApproval(await this.continueStart(op, "approval"));
    if (op.phase === "approval_observed") { try { await this.ports.revalidate(op); }
      catch { return await this.cleanupRequired(op, "post_approval_revalidation_failed"); }
      op = await this.start(op, "swap"); }
    if (swapActive(op.phase)) return await this.observeSwap(await this.continueStart(op, "swap"));
    return op;
  }
  async status(id: string): Promise<UniswapTokenOperation> {
    const op = await this.syncUsage(await this.required(id));
    if (approvalActive(op.phase)) return await this.observeApproval(op);
    if (swapActive(op.phase)) return await this.observeSwap(op);
    if (cleanupActive(op.phase)) return await this.observeCleanup(op);
    return op;
  }
  async cleanup(id: string): Promise<UniswapTokenOperation> {
    let op = await this.syncUsage(await this.required(id)); if (op.phase !== "cleanup_required") blocked("Token swap cleanup is not required.", "uniswap_cleanup_phase");
    await this.ports.foregroundCleanup(op);
    if (await this.ports.currentAllowance(op) === "0") return await this.cleaned(op);
    op = await this.start(op, "cleanup"); return await this.observeCleanup(await this.continueStart(op, "cleanup"));
  }
  private async start(op: UniswapTokenOperation, kind: TokenEffectKind) {
    return await this.ports.withAccountLock(op, async () => { const nonce = await this.ports.allocateNonce(op, kind), attempt = tokenAttempt(op, kind, nonce, this.ports.now());
      op = await this.persist(transitionUniswapToken(op, started(kind), { [`${kind}Attempt`]: attempt }, this.ports.now()));
      return await this.finishStart(op, kind); });
  }
  private async continueStart(op: UniswapTokenOperation, kind: TokenEffectKind) { if (attemptOf(op, kind).transactionHash !== null) return op;
    return await this.ports.withAccountLock(op, async () => { const attempt = attemptOf(op, kind), nonce = await this.ports.allocateNonce(op, kind);
      if (nonce !== attempt.nonce) { await this.ports.releaseNonce(op, kind, nonce); return await this.cleanupRequired(op, `${kind}_nonce_reservation_lost`); }
      return await this.finishStart(op, kind); }); }
  private async finishStart(op: UniswapTokenOperation, kind: TokenEffectKind) {
    const attempt = attemptOf(op, kind); if (attempt.transactionHash !== null || op.phase !== started(kind)) return op;
    try { await this.ports.guard(op, kind, attempt.nonce); }
    catch { await this.ports.releaseNonce(op, kind, attempt.nonce); return await this.cleanupRequired(op, kind === "swap" ? "post_approval_revalidation_failed" : `${kind}_pre_sign_failed`); }
    let sealed: TokenSealedEffect;
    try { sealed = await this.ports.seal(op, kind, attempt.nonce); }
    catch (error) { const durable = await this.ports.probeSealed(op, kind, attempt.nonce);
      if (durable !== null) { await this.ports.commitNonce(op, kind, attempt.nonce); throw error; }
      await this.ports.releaseNonce(op, kind, attempt.nonce); return await this.cleanupRequired(op, `${kind}_sign_failed`); }
    await this.ports.commitNonce(op, kind, attempt.nonce);
    op = await this.persist(transitionUniswapToken(op, started(kind), { [`${kind}Attempt`]: { ...attempt, transactionHash: sealed.transactionHash } }, this.ports.now()));
    let result: "accepted" | "ambiguous"; try { result = await this.ports.send(op, kind); } catch { result = "ambiguous"; }
    const usage = kind === "swap" ? await this.ports.followUsage(op, result === "accepted" ? "submitted" : "unknown_finality") : null;
    return await this.persist(transitionUniswapToken(op, result === "accepted" ? submitted(kind) : unknown(kind), usage === null ? {} : usagePatch(usage), this.ports.now()));
  }
  private async observeApproval(op: UniswapTokenOperation) {
    const hash = op.approvalAttempt?.transactionHash; if (hash === null || hash === undefined) return op;
    const result = await this.ports.observe(op, "approval", hash); if (result === null || result.status === "pending") return op;
    const native = debit(op, result.gasDebitWei);
    if (result.status === "reverted" || result.allowanceAtomic !== op.route.amountIn) return await this.cleanupRequired(op, "approval_failed_or_mismatch", native);
    return await this.persist(transitionUniswapToken(op, "approval_observed", { accumulatedNativeDebitWei: native }, this.ports.now()));
  }
  private async observeSwap(op: UniswapTokenOperation) {
    const hash = op.swapAttempt?.transactionHash; if (hash === null || hash === undefined) return op;
    const result = await this.ports.observe(op, "swap", hash); if (result === null || result.status === "pending") return op;
    const nativeDebitWei = debit(op, result.gasDebitWei);
    if (result.status === "reverted") { const usage = await this.ports.followUsage(op, "failed_confirmed_revert");
      return await this.cleanupRequired(op, "swap_reverted", nativeDebitWei, usage); }
    if (result.allowanceAtomic !== "0" || result.inputDebitAtomic !== op.route.amountIn || BigInt(result.outputCreditAtomic ?? "0") < BigInt(op.route.amountOutMinimum)) return await this.cleanupRequired(op, "swap_effect_mismatch", nativeDebitWei);
    const receiptBody = { schemaVersion: "apn.uniswap-token-receipt.v1", operationId: op.operationId, approvalGasWei: op.accumulatedNativeDebitWei,
      swapGasWei: result.gasDebitWei, cleanupGasWei: "0", nativeDebitWei, inputDebitAtomic: op.route.amountIn, outputCreditAtomic: result.outputCreditAtomic!,
      residualAllowanceAtomic: "0" as const, transactionHash: hash, observedAt: this.ports.now().toISOString() } as const;
    const receipt: UniswapTokenReceipt = { ...receiptBody, receiptHash: domainHash("apn.uniswap-token-receipt.v1", canonicalJson(receiptBody)) };
    const usage = await this.ports.followUsage(op, "finalized");
    return await this.persist(transitionUniswapToken(op, "observed", { accumulatedNativeDebitWei: nativeDebitWei, receipt, ...usagePatch(usage) }, this.ports.now()));
  }
  private async observeCleanup(op: UniswapTokenOperation) {
    const hash = op.cleanupAttempt?.transactionHash; if (hash === null || hash === undefined) return op;
    const result = await this.ports.observe(op, "cleanup", hash); if (result === null || result.status === "pending") return op;
    const native = debit(op, result.gasDebitWei);
    if (result.status !== "success" || result.allowanceAtomic !== "0") return await this.persist(transitionUniswapToken(op, "cleanup_unknown_finality", { accumulatedNativeDebitWei: native, cleanupReason: "cleanup_reverted_or_mismatch" }, this.ports.now()));
    return await this.cleaned(op, native);
  }
  private async cleaned(op: UniswapTokenOperation, native = op.accumulatedNativeDebitWei) { const usage = op.swapAttempt?.transactionHash == null
    ? await this.ports.followUsage(op, "failed_before_effect") : await this.ports.currentUsage(op);
    return await this.persist(transitionUniswapToken(op, "cleaned", { accumulatedNativeDebitWei: native, ...usagePatch(usage) }, this.ports.now())); }
  private async cleanupRequired(op: UniswapTokenOperation, reason: string, native = op.accumulatedNativeDebitWei, usage?: TokenUsageBinding) {
    return await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupReason: reason, accumulatedNativeDebitWei: native,
      ...(usage === undefined ? {} : usagePatch(usage)) }, this.ports.now())); }
  private async syncUsage(op: UniswapTokenOperation) { if (op.usageReservationId === null) return op; const usage = await this.ports.currentUsage(op);
    return op.usageState === usage.state && op.usageReservationId === usage.reservationId ? op :
      await this.persist(transitionUniswapToken(op, op.phase, usagePatch(usage), this.ports.now())); }
  private async required(id: string) { const op = await this.journal.load(id); if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Uniswap token operation was not found."); return op; }
  private async persist(op: UniswapTokenOperation) { return await this.journal.save(validateUniswapTokenOperation(op)); }
}
function attemptOf(op: UniswapTokenOperation, kind: TokenEffectKind) { const v = kind === "approval" ? op.approvalAttempt : kind === "swap" ? op.swapAttempt : op.cleanupAttempt; if (v === null) throw new ApnError("APN_STATE_CORRUPT", "Uniswap token attempt is missing."); return v; }
function started(kind: TokenEffectKind): UniswapTokenPhase { return kind === "approval" ? "approval_submission_started" : kind === "swap" ? "submission_started" : "cleanup_submission_started"; }
function submitted(kind: TokenEffectKind): UniswapTokenPhase { return kind === "approval" ? "approval_submitted" : kind === "swap" ? "submitted" : "cleanup_submitted"; }
function unknown(kind: TokenEffectKind): UniswapTokenPhase { return kind === "approval" ? "approval_unknown_finality" : kind === "swap" ? "unknown_finality" : "cleanup_unknown_finality"; }
function approvalActive(p: UniswapTokenPhase) { return ["approval_submission_started", "approval_submitted", "approval_unknown_finality"].includes(p); }
function swapActive(p: UniswapTokenPhase) { return ["submission_started", "submitted", "unknown_finality"].includes(p); }
function cleanupActive(p: UniswapTokenPhase) { return ["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(p); }
function active(p: UniswapTokenPhase) { return approvalActive(p) || swapActive(p) || cleanupActive(p); }
function usagePatch(value: TokenUsageBinding) { return { usageReservationId: value.reservationId, usageState: value.state }; }
function debit(op: UniswapTokenOperation, added: string) { const total = BigInt(op.accumulatedNativeDebitWei) + BigInt(added); if (total > BigInt(op.maximumNativeDebitWei)) blocked("Native debit exceeded the approved budget.", "uniswap_native_debit_exceeded"); return total.toString(); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
