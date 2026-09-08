import { ApnError } from "../errors.js";
import { exactChainConsent } from "../tty-approval.js";
export class TtyBridgeApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async confirm(input) {
        const s = input.summary;
        const lines = ["Agent Payment Node cross-chain bridge approval", `Profile: ${s.profile}`, `Provider: ${s.provider}`,
            `Custody: ${s.custody}`, `Execution owner: ${s.execution_owner}`, `Operation: ${input.operationId}`,
            `LI.FI route: ${s.route.route_id}; tool: ${s.route.tool}`, `Source chain: eip155:${s.transfer.fromChainId}`,
            `Destination chain: eip155:${s.transfer.toChainId}`, `Source USDC: ${s.transfer.fromToken}`, `Destination USDC: ${s.transfer.toToken}`,
            `Sender: ${s.transfer.sender}`, `Recipient: ${s.transfer.recipient}`, `Source principal: ${s.transfer.amountAtomic} USDC atomic (6 decimals)`,
            `Quoted destination output: ${s.transfer.quoted_output_atomic} USDC atomic`, `Maximum slippage: ${s.transfer.slippageBps} basis points`,
            `Minimum destination output: ${s.transfer.minimum_output_atomic} USDC atomic`, `Maximum USDC loss including fees/slippage: ${s.transfer.maxRouteFeeAtomic} atomic`,
            `Unitemized protocol token fee: ${s.fees.implicit_protocol_token_fee_atomic} USDC atomic`,
            `Aggregate source native debit cap: ${s.transfer.maxNativeDebitWei} wei`, `Allowance at prepare: ${s.transfer.allowance_atomic_at_prepare} atomic`,
            `Spender: ${s.transfer.spender}`, "A separate included approval costs gas even if the bridge cannot proceed.",
            "Base total native fee is checked before sending; L1/operator fees have no transaction-level on-chain cap.",
            ...s.effects.flatMap((e) => [`${e.role}: target ${e.to}; native value ${e.value_atomic} wei; nonce ${e.economics.nonceAtomic}`,
                `${e.role}: gas ceiling ${e.economics.gasLimitAtomic}; maxFeePerGas ${e.economics.maxFeePerGasAtomic}; maxPriorityFeePerGas ${e.economics.maxPriorityFeePerGasAtomic}`,
                `${e.role}: total gas quote ${e.fee_quote.totalQuoteWei} wei; provisional bridge ceiling ${e.gas_ceiling_provisional_at_consent}`]),
            ...s.fees.declared.map((fee) => `Declared fee: ${fee.name}; chain ${fee.chainId}; asset ${fee.asset}; ${fee.amountAtomic} atomic; included ${fee.included}`),
            `Source RPC: ${s.rpc_origins.source}`, `Destination RPC: ${s.rpc_origins.destination}`,
            "After the first send attempt, recovery only observes that exact transaction and never resends it.",
            `Policy: ${s.policy.policy_hash}`, `Fingerprint: ${input.fingerprint}`, `Expires: ${s.expires_at}`];
        try {
            await exactChainConsent(lines, input.exactPhrase, s.expires_at, this.options);
            return true;
        }
        catch (error) {
            if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode !== "APN_TTY_UNAVAILABLE")
                return false;
            throw error;
        }
    }
}
//# sourceMappingURL=tty.js.map