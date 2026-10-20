import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { NeverLandsCheck } from "../../evm-finalized-proof.js";
import type { UniswapTokenAttempt, UniswapTokenOperation, UniswapTokenPhase, UniswapTokenReceipt, UniswapTokenRetiredEffect } from "./token-operation.js";
import { principalReleaseCandidate, type TokenNonceConsumption } from "./token-principal.js";
import type { TokenUsageBinding } from "./token-usage.js";
import { sanitizeUniswapTokenFailureField, tokenAttempt, transitionUniswapToken, UniswapTokenJournal, validateUniswapTokenOperation } from "./token-operation.js";

export type TokenEffectKind = "approval" | "swap" | "cleanup";
export interface TokenSealedEffect { readonly transactionHash: string; readonly envelopeHash: string }
export interface TokenEffectObservation { readonly status: "pending" | "success" | "reverted"; readonly transactionHash: string;
  readonly gasDebitWei: string; readonly allowanceAtomic: string; readonly inputDebitAtomic?: string; readonly outputCreditAtomic?: string }
/** The owner's own caps for one cleanup (re-quote) and the fresh fee quote they are checked against. */
export interface TokenCleanupFees { readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string }
export interface TokenFeeQuote { readonly blockNumber: string; readonly blockHash: string; readonly baseFeePerGasWei: string; readonly priorityFeePerGasWei: string }
export interface UniswapTokenExecutionPorts {
  now(): Date; foregroundApprove(operation: UniswapTokenOperation): Promise<void>; foregroundCleanup(operation: UniswapTokenOperation): Promise<void>;
  withAccountLock<T>(operation: UniswapTokenOperation, work: () => Promise<T>): Promise<T>;
  allocateNonce(operation: UniswapTokenOperation, kind: TokenEffectKind): Promise<string>; currentAllowance(operation: UniswapTokenOperation): Promise<string>;
  /** True when custody holds no signed bytes for the effect and its reservation is free; false when a signed effect committed it. */
  releaseNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<boolean>;
  commitNonce(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
  /** The signing guard: every pre-sign check of the effect at one fresh block (for a swap, its full revalidation). */
  guard(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void>;
  /** Holds the command's one send slot, so no read can spend it; taken before any attempt marker is written. */
  reserveSendCapacity?(): void;
  reserveUsage(operation: UniswapTokenOperation): Promise<TokenUsageBinding>;
  currentUsage(operation: UniswapTokenOperation): Promise<TokenUsageBinding>;
  followUsage(operation: UniswapTokenOperation, target: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert" | "released_unsubmitted"): Promise<TokenUsageBinding>;
  /** R4 exit 2: at the finalized tag the account's nonce passed the attempt's nonce and the node knows neither its transaction nor a receipt. */
  neverLands?(operation: UniswapTokenOperation, kind: TokenEffectKind, attempt: UniswapTokenAttempt): Promise<NeverLandsCheck>;
  seal(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect>;
  probeSealed(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect | null>;
  recoverSealed?(operation: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect | null>;
  send(operation: UniswapTokenOperation, kind: TokenEffectKind): Promise<"accepted" | "ambiguous">;
  observe(operation: UniswapTokenOperation, kind: TokenEffectKind, transactionHash: string): Promise<TokenEffectObservation | null>;
  /** Current Ethereum base and priority fee (the reads the signing guard prices the same caps with). */
  cleanupFeeQuote?(operation: UniswapTokenOperation): Promise<TokenFeeQuote>;
  /** The finalized chain's proof that a landed cleanup of this operation took the hashless swap marker's nonce; null: not proven. */
  swapNonceConsumed?(operation: UniswapTokenOperation, cleanup: UniswapTokenAttempt): Promise<TokenNonceConsumption | null>;
}
export interface UniswapTokenCommandRuntime {
  inventory(): unknown; quote(request: Extract<import("../../commands.js").CommandRequest, { readonly command: "swap.uniswap-token.quote" }>): Promise<unknown>;
  prepare(request: Extract<import("../../commands.js").CommandRequest, { readonly command: "swap.uniswap-token.prepare" }>): Promise<UniswapTokenOperation>;
  approve(id: string): Promise<UniswapTokenOperation>; execute(id: string): Promise<UniswapTokenOperation>;
  status(id: string): Promise<UniswapTokenOperation>; cleanup(id: string, fees?: TokenCleanupFees): Promise<UniswapTokenOperation>;
}
export class UniswapTokenExecution {
  /** Effects broadcast by this invocation: their nonce cannot be finalized past yet, so no never-lands read is spent on them. */
  private readonly sentNow = new Set<TokenEffectKind>();
  constructor(private readonly journal: UniswapTokenJournal, private readonly ports: UniswapTokenExecutionPorts) {}
  async approve(id: string): Promise<UniswapTokenOperation> {
    let op = await this.retireExpiredPrepared(await this.required(id)); if (op.phase !== "prepared") blocked("Token swap is not prepared.", "uniswap_token_phase");
    await this.ports.foregroundApprove(op); const usage = await this.ports.reserveUsage(op);
    op = await this.persist(transitionUniswapToken(op, "approved", usagePatch(usage), this.ports.now()));
    op = await this.advanceApproval(op);
    return approvalActive(op.phase) ? await this.observeApproval(await this.continueStart(op, "approval")) : op;
  }
  async execute(id: string): Promise<UniswapTokenOperation> {
    let op = await this.retireExpiredPrepared(await this.syncUsage(await this.required(id))); if (["observed", "cleaned", "cleanup_required", "abandoned_unknown"].includes(op.phase)) return op;
    // A dropped marker leaves this command on the recovery budget it reserved: it may close an expired route (no effect),
    // otherwise it stops, and the next execute starts the effect afresh under an effect budget.
    const marked = op.phase; op = await this.resumeUnsigned(op, ["approval", "swap"]);
    if (op.phase !== marked && !expired(op, this.ports.now())) return op;
    if (expired(op, this.ports.now()) && !approvalActive(op.phase) && !swapActive(op.phase) && !cleanupActive(op.phase)) {
      if (op.phase === "approval_observed" && op.approvalAttempt?.transactionHash != null) return await this.retireExpiredApproval(op);
      return await this.cleanupRequired(op, "deadline_expired");
    }
    if (op.phase === "approved") op = await this.advanceApproval(op);
    if (approvalActive(op.phase)) return await this.observeApproval(await this.continueStart(op, "approval"));
    // The signing guard revalidates the swap (allowance, balance, quote floor, simulation, gas, fees) at its own block; a
    // refusal frees the nonce and records why before cleanup becomes required.
    if (op.phase === "approval_observed") op = await this.start(op, "swap");
    if (swapActive(op.phase)) return await this.observeSwap(await this.continueStart(op, "swap"));
    return op;
  }
  private async advanceApproval(op: UniswapTokenOperation) { const allowance = await this.ports.currentAllowance(op);
    if (allowance !== "0" && allowance !== op.route.amountIn) return await this.cleanupRequired(op, "approval_allowance_drift");
    return allowance === op.route.amountIn ? await this.persist(transitionUniswapToken(op, "approval_observed", {}, this.ports.now())) : await this.start(op, "approval"); }
  async status(id: string): Promise<UniswapTokenOperation> {
    const op = await this.retireExpiredPrepared(await this.syncUsage(await this.required(id)));
    if (approvalActive(op.phase)) return await this.observeApproval(await this.continueStart(op, "approval"));
    if (op.phase === "approval_observed" && expired(op, this.ports.now()) && op.approvalAttempt?.transactionHash != null)
      return await this.retireExpiredApproval(op);
    if (swapActive(op.phase)) return await this.observeSwap(await this.continueStart(op, "swap"));
    if (cleanupActive(op.phase)) return await this.observeCleanup(await this.continueStart(op, "cleanup"));
    return op.phase === "cleaned" ? await this.settlePrincipal(op) : op;
  }
  async cleanup(id: string, fees?: TokenCleanupFees): Promise<UniswapTokenOperation> {
    let op = await this.syncUsage(await this.required(id)); if (op.phase === "cleaned") return op;
    op = await this.resumeUnsigned(op, ["cleanup"]);
    if (op.phase !== "cleanup_required") blocked("Token swap cleanup is not required.", "uniswap_cleanup_phase");
    // The owner's own caps replace the frozen ones for this cleanup only: checked against a fresh fee quote, shown at the
    // consent below (its code binds the new caps), and saved only after it. Nothing raises them automatically.
    const requoted = fees === undefined ? null : requotedCleanup(op, fees, await this.feeQuote(op), this.ports.now());
    await this.ports.foregroundCleanup(requoted ?? op);
    if (requoted !== null) op = await this.persist(requoted);
    if (await this.ports.currentAllowance(op) === "0") {
      // Every attempt is a bound transaction that landed or was retired: the residual allowance is already gone.
      const attempts = [op.approvalAttempt, op.swapAttempt, op.cleanupAttempt].filter((row) => row !== null);
      if ((attempts.length > 0 || (op.retiredEffects ?? []).length > 0) && attempts.every((row) => row.transactionHash !== null)) {
        return await this.settlePrincipal(await this.persist(transitionUniswapToken(op, "cleaned", { cleanupReason: "zero_allowance_after_effect", cleanupEvidence: {
          schemaVersion: "apn.uniswap-token-zero-allowance-evidence.v1", kind: "zero_allowance_after_effect", observedAllowanceAtomic: "0",
          observedAt: this.ports.now().toISOString() }, ...usagePatch(await this.ports.currentUsage(op)) }, this.ports.now())));
      }
      await this.assertNoEffect(op);
      op = await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupReason: "zero_allowance_no_effect",
        cleanupEvidence: cleanupEvidence("current_allowance", this.ports.now()) }, this.ports.now())); return await this.cleaned(op); }
    // A cleanup refused before signing is back in cleanup_required with its diagnostic: nothing to observe.
    op = await this.start(op, "cleanup"); return cleanupActive(op.phase) ? await this.observeCleanup(await this.continueStart(op, "cleanup")) : op;
  }
  private async start(op: UniswapTokenOperation, kind: TokenEffectKind) {
    return await this.ports.withAccountLock(op, async () => {
      // The send's slot first: a command without room for it stops here, before a nonce or a marker exists.
      this.ports.reserveSendCapacity?.();
      const nonce = await this.ports.allocateNonce(op, kind), attempt = tokenAttempt(op, kind, nonce, this.ports.now());
      // Nothing signs before the marker is durable: a refused or raced marker hands the reservation back (or keeps a signed one).
      let marked: UniswapTokenOperation;
      try { marked = await this.persist(transitionUniswapToken(op, started(kind), { [`${kind}Attempt`]: attempt }, this.ports.now())); }
      catch (error) { await this.ports.releaseNonce(op, kind, nonce); throw error; }
      return await this.finishStart(marked, kind); });
  }
  private async continueStart(op: UniswapTokenOperation, kind: TokenEffectKind) {
    const attempt = attemptOf(op, kind); if (attempt.transactionHash !== null) return op;
    const recovered = await this.ports.recoverSealed?.(op, kind, attempt.nonce) ?? null;
    // Status cannot show that no signed bytes exist: custody saves them in the encrypted wallet before it writes the public
    // sealed effect, and recovery never opens custody (none was sent: a send needs the public effect). The forward command
    // (execute; cleanup for a cleanup) opens custody under the account lock and settles the marker (resumeUnsigned).
    if (recovered === null) throw new ApnError("APN_OPERATION_BLOCKED", "Started token effect has no public transaction evidence.", {
      reason: "uniswap_token_public_effect_missing", nextActions: [`apn swap ethereum uniswap-token ${kind === "cleanup" ? "cleanup" : "execute"} --operation ${op.operationId}`] });
    // A sealed transaction may or may not have reached the provider. Recovery observes it only.
    const usage = kind === "swap" ? await this.ports.followUsage(op, "unknown_finality") : null;
    return await this.persist(transitionUniswapToken(op, unknown(kind), {
      [`${kind}Attempt`]: { ...attempt, transactionHash: recovered.transactionHash },
      ...(usage === null ? {} : usagePatch(usage)),
    }, this.ports.now()));
  }
  private async finishStart(op: UniswapTokenOperation, kind: TokenEffectKind) {
    const attempt = attemptOf(op, kind); if (attempt.transactionHash !== null || op.phase !== started(kind)) return op;
    const recovered = await this.ports.probeSealed(op, kind, attempt.nonce);
    if (recovered !== null) { await this.ports.commitNonce(op, kind, attempt.nonce);
      op = await this.persist(transitionUniswapToken(op, started(kind), { [`${kind}Attempt`]: { ...attempt, transactionHash: recovered.transactionHash } }, this.ports.now()));
      return await this.submit(op, kind); }
    try { await this.ports.guard(op, kind, attempt.nonce); }
    catch (error) { const unsigned = await this.ports.releaseNonce(op, kind, attempt.nonce); return await this.cleanupRequired(op,
      kind === "swap" ? "post_approval_revalidation_failed" : `${kind}_pre_sign_failed`, op.accumulatedNativeDebitWei, undefined, diagnostic(error, op.phase), unmarked(kind, unsigned)); }
    let sealed: TokenSealedEffect;
    try { sealed = await this.ports.seal(op, kind, attempt.nonce); }
    catch (error) { const durable = await this.ports.probeSealed(op, kind, attempt.nonce);
      if (durable !== null) { await this.ports.commitNonce(op, kind, attempt.nonce); throw error; }
      const unsigned = await this.ports.releaseNonce(op, kind, attempt.nonce); return await this.cleanupRequired(op, `${kind}_sign_failed`, op.accumulatedNativeDebitWei, undefined, undefined, unmarked(kind, unsigned)); }
    await this.ports.commitNonce(op, kind, attempt.nonce);
    op = await this.persist(transitionUniswapToken(op, started(kind), { [`${kind}Attempt`]: { ...attempt, transactionHash: sealed.transactionHash } }, this.ports.now()));
    return await this.submit(op, kind);
  }
  private async submit(op: UniswapTokenOperation, kind: TokenEffectKind) {
    this.ports.reserveSendCapacity?.();
    this.sentNow.add(kind);
    let result: "accepted" | "ambiguous"; try { result = await this.ports.send(op, kind); } catch { result = "ambiguous"; }
    const usage = kind === "swap" ? await this.ports.followUsage(op, result === "accepted" ? "submitted" : "unknown_finality") : null;
    return await this.persist(transitionUniswapToken(op, result === "accepted" ? submitted(kind) : unknown(kind), usage === null ? {} : usagePatch(usage), this.ports.now()));
  }
  private async observeApproval(op: UniswapTokenOperation) {
    const hash = op.approvalAttempt?.transactionHash; if (hash === null || hash === undefined) return op;
    const result = await this.ports.observe(op, "approval", hash); if (result === null) return await this.retireIfNeverLanded(op, "approval");
    if (result.status === "pending") return op;
    const native = debit(op, result.gasDebitWei);
    if (result.status === "reverted" || result.allowanceAtomic !== op.route.amountIn) return await this.cleanupRequired(op, "approval_failed_or_mismatch", native);
    op = await this.persist(transitionUniswapToken(op, "approval_observed", { accumulatedNativeDebitWei: native }, this.ports.now()));
    return expired(op, this.ports.now()) ? await this.retireExpiredApproval(op, result) : op;
  }
  private async retireExpiredApproval(op: UniswapTokenOperation, observation?: TokenEffectObservation): Promise<UniswapTokenOperation> {
    if (op.phase !== "approval_observed" || op.swapAttempt !== null || op.cleanupAttempt !== null || !expired(op, this.ports.now()))
      blocked("Expired approval retirement requires an unsent swap.", "uniswap_token_expired_approval_unsafe");
    const hash = op.approvalAttempt?.transactionHash;
    if (hash == null) blocked("Approval evidence is missing.", "uniswap_token_expired_approval_unsafe");
    const result = observation ?? await this.ports.observe(op, "approval", hash);
    if (result === null || result.status === "pending") return op;
    if (result.status !== "success" || result.transactionHash !== hash || result.allowanceAtomic !== op.route.amountIn)
      return await this.cleanupRequired(op, "approval_failed_or_mismatch");
    const evidence = { schemaVersion: "apn.uniswap-token-expired-approval-evidence.v1" as const,
      kind: "expired_approval_no_swap" as const, approvalTransactionHash: hash,
      observedAllowanceAtomic: result.allowanceAtomic, observedAt: this.ports.now().toISOString() };
    op = await this.persist(transitionUniswapToken(op, "cleaned", { cleanupReason: "deadline_expired_after_approval", cleanupEvidence: evidence }, this.ports.now()));
    const usage = await this.ports.followUsage(op, "failed_before_effect");
    return await this.persist(transitionUniswapToken(op, "cleaned", usagePatch(usage), this.ports.now()));
  }
  private async observeSwap(op: UniswapTokenOperation) {
    const hash = op.swapAttempt?.transactionHash; if (hash === null || hash === undefined) return op;
    const result = await this.ports.observe(op, "swap", hash); if (result === null) return await this.retireIfNeverLanded(op, "swap");
    if (result.status === "pending") return op;
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
    const result = await this.ports.observe(op, "cleanup", hash); if (result === null) return await this.retireIfNeverLanded(op, "cleanup");
    if (result.status === "pending") return op;
    // A record a released version left in cleanup_unknown_finality already counted this landed cleanup's gas.
    const native = op.cleanupReason === "cleanup_reverted_or_mismatch" ? op.accumulatedNativeDebitWei : debit(op, result.gasDebitWei);
    if (result.status !== "success" || result.allowanceAtomic !== "0") {
      const reverted = result.status !== "success";
      return await this.rearmCleanup(op, this.retired(op, "cleanup", reverted ? "reverted" : "landed_allowance_nonzero", null),
        reverted ? "cleanup_reverted" : "cleanup_allowance_nonzero", native);
    }
    return await this.cleaned(op, native);
  }
  /**
   * R4 for a bound attempt the observer cannot find: once the finalized nonce passed it and the node knows neither its
   * transaction nor a receipt, it can never land. An approval that never landed leaves the swap with no effect (cleaned
   * when the allowance is still zero); a swap that never landed releases its hold as unsubmitted and keeps the approval
   * for the owner's cleanup; a cleanup that never landed is re-armed for a fresh, consented one. Nothing is re-signed here.
   */
  private async retireIfNeverLanded(op: UniswapTokenOperation, kind: TokenEffectKind): Promise<UniswapTokenOperation> {
    const attempt = attemptOf(op, kind); if (attempt.transactionHash === null || this.ports.neverLands === undefined || this.sentNow.has(kind)) return op;
    const check = await this.ports.neverLands(op, kind, attempt); if (!check.neverLands) return op;
    const retired = this.retired(op, kind, "never_landed", check.finalizedNonce.toString()), now = this.ports.now();
    if (kind === "cleanup") return await this.rearmCleanup(op, retired, "cleanup_never_landed", op.accumulatedNativeDebitWei);
    if (kind === "swap") { const usage = await this.ports.followUsage(op, "released_unsubmitted");
      return await this.persist(transitionUniswapToken(op, "cleanup_required", { swapAttempt: null, retiredEffects: retired, cleanupReason: "swap_never_landed",
        ...usagePatch(usage) }, now)); }
    const allowance = await this.ports.currentAllowance(op);
    op = await this.persist(transitionUniswapToken(op, "cleanup_required", { approvalAttempt: null, retiredEffects: retired, cleanupReason: "approval_never_landed" }, now));
    if (allowance !== "0" || effectHash(op)) return op;
    op = await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupReason: "zero_allowance_no_effect",
      cleanupEvidence: cleanupEvidence("current_allowance", now) }, now));
    return await this.cleaned(op);
  }
  /** The cleanup slot is freed for a new round; a landed cleanup's gas is counted and the cap grows by one more cleanup. */
  private async rearmCleanup(op: UniswapTokenOperation, retiredEffects: readonly UniswapTokenRetiredEffect[], reason: string, native: string) {
    const needed = BigInt(native) + BigInt(op.cleanupGas.gasLimit) * BigInt(op.cleanupGas.maxFeePerGas);
    return await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupAttempt: null, retiredEffects, cleanupReason: reason,
      accumulatedNativeDebitWei: native, maximumNativeDebitWei: needed > BigInt(op.maximumNativeDebitWei) ? needed.toString() : op.maximumNativeDebitWei }, this.ports.now()));
  }
  private retired(op: UniswapTokenOperation, kind: TokenEffectKind, reason: UniswapTokenRetiredEffect["reason"], finalizedNonceAtomic: string | null) {
    return [...op.retiredEffects ?? [], { kind, attempt: attemptOf(op, kind), reason, finalizedNonceAtomic, observedAt: this.ports.now().toISOString() }];
  }
  private async cleaned(op: UniswapTokenOperation, native = op.accumulatedNativeDebitWei) { const noEffect = !effectHash(op);
    if (noEffect && (op.cleanupEvidence ?? null) === null) corrupt("No-effect cleanup evidence is missing.");
    const usage = noEffect ? await this.ports.followUsage(op, "failed_before_effect") : await this.ports.currentUsage(op);
    return await this.settlePrincipal(await this.persist(transitionUniswapToken(op, "cleaned", { accumulatedNativeDebitWei: native,
      ...(noEffect ? { cleanupReason: "zero_allowance_no_effect" } : {}), ...usagePatch(usage) }, this.ports.now()))); }
  /**
   * A cleaned swap still holding its principal although no swap of it can land (R4 exit 2): no swap marker is left (never
   * signed), or its hashless marker's nonce is consumed in the finalized chain by its own landed cleanup. The proof is saved
   * first, then the hold is released; gas, attempts and history stay. Without such proof the hold stays (owner abandon).
   */
  private async settlePrincipal(op: UniswapTokenOperation): Promise<UniswapTokenOperation> {
    if (op.phase !== "cleaned" || op.usageState !== "reserved") return op;
    if (op.principalRelease === undefined) {
      const candidate = principalReleaseCandidate(op), now = this.ports.now(); if (candidate === null) return op;
      if (candidate.kind === "swap_never_signed") op = await this.persist(transitionUniswapToken(op, "cleaned", { principalRelease: {
        schemaVersion: "apn.uniswap-token-principal-release.v1", kind: "swap_never_signed", observedAt: now.toISOString() } }, now));
      else { const proof = await this.ports.swapNonceConsumed?.(op, candidate.cleanup) ?? null; if (proof === null) return op;
        op = await this.persist(transitionUniswapToken(op, "cleaned", { principalRelease: { schemaVersion: "apn.uniswap-token-principal-release.v1",
          kind: "swap_nonce_consumed_by_cleanup", swapNonce: candidate.swap.nonce, cleanupTransactionHash: candidate.cleanup.transactionHash!,
          cleanupBlockNumber: proof.blockNumber, cleanupBlockHash: proof.blockHash, finalizedBlockNumber: proof.finalizedBlockNumber,
          finalizedNonce: proof.finalizedNonce, observedAt: now.toISOString() } }, now)); }
    }
    return await this.persist(transitionUniswapToken(op, "cleaned", usagePatch(await this.ports.followUsage(op, "failed_before_effect")), this.ports.now()));
  }
  /**
   * A started attempt with no hash and no public sealed effect (a refusal or crash between its marker and signing): the
   * forward command opens custody under the account lock. Custody holding no signed bytes frees the nonce and proves the
   * attempt never signed (R4 exit 2), so its marker is dropped and the operation is where it was before the attempt (execute
   * then only closes an expired route; cleanup goes on to its consented cleanup). Signed bytes found are journaled with their
   * nonce committed, and recovery only observes them. Nothing is signed or sent here.
   */
  private async resumeUnsigned(op: UniswapTokenOperation, kinds: readonly TokenEffectKind[]): Promise<UniswapTokenOperation> {
    const kind = kinds.find((candidate) => op.phase === started(candidate)); if (kind === undefined) return op;
    const attempt = attemptOf(op, kind); if (attempt.transactionHash !== null || await this.ports.recoverSealed?.(op, kind, attempt.nonce) != null) return op;
    return await this.ports.withAccountLock(op, async () => { const current = await this.required(op.operationId);
      if (current.integrityHash !== op.integrityHash || !await this.ports.releaseNonce(current, kind, attempt.nonce)) return current;
      return await this.persist(transitionUniswapToken(current, kind === "approval" ? "approved" : kind === "swap" ? "approval_observed" : "cleanup_required",
        { [`${kind}Attempt`]: null }, this.ports.now())); });
  }
  private async cleanupRequired(op: UniswapTokenOperation, reason: string, native = op.accumulatedNativeDebitWei, usage?: TokenUsageBinding,
    preSignFailure?: import("./token-operation.js").UniswapTokenFailureDiagnostic, unmarkedAttempt: Partial<UniswapTokenOperation> = {}) {
    return await this.persist(transitionUniswapToken(op, "cleanup_required", { cleanupReason: reason, accumulatedNativeDebitWei: native,
      ...(usage === undefined ? {} : usagePatch(usage)), ...(preSignFailure === undefined ? {} : { preSignFailure }), ...unmarkedAttempt }, this.ports.now())); }
  private async retireExpiredPrepared(op: UniswapTokenOperation) {
    if (op.phase !== "prepared" || !expired(op, this.ports.now())) return op;
    if (op.approvalAttempt !== null || op.swapAttempt !== null || op.cleanupAttempt !== null ||
        op.usageReservationId !== null || op.usageState !== null || op.accumulatedNativeDebitWei !== "0")
      blocked("Expired prepared token operation has effects requiring review.", "uniswap_token_expired_prepared_unsafe");
    await this.assertNoEffect(op);
    if (await this.ports.currentAllowance(op) !== "0")
      blocked("Expired prepared token operation has a residual allowance.", "uniswap_token_expired_prepared_allowance");
    return await this.persist(transitionUniswapToken(op, "cleaned", { cleanupReason: "zero_allowance_no_effect",
      cleanupEvidence: cleanupEvidence("current_allowance", this.ports.now()) }, this.ports.now()));
  }
  private async syncUsage(op: UniswapTokenOperation) { if (op.usageReservationId === null) return op;
    if (op.phase === "cleaned" && op.cleanupEvidence?.kind === "expired_approval_no_swap") {
      const current = await this.ports.currentUsage(op);
      if (current.state === "reserved") {
        const released = await this.ports.followUsage(op, "failed_before_effect");
        return await this.persist(transitionUniswapToken(op, "cleaned", usagePatch(released), this.ports.now()));
      }
    }
    const usage = await this.ports.currentUsage(op);
    if (op.usageState !== usage.state || op.usageReservationId !== usage.reservationId)
      op = await this.persist(transitionUniswapToken(op, op.phase, usagePatch(usage), this.ports.now()));
    if (op.phase === "cleanup_required" && op.usageState === "failed_before_effect" && !effectHash(op)) { await this.assertNoEffect(op);
      return await this.persist(transitionUniswapToken(op, "cleaned", { cleanupReason: "zero_allowance_no_effect", accumulatedNativeDebitWei: "0",
        cleanupEvidence: op.cleanupEvidence ?? cleanupEvidence("legacy_usage_reconciliation", this.ports.now()) }, this.ports.now())); }
    return op; }
  private async assertNoEffect(op: UniswapTokenOperation) { if (effectHash(op)) blocked("A durable token effect forbids no-effect cleanup.", "uniswap_cleanup_effect_exists");
    for (const [kind, attempt] of [["approval", op.approvalAttempt], ["swap", op.swapAttempt], ["cleanup", op.cleanupAttempt]] as const)
      if (attempt !== null) {
        const effect = await this.ports.recoverSealed?.(op, kind, attempt.nonce) ?? null;
        if (effect !== null) blocked("A durable token effect forbids no-effect cleanup.", "uniswap_cleanup_effect_exists");
        blocked("A started token effect cannot prove no-effect cleanup.", "uniswap_token_public_effect_missing");
      } }
  private async feeQuote(op: UniswapTokenOperation) {
    if (this.ports.cleanupFeeQuote === undefined) blocked("A fresh fee quote is unavailable.", "uniswap_token_cleanup_fee_quote_unavailable");
    return await this.ports.cleanupFeeQuote(op);
  }
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
function expired(op: UniswapTokenOperation, now: Date) { return now.getTime() >= op.route.deadline * 1000; }
function usagePatch(value: TokenUsageBinding) { return { usageReservationId: value.reservationId, usageState: value.state }; }
function debit(op: UniswapTokenOperation, added: string) { const total = BigInt(op.accumulatedNativeDebitWei) + BigInt(added); if (total > BigInt(op.maximumNativeDebitWei)) blocked("Native debit exceeded the approved budget.", "uniswap_native_debit_exceeded"); return total.toString(); }
function effectHash(op: UniswapTokenOperation) { return [op.approvalAttempt, op.swapAttempt, op.cleanupAttempt].some((row) => row?.transactionHash !== null && row?.transactionHash !== undefined); }
function cleanupEvidence(source: "current_allowance" | "legacy_usage_reconciliation", now: Date) { return { schemaVersion: "apn.uniswap-token-cleanup-evidence.v1" as const,
  kind: "zero_allowance_no_effect" as const, source, observedAllowanceAtomic: "0" as const, observedAt: now.toISOString() }; }
function diagnostic(error: unknown, phase: UniswapTokenPhase): import("./token-operation.js").UniswapTokenFailureDiagnostic { const e = error instanceof ApnError ? error : null;
  return { code: sanitizeUniswapTokenFailureField("code", e?.code),
    reason: sanitizeUniswapTokenFailureField("reason", e?.details?.reason ?? e?.details?.transportReason),
    rpcMethod: sanitizeUniswapTokenFailureField("rpcMethod", e?.details?.rpcMethod),
    endpointRole: sanitizeUniswapTokenFailureField("endpointRole", e?.details?.endpointRole), phase }; }
/**
 * R4 exit 2 "never signed": the refusal came before signing, inside the account lock, and custody then showed no signed bytes
 * while it freed the nonce. The marker of that attempt is dropped so the zero-allowance cleanup can prove no effect; an attempt
 * custody may hold signed bytes for keeps its marker (its exit stays proof or the owner's abandon).
 */
function unmarked(kind: TokenEffectKind, unsigned: boolean): Partial<UniswapTokenOperation> { return unsigned ? { [`${kind}Attempt`]: null } : {}; }
/** The record for one consented cleanup re-quote; refused when the caps miss the quote or a cleanup marker holds the slot. */
export function requotedCleanup(op: UniswapTokenOperation, fees: TokenCleanupFees, quote: TokenFeeQuote, now: Date): UniswapTokenOperation {
  if (op.phase !== "cleanup_required" || op.cleanupAttempt !== null) blocked("A cleanup re-quote needs a free cleanup slot.", "uniswap_token_cleanup_requote_slot");
  const maxFee = BigInt(fees.maxFeePerGas), priority = BigInt(fees.maxPriorityFeePerGas), base = BigInt(quote.baseFeePerGasWei),
    market = BigInt(quote.priorityFeePerGasWei), minimum = base * 2n + market;
  // The signing guard's own rule: the priority cap covers the market tip and the max fee covers twice the base fee plus it.
  if (priority > maxFee || priority < market || maxFee < minimum) throw new ApnError("APN_OPERATION_BLOCKED", "The cleanup fee caps are below the fresh fee quote.",
    { reason: "uniswap_token_cleanup_fee_quote", blockNumber: quote.blockNumber, baseFeePerGasWei: quote.baseFeePerGasWei,
      priorityFeePerGasWei: quote.priorityFeePerGasWei, minimumMaxFeePerGasWei: minimum.toString() });
  const gas = { gasLimit: op.cleanupGas.gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  const cleanupMax = BigInt(gas.gasLimit) * maxFee, envelopeMax = (g: typeof gas) => BigInt(g.gasLimit) * BigInt(g.maxFeePerGas);
  const cap = [BigInt(op.maximumNativeDebitWei), BigInt(op.accumulatedNativeDebitWei) + cleanupMax, envelopeMax(op.approvalGas) + envelopeMax(op.swapGas) + cleanupMax]
    .reduce((a, b) => a > b ? a : b);
  return transitionUniswapToken(op, "cleanup_required", { cleanupGas: gas, maximumNativeDebitWei: cap.toString(), cleanupFeeQuote: {
    schemaVersion: "apn.uniswap-token-cleanup-fee-quote.v1", ...quote, previousCleanupGas: op.cleanupGas,
    previousMaximumNativeDebitWei: op.maximumNativeDebitWei, quotedAt: now.toISOString() } }, now);
}
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
