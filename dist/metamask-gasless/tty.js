import { ApnError } from "../errors.js";
import { exactChainConsent } from "../tty-approval.js";
import { mmError } from "./reasons.js";
import { mmFormat } from "./validation.js";
export class TtyMetaMaskGaslessApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async confirm(input) {
        const s = input.summary, t = s.transfer;
        const usdc = (amount) => `${mmFormat(amount)} USDC (${amount} atomic)`;
        const lines = ["Agent Payment Node — MetaMask gasless USDC approval",
            `Profile: ${s.profile}; provider: metamask-agent-wallet; custody: provider-managed server wallet`,
            `Chain: eip155:${t.chain_id}; network: ${String(input.summary.network)}`,
            `USDC contract: ${t.token}; decimals: 6`, `Sender: ${t.sender}`, `Recipient: ${t.recipient}`,
            `Fee recipient: ${t.fee_recipient}`, `Total sender debit: ${usdc(t.gross_atomic)}`,
            `Recipient receives: ${usdc(t.frozen_net_atomic)}`, `Exact fee: ${usdc(t.frozen_fee_atomic)}`,
            `Your fee ceiling: ${usdc(t.user_max_fee_atomic)}`, `Your minimum receipt: ${usdc(t.minimum_received_atomic)}`,
            String(input.summary.authorization), String(input.summary.outer_gas_payer),
            String(input.summary.persistent_effects), String(input.summary.permission_warning),
            `Current designation: ${s.permission.initial_designation}`, `Delegation hash: ${s.permission.delegation_hash}`,
            `Signing digest: ${s.permission.signing_digest}`, `Provider request identity hash: ${s.provider_request_id_hash}`,
            `RPC: ${s.endpoint_origin}`, `Operation: ${s.operation_id}`, `Fingerprint: ${s.fingerprint}`,
            `Approve before: ${s.expires_at}; remaining milliseconds: ${String(input.summary.remaining_ms)}`];
        try {
            await exactChainConsent(lines, input.exactPhrase, s.expires_at, this.options, 256);
            return true;
        }
        catch (error) {
            if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED") {
                if (error.details?.nativeCode === "APN_APPROVAL_REFUSED")
                    return false;
                if (error.details?.nativeCode === "APN_APPROVAL_EXPIRED")
                    throw mmError("mm_gasless_expired");
            }
            throw mmError("mm_gasless_approval");
        }
    }
}
//# sourceMappingURL=tty.js.map