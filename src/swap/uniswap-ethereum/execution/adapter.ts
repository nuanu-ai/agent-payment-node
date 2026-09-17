import type { AssetPolicyRegistry } from "../../../asset-policy-registry.js";
import { ApnError } from "../../../errors.js";
import { GuardedSwapService } from "../../service.js";
import { validateSwapOperation, type SwapOperationRecord } from "../../model.js";
import type { SwapProtocolRegistry } from "../../protocol-registry.js";
import type { UniswapTransactionEnvelope } from "../../uniswap-codec.js";
import { assertInjectedProtocol, createUniswapApprovalRequest, createUniswapExecutionBinding,
  validateFreshness, validateUniswapExecutionBinding } from "./binding.js";
import type { UniswapEffectStorePort, UniswapExecutionBinding, UniswapExecutionGuardPort,
  UniswapExecutionSignerPort, UniswapForegroundApprovalPort, UniswapOwnerAdmissionPort,
  UniswapReceiptObserverPort, UniswapSingleSendPort } from "./types.js";

export interface UniswapExecutionResult {
  readonly operation: SwapOperationRecord;
  readonly binding: UniswapExecutionBinding | null;
  readonly transactionHash: `0x${string}` | null;
}

/** Dormant unless every owner, registry, guard, approval, custody, send, and observer dependency is explicitly injected. */
export class UniswapEthereumExecutionAdapter {
  constructor(private readonly core: GuardedSwapService, private readonly protocolRegistry: SwapProtocolRegistry,
    private readonly admission: UniswapOwnerAdmissionPort, private readonly guard: UniswapExecutionGuardPort,
    private readonly approval: UniswapForegroundApprovalPort, private readonly signer: UniswapExecutionSignerPort,
    private readonly sender: UniswapSingleSendPort, private readonly observer: UniswapReceiptObserverPort,
    private readonly effects: UniswapEffectStorePort) {}

  async approveAndExecute(input: { readonly operation: SwapOperationRecord; readonly envelope: UniswapTransactionEnvelope;
    readonly assetPolicy: AssetPolicyRegistry; readonly now: Date }): Promise<UniswapExecutionResult> {
    let operation = validateSwapOperation(input.operation);
    if (operation.submissionMarker !== null) return await this.resume({ operation, binding: null, now: input.now });
    if (operation.state !== "awaiting_approval") blocked("Uniswap operation is not awaiting foreground approval.", "uniswap_approval_state");
    assertInjectedProtocol(operation, this.protocolRegistry);
    const admission = await this.admission.assert(operation);
    const approvalRequest = createUniswapApprovalRequest(operation, input.envelope);
    const answer = await this.approval.confirm(approvalRequest);
    if (!answer.approved) return { operation: await this.core.failBeforeEffect(operation, input.now, approvalRequest.approvalHash), binding: null, transactionHash: null };
    if (answer.approvalHash !== approvalRequest.approvalHash) blocked("Foreground approval does not bind the displayed Uniswap intent.", "uniswap_approval_tamper");
    const freshness = await this.guard.inspect(operation, input.envelope); validateFreshness(operation, input.envelope, freshness);
    operation = await this.core.reserve(operation, input.assetPolicy, input.now);
    operation = await this.core.markSubmitting(operation, input.now);
    const binding = createUniswapExecutionBinding({ operation, envelope: input.envelope, freshness, admission, approvalHash: answer.approvalHash });
    let transactionHash: `0x${string}` | null = null;
    try { transactionHash = (await this.signer.sign(operation, binding, admission, input.now)).transactionHash; }
    catch { operation = await this.core.recordPossibleSend(operation, "unknown_finality", input.now); return { operation, binding, transactionHash }; }
    const sent = await this.sender.sendOnce(operation, binding, input.now); transactionHash = sent.transactionHash;
    operation = await this.core.recordPossibleSend(operation, sent.kind === "submitted" ? "submitted" : "unknown_finality", input.now);
    return await this.observeOnly(operation, binding, transactionHash, input.now);
  }

  async resume(input: { readonly operation: SwapOperationRecord; readonly binding: UniswapExecutionBinding | null;
    readonly now: Date }): Promise<UniswapExecutionResult> {
    let operation = validateSwapOperation(input.operation);
    if (operation.submissionMarker === null) blocked("Uniswap resume is available only after the submission marker.", "uniswap_resume_before_marker");
    if (operation.state === "finalized" || operation.state === "failed_before_effect") return { operation, binding: input.binding, transactionHash: operation.receiptProof?.transactionHash as `0x${string}` | null };
    if (input.binding === null) {
      if (operation.state === "submitting") operation = await this.core.recordPossibleSend(operation, "unknown_finality", input.now);
      return { operation, binding: null, transactionHash: null };
    }
    const binding = validateUniswapExecutionBinding(input.binding, operation), effect = await this.effects.load(operation, binding);
    if (effect === null) {
      if (operation.state === "submitting") operation = await this.core.recordPossibleSend(operation, "unknown_finality", input.now);
      return { operation, binding, transactionHash: null };
    }
    if (operation.state === "submitting") operation = await this.core.recordPossibleSend(operation,
      effect.phase === "send_accepted" ? "submitted" : "unknown_finality", input.now);
    return await this.observeOnly(operation, binding, effect.transactionHash, input.now);
  }

  async status(input: { readonly operation: SwapOperationRecord; readonly binding: UniswapExecutionBinding | null;
    readonly now: Date }): Promise<UniswapExecutionResult> { return await this.resume(input); }

  private async observeOnly(operation: SwapOperationRecord, binding: UniswapExecutionBinding,
    transactionHash: `0x${string}`, now: Date): Promise<UniswapExecutionResult> {
    if (operation.submissionMarker === null) blocked("Uniswap observation cannot precede its marker.", "uniswap_observation_before_marker");
    let proof;
    try { proof = await this.observer.observe(operation, binding, transactionHash); }
    catch { return { operation, binding, transactionHash }; }
    if (proof !== null && proof.finalized && (operation.state === "submitted" || operation.state === "unknown_finality")) {
      operation = await this.core.finalize(operation, now, proof);
    }
    return { operation, binding, transactionHash };
  }
}

function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
