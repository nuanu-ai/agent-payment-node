import { approvalCode } from "../approval-code.js";
import { exactChainConsent } from "../tty-approval.js";
export class TtyStargateTokenApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async approve(op) {
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
            `Policy digest/revision: ${op.policy.policyDigest} / ${op.policy.policyRevision}`,
            `Quote: ${op.quote.quoteHash}; options: ${op.options}`,
            `Expires: ${op.expiresAt}`,
            "Every approval or bridge broadcast is durably marked first. Ambiguous results are observed and never resent.",
            "Completion requires exact safe source/destination events, USDC delivery, POL balance delta, and zero residual allowance.",
        ], code, op.expiresAt, this.options);
    }
}
//# sourceMappingURL=token-tty.js.map