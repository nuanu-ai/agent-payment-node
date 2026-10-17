import { approvalCode } from "../approval-code.js";
import { exactChainConsent } from "../tty-approval.js";
export class TtyStargateTokenApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async approve(op) {
        const code = approvalCode("bridge", op.integrityHash), fees = op.feeApproval, simulation = op.bridgeSimulation;
        await exactChainConsent([
            "Agent Payment Node Stargate V2 USDC bridge approval",
            `Profile: ${op.profile}`,
            `Operation: ${op.operationId}`,
            `Route: Optimism USDC -> Polygon USDC${BigInt(op.nativeDropAtomic) > 0n ? " with LayerZero native POL drop" : ""}`,
            `Sender and recipient: ${op.owner} (self only)`,
            `Principal: ${op.amountAtomic} atomic USDC`,
            `Initial quoted Polygon USDC output: ${op.quote.quote.minimumOutputAtomic}`,
            `Owner-approved minimum Polygon USDC output: ${op.minOutputAtomic}; maximum quote loss: ${BigInt(op.amountAtomic) - BigInt(op.minOutputAtomic)} atomic USDC`,
            `Native drop: ${op.nativeDropAtomic} wei POL; onchain Executor cap: ${op.executorNativeCapAtomic}`,
            `Initial quoted LayerZero fee: ${op.quote.quote.nativeMessageFeeAtomic} wei ETH; initial prepared maximum source native debit: ${op.maximumDebitAtomic} wei ETH`,
            `Owner-approved source native debit cap: ${op.maxNativeDebitAtomic} wei ETH`,
            `Source token/pool: ${op.sourceToken} / ${op.sourcePool}; destination token/pool: ${op.destinationToken} / ${op.destinationPool}`,
            `Allowance: ${op.allowanceRequired ? `separate exact approval for ${op.amountAtomic}` : "already exactly equal to principal"}`,
            `EIP-1559 fee approval: ${fees.provenance}; quoted max/priority: ${fees.quotedMaxFeePerGasWei} / ${fees.quotedMaxPriorityFeePerGasWei} wei per gas; approved max/priority: ${fees.approvedMaxFeePerGasWei} / ${fees.approvedMaxPriorityFeePerGasWei} wei per gas`,
            "Network fee cap: every transaction is signed with the approved max fee per gas and is sent only while the current base fee plus its priority fee fits under it; a rise within that cap is accepted.",
            `Bridge simulation: ${simulation.mode}; prepare status: ${simulation.prepareStatus}; frozen gas ceiling: ${simulation.gasCeilingAtomic}`,
            ...(simulation.mode === "pending_post_approval" ? ["The bridge has not simulated successfully yet. After the approval is safe, APN must revalidate and exactly simulate it within this ceiling before signing."] : []),
            `Policy digest/revision: ${op.policy.policyDigest} / ${op.policy.policyRevision}`,
            `Quote: ${op.quote.quoteHash}; options: ${op.options}`,
            `Approval must be signed and submitted before preparation expiry: ${op.expiresAt}`,
            ...(op.approvalFinalityWindowMs === undefined ? [] : [
                `Approval safe-finality window after the durable submission marker: ${Math.floor(op.approvalFinalityWindowMs / 60_000)} minutes`,
                "After exact approval reaches safe finality, APN obtains and persists a new short-lived quote. Its output and LayerZero fee may change.",
                "APN accepts that fresh quote only when output remains at or above the owner-approved minimum and the maximum quote loss, native drop and Executor cap, EIP-1559 fee ceilings, total native debit cap, policy, and mechanism remain within these approved bounds.",
                "The preparation quote is never used to sign the post-approval bridge.",
            ]),
            "Every approval or bridge broadcast is durably marked first. Ambiguous results are observed and never resent.",
            `Completion requires the exact safe source OFTSent and the GUID-bound destination OFTReceived for the USDC delivery${BigInt(op.nativeDropAtomic) > 0n ? ", the Executor's successful NativeDropApplied for the POL drop" : ""}, and zero residual allowance.`,
        ], code, op.expiresAt, this.options);
    }
    async approveCleanup(op) {
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
//# sourceMappingURL=token-tty.js.map