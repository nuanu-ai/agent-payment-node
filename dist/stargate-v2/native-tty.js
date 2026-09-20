import { approvalCode } from "../approval-code.js";
import { exactChainConsent } from "../tty-approval.js";
/** Exact foreground screen for the first admitted native lane. */
export class TtyStargateNativeApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async approve(operation) {
        const code = approvalCode("bridge", operation.integrityHash);
        await exactChainConsent([
            "Agent Payment Node Stargate V2 native bridge approval",
            `Profile: ${operation.profile}`,
            `Operation: ${operation.operationId}`,
            "Route: Ethereum mainnet native ETH -> Unichain mainnet native ETH",
            `Sender and recipient: ${operation.owner} (self only)`,
            `Principal: ${operation.amountAtomic} wei`,
            `Quoted LayerZero native fee: ${operation.quote.quote.nativeMessageFeeAtomic} wei`,
            `Transaction value: ${operation.totalValueAtomic} wei (principal + quoted native fee)`,
            `Maximum native debit: ${operation.maximumDebitAtomic} wei (value + EIP-1559 gas envelope)`,
            `Source Stargate contract: ${operation.sourcePool}; EID ${operation.sourceEid}`,
            `Destination Stargate contract: ${operation.destinationPool}; EID ${operation.destinationEid}`,
            `Minimum destination amount: ${operation.quote.quote.minimumOutputAtomic} wei`,
            `Nonce: ${operation.envelope.nonceAtomic}; gas limit: ${operation.envelope.gasLimitAtomic}`,
            `Max fee per gas: ${operation.envelope.maxFeePerGasAtomic}; priority fee: ${operation.envelope.maxPriorityFeePerGasAtomic}`,
            `Quote: ${operation.quote.quoteHash}; source code: ${operation.sourceCodeHash}`,
            `Expires: ${operation.expiresAt}`,
            "APN records submission_started before one broadcast. An ambiguous result is observed and never resent.",
            "Source confirmation does not prove Unichain delivery; completion requires safe destination evidence.",
        ], code, operation.expiresAt, this.options);
    }
}
//# sourceMappingURL=native-tty.js.map