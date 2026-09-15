import { formatUnits } from "viem";
import { ApnError } from "../errors.js";
import { exactChainConsent } from "../tty-approval.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
export class TtyFacilitatorApproval {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async confirm(input) {
        const s = input.summary, t = s.transfer;
        const usdc = (atomic) => `${formatUnits(BigInt(atomic), R.decimals)} USDC`;
        const lines = ["Agent Payment Node — Avalanche USDC transfer relayed by a public x402 facilitator",
            `Profile: ${s.profile}; local software custody`, `Chain: ${t.network} (Avalanche C-Chain)`, `USDC contract: ${t.token}`,
            `Sender: ${t.sender}`, `Recipient: ${t.recipient}`, `Recipient receives: ${usdc(t.gross_atomic)}`,
            "USDC fee: 0. The sender pays no native gas; the facilitator pays it.",
            `You sign one EIP-3009 authorization for exactly this recipient and amount. It expires on-chain ${R.validitySeconds} seconds after approval.`,
            `Facilitator: ${s.facilitator.origin}; relayer: ${s.facilitator.approved_signers.join(", ")}`,
            "APN sends it for one verification and one settlement and never repeats either.",
            "If it is not settled it expires unused. APN proves either outcome from finalized Avalanche blocks.",
            `RPC: ${s.rpc_origin}`, `Operation: ${s.operation_id}`, `Fingerprint: ${input.fingerprint}`, `Approve before: ${s.expires_at}`];
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