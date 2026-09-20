import { approvalCode } from "../approval-code.js";
import { exactChainConsent, type TtyTransferApprovalOptions } from "../tty-approval.js";
import type { StargateTokenExecutionPorts, StargateTokenOperation } from "./token-execution.js";

export class TtyStargateTokenApproval implements Pick<StargateTokenExecutionPorts, "approve" | "approveCleanup"> {
  constructor(private readonly options: TtyTransferApprovalOptions = {}) {}
  async approve(op: StargateTokenOperation): Promise<void> {
    const code = approvalCode("bridge", op.integrityHash);
    await exactChainConsent([
      "Agent Payment Node Stargate V2 USDC bridge approval",
      `Profile: ${op.profile}`,
      `Operation: ${op.operationId}`,
      "Route: Optimism USDC -> Polygon USDC with LayerZero native POL drop",
      `Sender and recipient: ${op.owner} (self only)`,
      `Principal: ${op.amountAtomic} atomic USDC; minimum Polygon USDC: ${op.quote.quote.minimumOutputAtomic}`,
      `Native drop: ${op.nativeDropAtomic} wei POL; onchain Executor cap: ${op.executorNativeCapAtomic}`,
      `Quoted LayerZero fee: ${op.quote.quote.nativeMessageFeeAtomic} wei ETH; maximum source native debit: ${op.maximumDebitAtomic} wei ETH`,
      `Source token/pool: ${op.sourceToken} / ${op.sourcePool}; destination token/pool: ${op.destinationToken} / ${op.destinationPool}`,
      `Allowance: ${op.allowanceRequired ? `separate exact approval for ${op.amountAtomic}` : "already exactly equal to principal"}`,
      `EIP-1559 fee approval: ${op.feeApproval?.provenance ?? "legacy_exact_snapshot"}; quoted max/priority: ${op.feeApproval?.quotedMaxFeePerGasWei ?? op.sendEnvelope.maxFeePerGasAtomic} / ${op.feeApproval?.quotedMaxPriorityFeePerGasWei ?? op.sendEnvelope.maxPriorityFeePerGasAtomic} wei per gas; approved max/priority: ${op.feeApproval?.approvedMaxFeePerGasWei ?? op.sendEnvelope.maxFeePerGasAtomic} / ${op.feeApproval?.approvedMaxPriorityFeePerGasWei ?? op.sendEnvelope.maxPriorityFeePerGasAtomic} wei per gas`,
      `Bridge simulation: ${op.bridgeSimulation?.mode ?? "legacy_exact_at_prepare"}; prepare status: ${op.bridgeSimulation?.prepareStatus ?? "legacy_succeeded"}; frozen gas ceiling: ${op.bridgeSimulation?.gasCeilingAtomic ?? op.sendEnvelope.gasLimitAtomic}`,
      ...(op.bridgeSimulation?.mode === "pending_post_approval" ? ["The bridge has not simulated successfully yet. After the approval is safe, APN must revalidate and exactly simulate it within this ceiling before signing."] : []),
      `Policy digest/revision: ${op.policy.policyDigest} / ${op.policy.policyRevision}`,
      `Quote: ${op.quote.quoteHash}; options: ${op.options}`,
      `Expires: ${op.expiresAt}`,
      "Every approval or bridge broadcast is durably marked first. Ambiguous results are observed and never resent.",
      "Completion requires exact safe source/destination events, USDC delivery, POL balance delta, and zero residual allowance.",
    ], code, op.expiresAt, this.options);
  }
  async approveCleanup(op: StargateTokenOperation): Promise<void> {
    const code = approvalCode("bridge", op.integrityHash);
    await exactChainConsent([
      "Agent Payment Node Stargate V2 residual allowance cleanup",
      `Profile: ${op.profile}`,
      `Operation: ${op.operationId}`,
      `Owner: ${op.owner}`,
      `Token/spender: ${op.sourceToken} / ${op.sourcePool}`,
      `Current expected allowance: ${op.residualAllowanceAtomic ?? op.amountAtomic}; replacement allowance: 0`,
      `Cleanup reason: ${op.cleanupReason ?? "residual_allowance"}`,
      "The revoke transaction is durably marked before broadcast. An ambiguous result is observed and never resent.",
    ], code, new Date(Date.now() + 300_000).toISOString(), this.options);
  }
}
