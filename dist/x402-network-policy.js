import { ApnError } from "./errors.js";
import { effectiveX402Cap, requireProfilePolicy } from "./profile-policy.js";
import { assertLocalNetworkProfile, x402Network } from "./x402-network.js";
import { resolveX402Payer } from "./x402-payer.js";
/**
 * Before signing and before the first send on Ethereum or Arbitrum, the frozen payer and the owner's per-payment cap
 * are re-checked from local state. No RPC read is repeated: the token domain, balance and unattended-balance cap were
 * proven at prepare, the signature binds the frozen domain, and an unfunded authorization simply never settles and
 * expires by its own validBefore. Base keeps its single prepare-time admission.
 */
export async function assertCurrentNetworkPolicy(context, operation) {
    if (operation.chainId === "8453")
        return;
    const selected = x402Network(operation.network);
    await assertLocalNetworkProfile(context, operation.profile, selected.chainId);
    const payer = await resolveX402Payer(context, operation.profileHash, selected.chainId);
    if (payer.wallet !== operation.wallet || payer.transferMethod !== "eip3009")
        throw new ApnError("APN_WALLET_MISMATCH", "Current local payer differs from the frozen x402 wallet.");
    effectiveX402Cap(requireProfilePolicy(await context.requirePolicy().load(payer.policy)), operation.capAtomic);
}
//# sourceMappingURL=x402-network-policy.js.map