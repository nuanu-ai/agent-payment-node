import { ApnError } from "./errors.js";
import { assertX402PayeeAdmitted, requireProfilePolicy } from "./profile-policy.js";
import type { RuntimeContext } from "./runtime.js";
import { assertLocalNetworkProfile, isBaseUsdc, releasedX402Pair, x402AssetOf } from "./x402-network.js";
import { resolveX402Payer, x402PolicyBinding } from "./x402-payer.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";

/**
 * Before signing and before the first send on every network but Base USDC, the frozen payer and the owner's per-payment cap
 * are re-checked from local state. No RPC read is repeated: the token domain, balance and unattended-balance cap were
 * proven at prepare, the signature binds the frozen domain, and an unfunded authorization simply never settles and
 * expires by its own validBefore. Base USDC keeps its single prepare-time admission.
 */
export async function assertCurrentNetworkPolicy(context: RuntimeContext, operation: X402OperationRecord): Promise<void> {
  const selected = x402AssetOf(operation);
  if (isBaseUsdc(selected)) return;
  await assertLocalNetworkProfile(context, operation.profile, selected);
  const payer = await resolveX402Payer(context, operation.profileHash, selected);
  if (payer.wallet !== operation.wallet || payer.transferMethod !== "eip3009") throw new ApnError("APN_WALLET_MISMATCH", "Current local payer differs from the frozen x402 wallet.");
  assertX402LimitCoversCap(operation, requireProfilePolicy(await context.requirePolicy().load(payer.policy)).maxX402AmountAtomic);
}

/**
 * The owner's current per-payment x402 limit against the cap this operation froze at prepare. Below it APN signs and sends
 * nothing, and the refusal says so and names what changes the outcome: the owner raising the limit, or the authorization
 * lapsing at validBefore, after which resume closes an unsent one without effect. Resume itself is never the next action,
 * since an unchanged policy refuses it again.
 */
export function assertX402LimitCoversCap(operation: X402OperationRecord, maxX402AmountAtomic: string): void {
  if (BigInt(operation.capAtomic) <= BigInt(maxX402AmountAtomic)) return;
  const asset = x402AssetOf(operation);
  const network = isBaseUsdc(asset) ? "" : ` --chain ${asset.network}${releasedX402Pair(asset.chainId, asset.token) ? "" : ` --asset ${asset.token}`}`;
  throw new ApnError("APN_X402_PROFILE_LIMIT_EXCEEDED",
    `The owner's per-payment x402 limit (${maxX402AmountAtomic} atomic) is now below this operation's frozen cap (${operation.capAtomic} atomic), ` +
    "so APN signs and sends nothing for it. The owner can raise --max-x402-amount-atomic to at least the cap; otherwise the authorization " +
    `lapses at validBefore ${operation.authorization.validBefore} (unix seconds) and operation resume then closes it without effect.`,
    { reason: "x402_profile_limit_below_frozen_cap", operationId: operation.operationId, chain: asset.network, asset: asset.token,
      cap_atomic: operation.capAtomic, amount_atomic: operation.amountAtomic, max_x402_amount_atomic: maxX402AmountAtomic,
      valid_before: operation.authorization.validBefore,
      nextActions: [`apn wallet policy set --profile ${operation.profile}${network} --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>`] });
}

/**
 * The owner's optional x402 payee pin (profile policy; absent = not restricted), re-read from local state before signing
 * and before the first paid request on every network, so a pin added after prepare stops an unsent payment.
 */
export async function assertCurrentX402Payee(context: RuntimeContext, operation: X402OperationRecord): Promise<void> {
  const binding = await x402PolicyBinding(context, operation.profileHash, x402AssetOf(operation));
  assertX402PayeeAdmitted(requireProfilePolicy(await context.requirePolicy().load(binding)), operation.authorization.to);
}
