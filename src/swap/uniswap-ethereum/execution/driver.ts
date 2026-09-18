import type { Hex } from "viem";
import { canonicalJson, domainHash } from "../../../canonical.js";
import { ApnError } from "../../../errors.js";
import type { ClockPort } from "../../../ports.js";
import { validateSwapOperation, type SwapOperationRecord } from "../../model.js";
import type { SwapProtocolRegistry } from "../../protocol-registry.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../../runtime.js";
import type { GuardedSwapService } from "../../service.js";
import { validateUniswapKeylessMaterial } from "../../uniswap-v3/material.js";
import { assertInjectedProtocol, createUniswapApprovalRequest, createUniswapExecutionBinding, validateFreshness } from "./binding.js";
import type { UniswapExecutionBindingStore } from "./binding-store.js";
import type { UniswapObservedOutcome } from "./observer.js";
import type { UniswapEffectStorePort, UniswapExecutionBinding, UniswapExecutionGuardPort, UniswapExecutionSignerPort,
  UniswapOwnerAdmissionPort, UniswapSingleSendPort } from "./types.js";

export interface UniswapOutcomeObserverPort {
  observeOutcome(operation: SwapOperationRecord, binding: UniswapExecutionBinding, transactionHash: Hex): Promise<UniswapObservedOutcome | null>;
}
export interface UniswapExecutionDriverDependencies {
  readonly core: GuardedSwapService;
  readonly protocolRegistry: SwapProtocolRegistry;
  readonly admission: UniswapOwnerAdmissionPort;
  readonly guard: UniswapExecutionGuardPort;
  readonly bindings: Pick<UniswapExecutionBindingStore, "save" | "load">;
  readonly signer: UniswapExecutionSignerPort;
  readonly sender: UniswapSingleSendPort;
  readonly observer: UniswapOutcomeObserverPort;
  readonly effects: UniswapEffectStorePort;
  readonly clock: ClockPort;
}

/**
 * GuardedSwapExecutionDriver for the approved Uniswap reservation. Before the marker every refusal releases the
 * reservation with a bound proof. The marker, then the execution binding, are durable before signing; the sender
 * attempts once; every later outcome, and every status call, only observes the exact signed transaction.
 */
export class UniswapEthereumExecutionDriver implements GuardedSwapExecutionDriver {
  constructor(private readonly d: UniswapExecutionDriverDependencies) {}

  async execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord> {
    let operation = validateSwapOperation(input.operation);
    if (operation.state !== "reserved" || operation.submissionMarker !== null) blocked("Uniswap execution requires the exact approved reservation.", "uniswap_execution_state");
    const envelope = validateUniswapKeylessMaterial(input.material).execution.envelope;
    let admission, freshness, approvalHash: string;
    try {
      assertInjectedProtocol(operation, this.d.protocolRegistry);
      admission = await this.d.admission.assert(operation);
      freshness = await this.d.guard.inspect(operation, envelope);
      const checked = this.d.clock.now();
      validateFreshness(operation, envelope, freshness, checked);
      approvalHash = createUniswapApprovalRequest(operation, envelope, freshness, checked).approvalHash;
      // The marker instant is the freshness instant, so the binding proves its freshness was taken at the boundary.
      operation = await this.d.core.markSubmitting(operation, new Date(freshness.checkedAt));
    } catch (error) {
      await this.releaseUnsent(operation, error);
      throw error;
    }
    const binding = createUniswapExecutionBinding({ operation, envelope, freshness, admission, approvalHash });
    try { await this.d.bindings.save(operation, binding); }
    catch { return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now()); }
    let transactionHash: Hex;
    try { transactionHash = (await this.d.signer.sign(operation, binding, admission, this.d.clock.now())).transactionHash; }
    catch { return await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now()); }
    let sent: Awaited<ReturnType<UniswapSingleSendPort["sendOnce"]>> | null = null;
    try { sent = await this.d.sender.sendOnce(operation, binding, this.d.clock.now()); } catch { sent = null; }
    const accepted = sent !== null && sent.kind === "submitted" && sent.transactionHash === transactionHash;
    operation = await this.d.core.recordPossibleSend(operation, accepted ? "submitted" : "unknown_finality", this.d.clock.now());
    return await this.observeExact(operation, binding, transactionHash, false);
  }

  async observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord> {
    let operation = validateSwapOperation(input.operation);
    if (operation.submissionMarker === null) blocked("Uniswap observation is available only after the submission marker.", "uniswap_resume_before_marker");
    validateUniswapKeylessMaterial(input.material);
    if (["finalized", "failed_confirmed_revert"].includes(operation.state)) return operation;
    const binding = await this.d.bindings.load(operation);
    const effect = binding === null ? null : await this.d.effects.load(operation, binding);
    if (binding === null || effect === null) {
      if (operation.state === "submitting") operation = await this.d.core.recordPossibleSend(operation, "unknown_finality", this.d.clock.now());
      return operation;
    }
    if (operation.state === "submitting") operation = await this.d.core.recordPossibleSend(operation,
      effect.phase === "send_accepted" ? "submitted" : "unknown_finality", this.d.clock.now());
    return await this.observeExact(operation, binding, effect.transactionHash, true);
  }

  /**
   * Right after the single send an observation failure must not hide the recorded send, so it returns the operation. A status
   * or resume call surfaces the failure instead: the state stays durable and the caller sees why it did not advance.
   */
  private async observeExact(operation: SwapOperationRecord, binding: UniswapExecutionBinding, transactionHash: Hex,
    surfaceFailure: boolean): Promise<SwapOperationRecord> {
    let outcome: UniswapObservedOutcome | null;
    try { outcome = await this.d.observer.observeOutcome(operation, binding, transactionHash); }
    catch (error) { if (surfaceFailure) throw error; return operation; }
    if (outcome === null || (operation.state !== "submitted" && operation.state !== "unknown_finality")) return operation;
    return outcome.outcome === "succeeded" ? await this.d.core.finalize(operation, this.d.clock.now(), outcome.proof)
      : await this.d.core.failConfirmedRevert(operation, this.d.clock.now(), outcome.proof);
  }

  private async releaseUnsent(operation: SwapOperationRecord, error: unknown): Promise<void> {
    const reason = error instanceof ApnError ? `${error.code}:${String(error.details?.reason ?? "")}` : "guard_unavailable";
    const proof = domainHash("apn.uniswap-unsent-refusal.v1", canonicalJson({ operationId: operation.operationId,
      integrityHash: operation.integrityHash, reason }));
    try { await this.d.core.failBeforeEffect(operation, this.d.clock.now(), proof); }
    catch { /* A persisted marker or concurrent change keeps the reservation; resume only observes. */ }
  }
}

function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
