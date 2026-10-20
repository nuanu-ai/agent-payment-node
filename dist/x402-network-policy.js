import { ApnError } from "./errors.js";
import { assertX402PayeeAdmitted, effectiveX402Cap, requireProfilePolicy } from "./profile-policy.js";
import { assertLocalNetworkProfile, isBaseUsdc, x402AssetOf } from "./x402-network.js";
import { resolveX402Payer, x402PolicyBinding } from "./x402-payer.js";
/**
 * Before signing and before the first send on every network but Base USDC, the frozen payer and the owner's per-payment cap
 * are re-checked from local state. No RPC read is repeated: the token domain, balance and unattended-balance cap were
 * proven at prepare, the signature binds the frozen domain, and an unfunded authorization simply never settles and
 * expires by its own validBefore. Base USDC keeps its single prepare-time admission.
 */
export async function assertCurrentNetworkPolicy(context, operation) {
    const selected = x402AssetOf(operation);
    if (isBaseUsdc(selected))
        return;
    await assertLocalNetworkProfile(context, operation.profile, selected);
    const payer = await resolveX402Payer(context, operation.profileHash, selected);
    if (payer.wallet !== operation.wallet || payer.transferMethod !== "eip3009")
        throw new ApnError("APN_WALLET_MISMATCH", "Current local payer differs from the frozen x402 wallet.");
    effectiveX402Cap(requireProfilePolicy(await context.requirePolicy().load(payer.policy)), operation.capAtomic);
}
/**
 * The owner's optional x402 payee pin (profile policy; absent = not restricted), re-read from local state before signing
 * and before the first paid request on every network, so a pin added after prepare stops an unsent payment.
 */
export async function assertCurrentX402Payee(context, operation) {
    const binding = await x402PolicyBinding(context, operation.profileHash, x402AssetOf(operation));
    assertX402PayeeAdmitted(requireProfilePolicy(await context.requirePolicy().load(binding)), operation.authorization.to);
}
//# sourceMappingURL=x402-network-policy.js.map