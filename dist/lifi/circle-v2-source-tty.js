import { approvalCode } from "../approval-code.js";
import { exactChainConsent } from "../tty-approval.js";
export class TtyCircleV2SourceApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async approve(p) {
        const code = approvalCode("bridge", p.preparationDigest);
        await exactChainConsent([
            "Agent Payment Node Circle V2 Base USDC burn",
            `Base payer: ${p.transaction.from}`,
            `Solana wallet owner: ${p.recipient.wallet}`,
            `Solana USDC ATA: ${p.recipient.ata}`,
            `ATA setup: ${p.recipient.setup}`,
            `Principal: ${p.principalAtomic} USDC atomic (6 decimals)`,
            `Quoted fee: ${p.quote.feeTotalAtomic} USDC atomic`,
            `Maximum source USDC debit: ${p.requiredUsdcDebitAtomic} atomic`,
            `Approved allowance cap: ${p.maxAllowanceAtomic} atomic`,
            `Base wrapper: ${p.transaction.to}`,
            `Nonce: ${p.transaction.nonceAtomic}`,
            `Gas limit: ${p.transaction.gasLimitAtomic}`,
            `Maximum fee per gas: ${p.transaction.maxFeePerGasWei} wei`,
            `Maximum native debit: ${p.maximumNativeDebitWei} wei`,
            `Base L1 data fee upper bound: ${p.l1DataFeeUpperWei} wei`,
            `Base operator fee upper bound: ${p.operatorFeeUpperWei} wei`,
            "The Base fee quote is a pre-submission upper estimate; L1/operator fees are not enforced by the transaction envelope.",
            `Quote hash: ${p.quoteHash}`,
            `Source block: ${p.sourceBlock.number} ${p.sourceBlock.hash}`,
            `Preparation digest: ${p.preparationDigest}`,
            `Expires: ${p.expiresAt}`,
            "One source transaction may be sent. Ambiguous submission will not be retried.",
            "Base source success does not prove Circle attestation or Solana mint.",
        ], code, p.expiresAt, this.options);
    }
}
//# sourceMappingURL=circle-v2-source-tty.js.map