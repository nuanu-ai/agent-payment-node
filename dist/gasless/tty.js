import { formatUnits } from "viem";
import { ApnError } from "../errors.js";
import { exactChainConsent } from "../tty-approval.js";
export class TtyGaslessApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async confirm(input) {
        const s = input.summary, t = s.transfer;
        const usdc = (atomic) => `${formatUnits(BigInt(atomic), 6)} USDC`;
        const lines = ["Agent Payment Node — transfer with gas paid in USDC", `Profile: ${s.profile}; local software custody`,
            `Chain: eip155:${t.chain_id}`, `USDC contract: ${t.token}`, `Sender: ${t.sender}`, `Recipient: ${t.recipient}`,
            `Total budget: ${usdc(t.gross_atomic)}`, `Recipient receives: ${usdc(t.recipient_atomic)}`,
            `Frozen maximum fee: ${usdc(t.quoted_fee_budget_atomic)}`, `Your fee limit: ${usdc(t.user_max_fee_atomic)}`,
            `Your minimum receipt: ${usdc(t.minimum_received_atomic)}`,
            "Unused fee budget remains in your wallet. The sender pays no native gas.",
            "A reverted transfer can still charge the displayed USDC fee budget.",
            `Persistent account delegation: ${s.permission.delegate}; current state: ${s.permission.initial_designation}`,
            `Paymaster permission: ${s.permission.paymaster}, up to ${usdc(s.permission.permit_amount_atomic)}`,
            `Current paymaster allowance: ${usdc(s.permission.initial_allowance_atomic)}`,
            "The signed permit and operation have no on-chain expiry. Delegation persists after this payment.",
            "Success clears the paymaster allowance. An unresolved failure keeps the APN profile locked for reconciliation.",
            `RPC: ${s.rpc_origin}`, `Bundler: ${s.bundler_origin}`, `Operation: ${s.operation_id}`,
            `Fingerprint: ${input.fingerprint}`, `Approve before: ${s.expires_at}`];
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